# 記事づくりアシスタント

テーマから記事案を調べ、noteに貼り付ける下書きを作るWebアプリです。noteへの公開は内容を確認してから手動で行います。

## できあがった後の使い方

ブラウザでCloudflare WorkersのURLを開き、接続パスワードを一度入力します。毎朝9時（日本時間）に記事案を10件調査し、100円想定の下書きを自動作成します。手動で作った下書きもCloudflareに保存され、同じ接続パスワードで別の端末から確認できます。内容を確認・推敲してからnoteへ貼り付けて公開してください。

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
5. `wrangler.jsonc` が下書き用KVと毎日9時（日本時間）のCloudflare Workflowを構成します。GitHubへの接続で再デプロイが完了すれば、翌朝から自動作成されます。

APIキーはGitHubのファイルには入れず、CloudflareのSecretとしてのみ保管します。リポジトリは公開でも、接続パスワードがないと記事生成APIを使えません。接続パスワードは信頼できる人以外に共有しないでください。

## 無料枠とデータ

- GeminiとTavilyの無料枠を使います。各サービスの上限を使い切ると生成・検索は止まります。
- Googleの無料枠では送信内容がGoogleのサービス改善に使われる場合があります。個人情報や未公開情報を入力しないでください。
- 下書きはCloudflare KVに保存します。下書き一覧の読み込みには同じ接続パスワードが必要です。記事ごとにMarkdownファイルへ書き出しておくと手元にもバックアップできます。
- 毎日の自動生成はGeminiとTavilyのAPI利用枠を消費します。無料枠の上限や混雑状況によっては、その日の本数が10件に届かないことがあります。
- Gemini 3.8 Flashが混雑しているときは短く再試行し、Gemini 3.6 Flashへ切り替えます。
- Cloudflare Workers Freeの利用上限は変更される場合があります。現在の上限はCloudflareのダッシュボードで確認してください。

## ファイル構成

- `site/`: ブラウザに表示する画面
- `worker.js`, `wrangler.jsonc`: Cloudflare Workerと静的ファイルの配信設定
- `functions/api/`: GeminiとTavilyを呼び出すサーバー側処理
- `functions/_lib.js`: APIキー確認、検索、記事案・下書き生成
