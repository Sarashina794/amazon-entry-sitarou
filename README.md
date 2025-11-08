# Amazon商品エントリーし太郎

Next.js（App Router）＋ TypeScript で構築された、Amazon への出品自動化支援ツールです。

---

## 1. 動作環境（Windows 10/11 想定）

| ツール | 推奨バージョン | 備考 |
| --- | --- | --- |
| Node.js | 20.x LTS 以上 | Playwright/Next.js が安定動作するライン |
| npm | Node 同梱 (10.x 以上) | `corepack enable` で `pnpm` 等も利用可能 |
| Git | 2.40 以上 | PowerShell / Git Bash いずれでも可 |
| Playwright | v1.44 以上 | `npx playwright install` でブラウザを展開 |

> **補足**: PowerShell を利用する場合は「PowerShell を管理者として実行」で開始し、`Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` を一度だけ実行してスクリプト実行を許可してください。

---

## 2. Node.js の導入手順

1. [Node.js 公式サイト](https://nodejs.org/) から Windows Installer (LTS) をダウンロードし、インストール（**必ず「Add to PATH」にチェック**）。
2. もしくは `nvm-windows` を利用する場合:
   ```powershell
   winget install CoreyButler.NVMforWindows
   nvm install 20
   nvm use 20
   ```
3. 反映確認:
   ```powershell
   node -v  # v20.x.x
   npm -v   # 10.x.x
   ```

---

## 3. Playwright の導入

本アプリは Playwright を利用してブラウザ操作を行います。依存ブラウザを一括で入れておくと別環境への展開が容易です。

```powershell
npm install
npx playwright install --with-deps
```

> Windows では `--with-deps` は任意ですが、WSL/CI 等でも使い回す場合に備えて付けておくと安全です。

---

## 4. プロジェクトセットアップ

1. リポジトリを取得
   ```powershell
   git clone <REPO_URL>
   cd amazon-entry-sitarou
   ```
2. 依存関係をインストール
   ```powershell
    npm install
   ```
3. 環境変数を設定  
   `.env.example` を参考に `.env` を作成し、Amazon 認証情報や実行パラメータを記入します。

---

## 5. よく使うスクリプト

| コマンド | 説明 |
| --- | --- |
| `npm run dev` | 開発サーバー (http://localhost:3000) を起動 |
| `npm run lint` | ESLint で静的解析を実行 |
| `npm run build && npm run start` | 本番ビルド → 本番サーバー起動 |

> Playwright のブラウザバイナリを更新したい場合は `npx playwright install` を再度実行してください。

---

## 6. トラブルシューティング

- **Playwright 実行時にブラウザが見つからない**  
  → `npx playwright install` を再実行し、`C:\Users\<USER>\AppData\Local\ms-playwright` にブラウザが展開されているか確認。
- **npm install で権限エラー**  
  → PowerShell を “管理者として実行” で再試行。
- **環境差分で失敗する場合**  
  → Node.js / npm バージョンをプロジェクトの推奨値 (Node 20, npm 10) に合わせる。

---

## 7. 参考リンク

- [Next.js ドキュメント](https://nextjs.org/docs)
- [Playwright ドキュメント](https://playwright.dev/docs/intro)
- [nvm-windows](https://github.com/coreybutler/nvm-windows)
