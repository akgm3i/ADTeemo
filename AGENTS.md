# ADTeemo Project

## Project Overview

ADTeemoはLeague of Legendsのカスタムゲーム運営を支援するDiscord Botです。Discord BotとBackend APIの2コンポーネントで構成し、Deno workspaceとDockerで開発・実行します。

- **Runtime:** Deno 2.5 以上, TypeScript
- **API:** Hono RPC
- **Database:** SQLite + Drizzle ORM
- **Discord Bot:** discord.js
- **Workspaces:** `api`, `bot`, `messages`

仕様は [SPEC.md](./SPEC.md)、Roadmap要約は [TASKS.md](./TASKS.md)、開発者向けの実行・環境情報は [CONTRIBUTING.md](./CONTRIBUTING.md)、テスト規約は [TESTING_STYLE.md](./TESTING_STYLE.md) を参照してください。詳細なタスク追跡はGitHub Issuesを正とします。

## Deno / Dependency Rules

- Deno v2の仕様に従い、Deno v1前提の書き方を持ち込まないこと。
- 新規依存は JSR (`jsr:`) を優先し、必要な場合のみ `npm:` を使うこと。
- `deno.land/x` は新規追加しないこと。
- Honoの詳細確認が必要な場合は公式ドキュメントを参照すること。

## Commands

| Command                         | Purpose                                                                   |
| ------------------------------- | ------------------------------------------------------------------------- |
| `deno task dev:all`             | API と Bot を開発モードで起動                                             |
| `deno task dev:api`             | API のみ開発モードで起動                                                  |
| `deno task dev:bot`             | Bot のみ開発モードで起動                                                  |
| `deno task fmt:check`           | フォーマット差分を検出                                                    |
| `deno task lint`                | lint を実行                                                               |
| `deno task check`               | 主要 entrypoint の型チェックを実行                                        |
| `deno task test:all`            | `.env.example` を読み、coverage 付きで全テストを実行                      |
| `deno task test:riot-live`      | 実Riot APIで疎通確認を実行。通常はopt-inで使用                            |
| `deno task quality`             | `fmt:check` / `lint` / `check` / `check:messages` / `test:all` を一括実行 |
| `deno task check:messages`      | メッセージ定義の不足キー・重複キーを確認                                  |
| `deno task db:push`             | Drizzle schema をDBへ反映                                                 |
| `deno task db:generate`         | Drizzle migration を生成                                                  |
| `deno task db:migrate`          | Drizzle migration を適用                                                  |
| `deno task deploy-commands`     | `.env` を使ってDiscord slash commandを登録                                |
| `deno task dev:deploy-commands` | `.env.dev` を使ってDiscord slash commandを登録                            |

開発用 Docker コンテナを起動する場合:

```bash
docker compose --profile dev up -d --build
```

起動済みの dev コンテナ内でタスクを実行する場合:

```bash
docker compose exec dev deno task dev:all
```

Docker 内でローカルと同等のテストを実行する場合:

```bash
docker compose --profile dev run --rm dev deno task test:all
```

## Quality Gate

変更後は原則として以下を実行します。

```bash
deno task quality
```

フォーマット差分がある場合は内容を確認してから `deno fmt` を実行し、その後に再度 `deno task fmt:check` を確認します。

`test:all` は libsql のネイティブロードのため当面 `--allow-sys` と `--allow-ffi` を必要とします。DB factory 導入後に権限縮小を検討します。

## Development Conventions

- 会話は日本語で行います。
- 新機能・バグ修正はTDDを基本とします。期待する振る舞いを日本語のテスト名で先に固定してください。
- テスト名は「状況、操作、期待結果」が分かる形にします。必要なら実装前にテストケースの妥当性をユーザーへ確認してください。
- テストは `jsr:@std/testing/bdd`, `@std/assert`, `@std/testing/mock` を使い、stub / spyは `using` で自動復元します。
- APIレスポンスの成否は HTTP ステータスを唯一のソースとし、HTTP APIレスポンスボディに `success` を含めません。
- Bot内部の `apiClient` や UI 層で `Result` 型として `success` を使うことは許可します。ただしHTTP API契約とは区別します。
- DB設計は、Riot ID・内部レート・戦績をグローバル、Discordギルド設定・募集イベント・ロールID・VC設定をギルド別として扱います。
- 既存の実装パターンを優先し、無関係なリファクタリングは避けます。
- TDDの詳細、テスト分類、mock方針、Integration test方針は [TESTING_STYLE.md](./TESTING_STYLE.md) を参照してください。

## GitHub / Issue Rules

- GitHub関連情報を確認する場合は、まずGitHub connectorを使います。
- connectorで取得できない情報、Actions log、ローカルブランチとPRの対応確認などが必要な場合のみ `gh` CLIを使います。
- issueが詳細追跡の正です。`TASKS.md` は要約Roadmapとissue化前の技術課題だけを残します。
- 作業完了時は関連issueを更新し、必要に応じて `TASKS.md` の要約も同期します。
- 懸念や改善案をGitHub Issue化する場合は、ユーザーの明示依頼または合意を得てから行います。

## Git / Collaboration Rules

- 作業開始時は現在ブランチと未コミット差分を確認し、依頼内容に応じた作業ブランチをConventional Branch形式で作成または切り替える。
- 変更完了後、品質確認を行う。
- commit / push / PR作成はユーザーの明示依頼がある場合のみ行う。
- 依頼範囲の差分だけを日本語Conventional Commits形式でコミットする。既存の未追跡ファイルや依頼外の差分はコミットに含めない。
- PRにレビュー指摘がある場合、指摘内容の妥当性や実際のコード、外部情報など自身で調査してから対応するか判断する。

### Commit Message Format

```text
<type>[optional scope]: <description>

<背景・問題・判断理由・期待される効果・既知のリスク>
```

`type` は `feat`, `fix`, `refactor`, `perf`, `style`, `test`, `docs`, `build`, `ci`, `chore` を使います。`scope` は必要に応じて `api`, `bot`, `messages`, `db`, `docker` などを使います。

### Commit Types

| Type       | Description                                          |
| ---------- | ---------------------------------------------------- |
| `feat`     | 新機能                                               |
| `fix`      | バグ修正                                             |
| `refactor` | 振る舞いを変えない設計・実装改善                     |
| `perf`     | 性能改善                                             |
| `style`    | フォーマットなど、コードの意味を変えないスタイル変更 |
| `test`     | テスト追加・修正                                     |
| `docs`     | ドキュメント変更                                     |
| `build`    | Deno、Docker、依存関係などビルド関連                 |
| `ci`       | CI/CD関連                                            |
| `chore`    | 上記に分類しにくい雑務                               |

### Commit Scopes

- `api`
- `bot`
- `messages`
- `db`
- `docker`
