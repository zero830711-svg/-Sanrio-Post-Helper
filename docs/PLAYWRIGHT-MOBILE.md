# iPhoneからPlaywrightテストを確認する

PlaywrightはGitHub Actions上で実行します。iPhoneにはインストール不要です。

## 自動実行

mainブランチへの対象ファイルの更新時と、main向けPull Requestで自動実行されます。テストはGitHub Pagesの反映待ちをせず、その更新内容をiPhone 13相当の画面サイズで確認します。

## iPhoneから手動実行

1. GitHubでこのリポジトリを開きます。
2. **Actions** → **Playwright mobile smoke tests** を開きます。
3. **Run workflow** → ブランチ **main** を選択 → **Run workflow** を押します。

iPhoneのSafariから直接開く場合：

https://github.com/zero830711-svg/-Sanrio-Post-Helper/actions/workflows/playwright.yml

実行が緑のチェックなら成功です。失敗時は実行行を開いてログを確認してください。Artifactsに playwright-mobile-report があれば、スクリーンショット・動画・トレースも確認できます。

## 確認内容

- トップ画面からAmazon商品候補ページを開ける
- iPhone幅でページ表示、検索例ボタン、横スクロールの有無
- 商品候補の保存とアフィリエイトID付きリンク生成

## 無料の品質チェック

- DependabotはnpmとGitHub Actionsの更新を月1回まとめて確認します。
- Playwright実行前にnpm auditで高・重大レベルの既知の依存脆弱性を確認します。
- CodeQLはJavaScriptとGitHub Actionsの設定を検査します。PHPファイルはCodeQLの対象言語ではありません。

テスト用のブラウザー領域を使うため、テストデータはユーザーの端末には保存されません。Xへの実投稿操作は行いません。
