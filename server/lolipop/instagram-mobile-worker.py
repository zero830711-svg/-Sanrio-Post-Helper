"""One-account, read-only instagrapi probe; credentials are stdin-only."""
import contextlib
import importlib.metadata
import io
import json
import os
import pathlib
import re
import sys
import time
import zipfile
from urllib.parse import urlparse

from importlib.util import spec_from_file_location, module_from_spec
_spec = spec_from_file_location('safe_ig_worker', pathlib.Path(__file__).with_name('instagram-worker.py'))
_safe = module_from_spec(_spec)
_spec.loader.exec_module(_safe)
private_json = _safe.private_json


def run(data):
    if sys.version_info[:2] != (3, 13):
        return {'ok': False, 'errorType': 'PythonVersionMismatch'}
    root = pathlib.Path(data['privateDir'])
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    deps = root / 'instagrapi-3.0.21-py313'
    if not (deps / '.ready').exists():
        deps.mkdir(mode=0o700, exist_ok=True)
        with zipfile.ZipFile(pathlib.Path(__file__).with_name('instagram-mobile-lib.zip')) as archive:
            for name in archive.namelist():
                path = pathlib.PurePosixPath(name)
                if path.is_absolute() or '..' in path.parts:
                    raise ValueError('Invalid dependency archive')
            archive.extractall(deps)
        (deps / '.ready').touch(mode=0o600)
    sys.path.insert(0, str(deps))
    from instagrapi import Client
    import requests
    state_path = root / 'mobile-state.json'
    saved = json.loads(state_path.read_text()) if state_path.exists() else {}
    action = data.get('action')
    if action == 'runtime':
        return {'ok': True, 'engine': 'instagrapi', 'version': importlib.metadata.version('instagrapi'),
                'configured': bool(saved.get('authenticated'))}
    client = Client(request_timeout=1, session_retry_total=0,
                    public_request_retries_count=0, session_retry_statuses=[])
    def stop_on_exception(_client, error):
        raise error
    client.handle_exception = stop_on_exception
    client.delay_range = [1, 2]
    if time.time() - saved.get('blockedAt', 0) < 600:
        return {'ok': False, 'state': 'blocked', 'message': '本人確認・アクセス制限の後は10分以上停止します。公式Instagramで状況を確認してください。'}
    if saved.get('settings'):
        client.set_settings(saved['settings'])
    username = str(data.get('username', '')).strip().lstrip('@').lower()
    if action in ('login', 'two_factor'):
        if saved.get('username') and username != saved['username']:
            return {'ok': False, 'state': 'blocked', 'message': '保存した端末情報と同じInstagramアカウントを入力してください。'}
        if not username or not data.get('password'):
            return {'ok': False, 'state': 'login_required', 'message': 'ご自身のユーザーネームとパスワードを入力してください。'}
        saved['username'] = username
        saved['settings'] = client.get_settings()
        private_json(state_path, saved)
        try:
            if saved.get('authenticated'):
                # Validate the existing session without initiating password login.
                client.account_info()
            else:
                client.login(username, data['password'], verification_code=str(data.get('code', '')).strip())
                if not client.user_id:
                    raise RuntimeError('No authenticated session')
            saved['authenticated'] = True
            saved.pop('blockedAt', None)
            return {'ok': True, 'state': 'authenticated', 'message': 'instagrapiで認証できました。端末情報とセッションを保存しました。次に投稿1件の取得を検証してください。'}
        except Exception as error:
            name = type(error).__name__
            result = _safe.safe_error(error, action)
            result['errorType'] = name
            if name == 'TwoFactorRequired':
                result.update(state='two_factor', message='二段階認証コードを入力してください。パスワードは保存しないため、同じアカウントのログイン情報も再入力してください。')
            elif name.startswith('Challenge') or result.get('reason') == 'instagram_confirmation':
                result.update(state='blocked', message='instagrapiでも本人確認が必要になりました。自動処理を停止しました。公式Instagramで確認してください。')
                saved['blockedAt'] = time.time()
            elif name in ('PleaseWaitFewMinutes', 'FeedbackRequired', 'ClientThrottledError', 'SentryBlock'):
                result.update(state='blocked', message='Instagram側のアクセス制限が出ました。再試行を停止しました。')
                saved['blockedAt'] = time.time()
            elif name in ('BadPassword', 'BadCredentials'):
                result['message'] = 'Instagramがログイン情報を受け付けませんでした。公式でログインできても、サーバーからの認証が拒否される場合があります。'
            elif name == 'LoginRequired':
                saved['authenticated'] = False
                result['message'] = '保存したセッションが無効になりました。自動でパスワードログインは繰り返しません。'
            return result
        finally:
            saved['settings'] = client.get_settings()
            private_json(state_path, saved)
    if action != 'collect' or not saved.get('authenticated'):
        return {'ok': False, 'state': 'login_required', 'message': 'instagrapiでの初回認証が必要です。'}
    try:
        user_id = client.user_info_by_username_v1('friendcharacters').pk
        posts = client.user_medias_v1(user_id, amount=1)
        if not posts:
            return {'ok': False, 'state': 'authenticated', 'message': '投稿を取得できませんでした。'}
        post = posts[0]
        images = []
        if post.media_type == 1 and post.thumbnail_url:
            images = [str(post.thumbnail_url)]
        elif post.media_type == 8:
            images = [str(resource.thumbnail_url) for resource in post.resources
                      if resource.media_type == 1 and resource.thumbnail_url][:10]
        caption = post.caption_text or ''
        if not images or not caption:
            return {'ok': False, 'state': 'authenticated', 'message': '先頭投稿に写真と本文の両方がありません。'}
        parsed = urlparse(images[0])
        if parsed.scheme != 'https' or not any((parsed.hostname or '').endswith('.' + host) for host in ('cdninstagram.com', 'fbcdn.net')):
            raise ValueError('Untrusted photo host')
        with requests.get(images[0], timeout=12, stream=True, allow_redirects=False) as response:
            response.raise_for_status()
            prefix = next(response.iter_content(64), b'')
        if not (prefix.startswith(b'\xff\xd8\xff') or prefix.startswith(b'\x89PNG') or prefix.startswith(b'RIFF')):
            raise ValueError('Invalid image data')
        item = {'shortcode': post.code, 'url': 'https://www.instagram.com/p/' + post.code + '/',
                'caption': caption, 'published': post.taken_at.isoformat(), 'images': images}
        private_json(root / 'feed.json', {'checkedAt': int(time.time()), 'engine': 'instagrapi', 'items': [item]})
        return {'ok': True, 'state': 'collected', 'photoCount': len(images), 'captionLength': len(caption),
                'postUrl': item['url'], 'message': 'instagrapiで投稿本文と写真データを取得できました。'}
    except Exception as error:
        name = type(error).__name__
        result = _safe.safe_error(error, action)
        if name.startswith('Challenge') or name in ('PleaseWaitFewMinutes', 'FeedbackRequired', 'ClientThrottledError', 'SentryBlock'):
            saved['blockedAt'] = time.time()
            result['message'] = '投稿取得中に本人確認・アクセス制限が出ました。取得と再試行を停止しました。'
        if name == 'LoginRequired':
            saved['authenticated'] = False
        return result
    finally:
        saved['settings'] = client.get_settings()
        private_json(state_path, saved)


def main():
    data = {}
    try:
        data = json.loads(sys.stdin.read(16384))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = run(data)
    except Exception as error:
        result = _safe.safe_error(error, data.get('action') if isinstance(data, dict) else None)
        if isinstance(data, dict) and data.get('action') == 'runtime':
            result['runtimeDiagnostic'] = ' '.join(re.findall(r'GLIBC_[0-9.]+|GLIBCXX_[0-9.]+|lib[A-Za-z0-9_.+-]+\.so(?:\.[0-9]+)*|No module named [\"\'][A-Za-z0-9_.]+[\"\']', str(error)))[:240]
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
