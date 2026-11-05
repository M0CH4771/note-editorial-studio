# 記事づくりアシスタント

テーマから記事案を調べ、noteに貼り付ける下書きを作るWebアプリです。noteへの公開は内容を確認してから手動で行います。

## できあがった後の使い方

ブラウザでCloudflare PagesのURLを開き、接続パスワードを一度入力します。テーマを決めて記事案を出し、下書きを編集してnoteへ貼り付けます。記事は使用したブラウザ内に保存されます。「ファイルに保存」でバックアップしてください。

## 初回設定

このリポジトリをCloudflare Workersへ接続します。Workerが画面とAPIを一緒に配信します。

1. Cloudflareの **Workers & Pages → note-editorial-studio → Settings → Builds** で、GitHubの `M0CH4771/note-editorial-studio` と `main` ブランチが接続されていることを確認します。
2. Build commandは `None`、Deploy commandは `npx wrangler deploy`、Root directoryは `/` にします。リポジトリの `wrangler.jsonc` がWorkerの入口と画面ファイルの場所を指定します。
3. プロジェクトの **Settings → Variables and Secrets** を開き、次の3項目をSecretとして登録します。

| 名前 | 値 |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studioで発行したGemini APIキー |
| `TAVILY_API_KEY` | Tavilyで発行した検索APIキー |
| `APP_PASSWORD` | 自分で決めた、十分に長い接続パスワード |

4. 保存後に再デプロイします。発行された `workers.dev` のURLを開き、`APP_PASSWORD` に設定したパスワードを入力します。

APIキーはGitHubのファイルには入れず、CloudflareのSecretとしてのみ保管します。リポジトリは公開でも、接続パスワードがないと記事生成APIを使えません。接続パスワードは信頼できる人以外に共有しないでください。

## 無料枠とデータ

- GeminiとTavilyの無料枠を使います。各サービスの上限を使い切ると生成・検索は止まります。
- Googleの無料枠では送信内容がGoogleのサービス改善に使われる場合があります。個人情報や未公開情報を入力しないでください。
- 下書きはブラウザのローカルストレージに保存します。ブラウザのデータを消すと下書きも消えるため、記事ごとにMarkdownファイルを保存してください。
- Gemini 3.8 Flashが混雑しているときは短く再試行し、Gemini 3.6 Flashへ切り替えます。
- Cloudflare Workers Freeの利用上限は変更される場合があります。現在の上限はCloudflareのダッシュボードで確認してください。

## ファイル構成

- `site/`: ブラウザに表示する画面
- `worker.js`, `wrangler.jsonc`: Cloudflare Workerと静的ファイルの配信設定
- `functions/api/`: GeminiとTavilyを呼び出すサーバー側処理
- `functions/_lib.js`: APIキー確認、検索、記事案・下書き生成
