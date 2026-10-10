import importlib.util
import json
import pathlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('mobile', pathlib.Path(__file__).parents[1] / 'server/lolipop/instagram-mobile-worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class TwoFactorRequired(Exception): pass


class FakeClient:
    logins = 0
    validations = 0
    fail = False
    def __init__(self, **kwargs):
        self.settings = {'uuids': {'uuid': 'stable-device'}}
        self.user_id = None
    def get_settings(self): return self.settings
    def set_settings(self, settings):
        self.settings = settings
        self.user_id = settings.get('authenticatedUser')
    def login(self, username, password, **kwargs):
        FakeClient.logins += 1
        if FakeClient.fail == 'code':
            self.bloks_ap_two_step_verification_code_entry('entry')
            self.challenge_code_handler(username, 1)
        if FakeClient.fail:
            raise type('ChallengeRequired', (Exception,), {})('PRIVATE_SECRET')
        self.user_id = 123
        self.settings['authenticatedUser'] = 123
    def bloks_ap_two_step_verification_code_entry(self, context_data, domain=None): return {'context': 'private-submit-context'}
    def bloks_extract_context_data(self, result, app): return result['context']
    def bloks_ap_two_step_verification_submit_code(self, context, code, domain=None):
        if context != 'private-submit-context': raise AssertionError('Lost original code context')
        return {'accepted': code == '123456'}
    def bloks_apply_login_response(self, response):
        if response['accepted']:
            self.user_id = 123; self.settings['authenticatedUser'] = 123
        return response['accepted']
    def account_info(self): FakeClient.validations += 1


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        deps = self.root / 'instagrapi-3.0.21-py313'
        deps.mkdir(); (deps / '.ready').touch()
        self.fake_module = types.ModuleType('instagrapi')
        self.fake_module.Client = FakeClient
        self.fake_exceptions = types.ModuleType('instagrapi.exceptions')
        self.fake_exceptions.TwoFactorRequired = TwoFactorRequired
        FakeClient.logins = FakeClient.validations = 0
        FakeClient.fail = False
    def tearDown(self): self.tmp.cleanup()
    def run_worker(self, **data):
        with patch.object(worker, 'sys', types.SimpleNamespace(version_info=(3,13),path=sys.path.copy())), patch.dict(sys.modules, {'instagrapi': self.fake_module, 'instagrapi.exceptions': self.fake_exceptions}):
            return worker.run(dict(privateDir=str(self.root), **data))
    def test_saved_session_validates_without_password_login(self):
        self.assertTrue(self.run_worker(action='login', username='testuser', password='PRIVATE_SECRET')['ok'])
        first = json.loads((self.root / 'mobile-state.json').read_text())
        self.assertTrue(self.run_worker(action='login', username='testuser', password='PRIVATE_SECRET')['ok'])
        self.assertEqual(FakeClient.logins, 1)
        self.assertEqual(FakeClient.validations, 1)
        self.assertEqual(first['settings']['uuids'], json.loads((self.root / 'mobile-state.json').read_text())['settings']['uuids'])
        self.assertNotIn('PRIVATE_SECRET', (self.root / 'mobile-state.json').read_text())
        self.assertEqual((self.root / 'mobile-state.json').stat().st_mode & 0o777, 0o600)
    def test_challenge_stops_and_preserves_device(self):
        FakeClient.fail = True
        first = self.run_worker(action='login', username='testuser', password='PRIVATE_SECRET')
        self.assertEqual(first['state'], 'blocked')
        self.assertNotIn('PRIVATE_SECRET', json.dumps(first))
        state = json.loads((self.root / 'mobile-state.json').read_text())
        self.assertEqual(state['settings']['uuids']['uuid'], 'stable-device')
        self.assertEqual(self.run_worker(action='login', username='testuser', password='PRIVATE_SECRET')['state'], 'blocked')
        self.assertEqual(FakeClient.logins, 1)
    def test_web_code_resumes_without_new_login_or_terminal_input(self):
        FakeClient.fail = 'code'
        result = self.run_worker(action='login', username='testuser', password='PRIVATE_SECRET')
        self.assertEqual(result['state'], 'two_factor')
        self.assertNotIn('private-submit-context', json.dumps(result))
        self.assertTrue(self.run_worker(action='two_factor', username='testuser', password='PRIVATE_SECRET', code='123456')['ok'])
        self.assertEqual(FakeClient.logins, 1)
        state = json.loads((self.root / 'mobile-state.json').read_text())
        self.assertTrue(state['authenticated'])
        self.assertNotIn('pendingCode', state)
        self.assertNotIn('123456', json.dumps(state))

    def test_other_account_cannot_reuse_identity(self):
        self.run_worker(action='login', username='testuser', password='PRIVATE_SECRET')
        self.assertFalse(self.run_worker(action='login', username='otheruser', password='OTHER')['ok'])
        self.assertEqual(FakeClient.logins, 1)


if __name__ == '__main__': unittest.main()
