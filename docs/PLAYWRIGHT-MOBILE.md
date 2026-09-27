# iPhoneからPlaywrightテストを実行する

Playwright本体はiPhoneにはインストールせず、GitHub ActionsのLinux環境で実行します。iPhoneからは実行開始と結果確認ができます。

## 実行方法

1. GitHubでこのリポジトリを開きます。
2. **Actions** → **Playwright mobile smoke tests** を開きます。
3. **Run workflow** → ブランチが **main** であることを確認 → **Run workflow** を押します。
4. 実行行が緑のチェックになったら成功です。赤い×なら実行行を開き、`Test the live GitHub Pages site` のログを確認します。
5. 実行行の **Artifacts** から `playwright-mobile-report` をダウンロードすると、失敗時のスクリーンショット・動画・トレースを確認できます。

iPhoneのSafariから直接開く場合は、次のURLを使えます。

https://github.com/zero830711-svg/-Sanrio-Post-Helper/actions/workflows/playwright.yml

GitHub ActionsではiPhone 13相当の画面サイズで、Amazon商品候補ページの表示、検索例ボタン、候補保存、アフィリエイトID付きリンク生成を確認します。テスト専用のブラウザー領域を使うため、保存データは本番ユーザーの端末には残りません。Xへの実投稿操作は行いません。
