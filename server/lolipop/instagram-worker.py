"""Bounded Instagram read-only probe. Secrets arrive only on stdin."""
import contextlib
import functools
import io
import json
import os
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent / '.ig-lib'))


def private_json(path, data):
    tmp = path.with_suffix('.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        os.chmod(tmp, 0o600)
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def run(data):
    import instaloader
    import requests
    root = pathlib.Path(data['privateDir'])
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    session = root / 'session.json'
    pending = root / 'pending.json'
    loader = instaloader.Instaloader(quiet=True, max_connection_attempts=1, request_timeout=12,
                                   fatal_status_codes=[401, 403, 429], download_videos=False)
    action = data.get('action')
    if action == 'runtime':
        return {'ok': True, 'version': instaloader.__version__, 'configured': session.exists()}
    if action == 'login':
        try:
            loader.login(data['username'], data['password'])
        except instaloader.TwoFactorAuthRequiredException:
            s, user, identifier = loader.context.two_factor_auth_pending
            private_json(pending, {'cookies': requests.utils.dict_from_cookiejar(s.cookies),
                                   'headers': dict(s.headers), 'username': user,
                                   'identifier': identifier, 'created': time.time()})
            return {'ok': False, 'state': 'two_factor', 'message': '二段階認証コードを入力してください。'}
        private_json(session, {'username': loader.context.username, 'cookies': loader.context.save_session()})
        pending.unlink(missing_ok=True)
        return {'ok': True, 'state': 'authenticated', 'message': 'サーバー側のログインに成功しました。次に投稿取得を検証してください。'}
    if action == 'two_factor':
        if not pending.exists():
            return {'ok': False, 'message': '初回ログインからやり直してください。'}
        p = json.loads(pending.read_text())
        if time.time() - p['created'] > 600:
            pending.unlink(missing_ok=True)
            return {'ok': False, 'message': '認証の有効時間が切れました。初回ログインからやり直してください。'}
        s = requests.Session()
        s.cookies.update(p['cookies'])
        s.headers.update(p['headers'])
        s.request = functools.partial(s.request, timeout=12)
        loader.context.two_factor_auth_pending = (s, p['username'], p['identifier'])
        loader.two_factor_login(data['code'])
        private_json(session, {'username': loader.context.username, 'cookies': loader.context.save_session()})
        pending.unlink(missing_ok=True)
        return {'ok': True, 'state': 'authenticated', 'message': 'サーバー側の認証に成功しました。次に投稿取得を検証してください。'}
    if action != 'collect' or not session.exists():
        return {'ok': False, 'state': 'login_required', 'message': 'サーバー側の初回ログインが必要です。'}
    saved = json.loads(session.read_text())
    loader.context.load_session(saved['username'], saved['cookies'])
    profile = instaloader.Profile.from_username(loader.context, 'friendcharacters')
    post = next(profile.get_posts())
    images = []
    if post.typename == 'GraphSidecar':
        images = [node.display_url for node in post.get_sidecar_nodes() if not node.is_video][:10]
    elif not post.is_video:
        images = [post.url]
    item = {'shortcode': post.shortcode, 'url': 'https://www.instagram.com/p/' + post.shortcode + '/',
            'caption': post.caption or '', 'published': post.date_utc.isoformat() + 'Z', 'images': images}
    if not item['caption'] or not images:
        return {'ok': False, 'state': 'no_photo_post', 'message': '先頭投稿で本文と写真の両方を確認できませんでした。'}
    # Verify the actual bytes of one photo before treating collection as successful.
    response = requests.get(images[0], timeout=12, stream=True)
    response.raise_for_status()
    prefix = next(response.iter_content(64), b'')
    response.close()
    if not (prefix.startswith(b'\xff\xd8\xff') or prefix.startswith(b'\x89PNG') or prefix.startswith(b'RIFF')):
        return {'ok': False, 'message': '写真データを確認できませんでした。'}
    private_json(root / 'feed.json', {'checkedAt': int(time.time()), 'items': [item]})
    return {'ok': True, 'state': 'collected', 'photoCount': len(images), 'captionLength': len(item['caption']),
            'postUrl': item['url'], 'message': '本文と写真の取得に成功しました。'}


def main():
    try:
        data = json.loads(sys.stdin.read(16384))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = run(data)
    except Exception as error:
        name = type(error).__name__
        message = 'Instagramへの接続・認証を完了できませんでした。繰り返し実行せず、取得は停止してください。'
        if name == 'ModuleNotFoundError':
            message = '収集ライブラリを読み込めませんでした。'
        elif name == 'BadCredentialsException':
            message = 'ログイン情報または認証コードを確認してください。'
        result = {'ok': False, 'state': 'blocked', 'errorType': name, 'message': message}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
