# 記事づくりアシスタント

テーマから記事案を調べ、noteに貼り付ける下書きを作るWebアプリです。noteへの公開は内容を確認してから手動で行います。

## できあがった後の使い方

ブラウザでCloudflare PagesのURLを開き、接続パスワードを一度入力します。テーマを決めて記事案を出し、下書きを編集してnoteへ貼り付けます。記事は使用したブラウザ内に保存されます。「ファイルに保存」でバックアップしてください。

## 初回設定

このリポジトリをCloudflare Pagesへ接続します。

1. Cloudflareのダッシュボードで **Workers & Pages → Create → Pages → Connect to Git** を選び、GitHubの `M0CH4771/note-editorial-studio` を接続します。
2. Framework presetは **None**、Build commandは空欄、Build output directoryは `.` にしてデプロイします。
3. プロジェクトの **Settings → Variables and Secrets** を開き、Production環境に次の3項目をSecretとして登録します。

| 名前 | 値 |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studioで発行したGemini APIキー |
| `TAVILY_API_KEY` | Tavilyで発行した検索APIキー |
| `APP_PASSWORD` | 自分で決めた、十分に長い接続パスワード |

4. 保存後に再デプロイします。発行されたPagesのURLを開き、`APP_PASSWORD` に設定したパスワードを入力します。

APIキーはGitHubのファイルには入れず、CloudflareのSecretとしてのみ保管します。リポジトリは公開でも、接続パスワードがないと記事生成APIを使えません。接続パスワードは信頼できる人以外に共有しないでください。

## 無料枠とデータ

- GeminiとTavilyの無料枠を使います。各サービスの上限を使い切ると生成・検索は止まります。
- Googleの無料枠では送信内容がGoogleのサービス改善に使われる場合があります。個人情報や未公開情報を入力しないでください。
- 下書きはブラウザのローカルストレージに保存します。ブラウザのデータを消すと下書きも消えるため、記事ごとにMarkdownファイルを保存してください。
- Gemini 3.8 Flashが混雑しているときは短く再試行し、Gemini 3.6 Flashへ切り替えます。
- Cloudflare Workers Freeの利用上限は変更される場合があります。現在の上限はCloudflareのダッシュボードで確認してください。

## ファイル構成

- `index.html`, `app.js`, `styles.css`: ブラウザに表示する画面
- `functions/api/`: GeminiとTavilyを呼び出すサーバー側処理
- `functions/_lib.js`: APIキー確認、検索、記事案・下書き生成
