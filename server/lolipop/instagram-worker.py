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


def safe_error(error, action):
    name = type(error).__name__
    detail = str(error).lower()
    reason = 'unknown'
    message = 'Instagramへの接続・認証を完了できませんでした。自動再試行はしません。'
    state = 'blocked'
    if name == 'ModuleNotFoundError':
        reason, message = 'library_missing', '収集ライブラリを読み込めませんでした。'
    elif any(word in detail for word in ('checkpoint', 'challenge_required')):
        reason, message = 'instagram_confirmation', 'Instagram側で本人確認が必要です。Instagram公式アプリで通知・確認画面を確認してください。この画面では本人確認を自動処理しません。'
    elif any(word in detail for word in ('feedback_required', 'please wait', '429', 'blocked ip')):
        reason, message = 'instagram_restricted', 'Instagram側のアクセス制限が疑われます。ログインの再試行を停止してください。'
    elif name == 'BadCredentialsException':
        if action == 'two_factor':
            reason, state, message = 'two_factor_rejected', 'two_factor', '二段階認証コードを受け付けませんでした。コードの有効時間を確認してください。'
        else:
            reason, message = 'credentials_rejected', 'Instagramがログイン情報を受け付けませんでした。公式で同じ情報を使ってログインできるか確認してください。'
    elif name == 'LoginException' and 'does not exist' in detail:
        reason, message = 'username_rejected', 'Instagramがこのユーザーネームを確認できませんでした。ご自身のユーザーネーム（@なし）を確認してください。'
    elif name in ('Timeout', 'ReadTimeout', 'ConnectTimeout', 'ConnectionError', 'SSLError'):
        reason, message = 'network_error', 'サーバーからInstagramへの通信に失敗しました。パスワードの誤りとは限りません。'
    elif name in ('KeyError', 'JSONDecodeError') or 'json decode' in detail or 'unexpected response' in detail:
        reason, message = 'unexpected_response', 'Instagramから想定外の応答が返りました。サーバー側の認証方式を確認する必要があります。'
    return {'ok': False, 'state': state, 'errorType': name, 'reason': reason, 'message': message}


def main():
    data = {}
    try:
        data = json.loads(sys.stdin.read(16384))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = run(data)
    except Exception as error:
        result = safe_error(error, data.get('action') if isinstance(data, dict) else None)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
