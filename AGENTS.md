# ADTeemo Project

## Project Overview

ADTeemo は League of Legends のカスタムゲーム運営を支援する Discord Bot です。Discord Bot と Backend API の 2 コンポーネントで構成し、Deno workspace と Docker で開発・実行します。

- **Runtime:** Deno 2.5 以上, TypeScript
- **API:** Hono RPC
- **Database:** SQLite + Drizzle ORM
- **Discord Bot:** discord.js
- **Workspaces:** `api`, `bot`, `messages`

詳細な機能要件は [SPEC.md](./SPEC.md)、未実装・改善タスクは [TASKS.md](./TASKS.md)、テスト規約は [TESTING_STYLE.md](./TESTING_STYLE.md) を参照してください。

## Deno / Dependency Rules

- Deno v2 の仕様に従い、Deno v1 前提の書き方を持ち込まないこと。
- 新規依存は JSR (`jsr:`) を優先し、必要な場合のみ `npm:` を使うこと。
- `deno.land/x` は新規追加しないこと。
- Hono の詳細確認が必要な場合は公式ドキュメントを参照すること。

## Commands

| Command                      | Purpose                                              |
| ---------------------------- | ---------------------------------------------------- |
| `deno task dev:all`          | API と Bot を開発モードで起動                        |
| `deno task dev:api`          | API のみ開発モードで起動                             |
| `deno task dev:bot`          | Bot のみ開発モードで起動                             |
| `deno task fmt:check`        | フォーマット差分を検出                               |
| `deno task lint`             | lint を実行                                          |
| `deno task check`            | 主要 entrypoint の型チェックを実行                   |
| `deno task test:all`         | `.env.example` を読み、coverage 付きで全テストを実行 |
| `deno task quality`          | fmt check / lint / check / test を一括実行           |
| `deno task db:push`          | Drizzle schema をDBへ反映                            |
| `deno task db:generate`      | Drizzle migration を生成                             |
| `deno task db:migrate`       | Drizzle migration を適用                             |
| `deno task db:backup`        | 本番DBのバックアップを作成                           |
| `deno task db:restore-local` | バックアップからローカルDBを復元                     |
| `deno task deploy-commands`  | Discord slash command を登録                         |

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

変更後は原則として以下をこの順に実行します。

```bash
deno task fmt:check
deno task lint
deno task check
deno task test:all
```

フォーマット差分がある場合のみ `deno fmt` を実行し、その後に再度 `deno task fmt:check` を確認します。

`test:all` は libsql のネイティブロードのため当面 `--allow-sys` と `--allow-ffi` を必要とします。DB factory 導入後に権限縮小を検討します。

## Development Conventions

- 新機能・バグ修正は TDD を基本とします。期待する振る舞いを日本語のテスト名で先に固定してください。
- テスト名は「状況、操作、期待結果」が分かる形にします。必要なら実装前にテストケースの妥当性をユーザーへ確認してください。
- テストは `jsr:@std/testing/bdd`, `@std/assert`, `@std/testing/mock` を使い、stub / spy は `using` で自動復元します。
- API レスポンスの成否は HTTP ステータスを唯一のソースとし、レスポンスボディに `success` を含めません。
- Bot 内部の `apiClient` や UI 層で `Result` 型として `success` を使うことは許可します。ただし HTTP API 契約とは区別します。
- DB 設計は、Riot ID・内部レート・戦績をグローバル、Discord ギルド設定・募集イベント・ロールID・VC設定をギルド別として扱います。
- 既存の実装パターンを優先し、無関係なリファクタリングは避けます。
- TDD の詳細、テスト分類、mock方針、Integration test方針は [TESTING_STYLE.md](./TESTING_STYLE.md) を参照してください。

## Git / Collaboration Rules

- 会話は日本語で行います。
- コミットメッセージは日本語の Conventional Commits 形式にします。
- 作業は適切なブランチとコミットで記録し、過去作業は commit log で確認します。
- 作業完了時は関連する `TASKS.md` の項目を更新します。
- ブランチ作成、commit、push、PR 作成が必要な場合はユーザーの明示依頼に従います。
- 懸念や改善案を GitHub Issue 化する場合は `gh` CLI を使います。

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
| `ci`       | CI/CD 関連                                           |
| `chore`    | 上記に分類しにくい雑務                               |

### Commit Scopes

- `api`
- `bot`
- `messages`
- `db`
- `docker`
