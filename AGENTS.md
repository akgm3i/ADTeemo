# ADTeemo Project

## Project Overview

ADTeemoはLeague of Legendsのカスタムゲーム運営を支援するDiscord Botです。Discord BotとBackend APIの2コンポーネントで構成し、Deno workspaceとDockerで開発・実行します。

- **Runtime:** Deno 2.5 以上, TypeScript
- **API:** Hono RPC
- **Database:** SQLite + Drizzle ORM
- **Discord Bot:** discord.js
- **Workspaces:** `api`, `bot`, `messages`

## 正本と文書ルーティング

作業前に必要な文書だけを読み、実装・設定・Issueの状態を推測で補完しないこと。

| 確認したい内容                   | 正本・参照先                            |
| -------------------------------- | --------------------------------------- |
| 実行task、workspace、依存定義    | rootまたは対象workspaceの `deno.json`   |
| 現在の実装とテスト               | 対象コード、`*.test.ts`                 |
| 要求仕様と設計上の不変条件       | [SPEC.md](./SPEC.md)                    |
| 環境変数、起動、Docker、task一覧 | [CONTRIBUTING.md](./CONTRIBUTING.md)    |
| テスト分類、mock境界、テスト方針 | [TESTING_STYLE.md](./TESTING_STYLE.md)  |
| 現在の優先度と完了状態           | GitHub Issues。`TASKS.md` は要約Roadmap |

## Deno / Dependency Rules

- Deno v2の仕様に従い、Deno v1前提の書き方を持ち込まないこと。
- 新規依存は共有依存ならroot、workspace固有なら対象workspaceの `deno.json` の `imports` に登録する。
- `imports` の依存元は JSR (`jsr:`) を優先し、JSRに適切なpackageがない場合のみ npm (`npm:`) を使うこと。
- TypeScriptコードでは `@std/testing/bdd` のようなimport map上のbare specifierを使い、version付き `jsr:` や `npm:` を直書きしないこと。
- `https:` のmodule importと `deno.land/x` は、ソースコードとimport mapのどちらにも新規追加しないこと。通常のHTTP API URL文字列は対象外とする。
- Honoの詳細確認が必要な場合は公式ドキュメントを参照すること。

## Commands and Verification

完全なtask定義とqualityの構成は `deno.json` を正とし、この文書に重複して列挙しない。

| Command                                   | Purpose                                           |
| ----------------------------------------- | ------------------------------------------------- |
| `deno task dev:all`                       | APIとBotを開発モードで起動                        |
| `deno task dev:api` / `deno task dev:bot` | APIまたはBotだけを開発モードで起動                |
| `deno task test:all`                      | `.env.example` を使う外部サービス非接続の全テスト |
| `deno task quality`                       | root `deno.json` に定義された品質確認を一括実行   |

コード変更後は原則 `deno task quality` を実行する。ドキュメントだけを変更した場合は、変更対象のformat、相対リンク、`git diff --check` など変更に比例した検証を行う。検証結果は完了報告に記載する。

`deno task test:riot-live` は実Riot APIへ接続するため、依頼上必要な場合だけ実行する。本番Docker、slash command登録、共有または本番DBへの `db:push` / `db:migrate` も同様に対象環境を確認してから実行する。Dockerの詳細手順は `CONTRIBUTING.md` を参照する。

## Safety and Scope

- レビュー、調査、説明、状況確認は読み取り専用とし、明示依頼なしにファイル、ブランチ、Issue、外部サービスを変更しない。
- 実装作業では最初に現在ブランチと未コミット差分を確認し、既存差分を変更・削除・commit対象へ混入させない。
- `.env` の内容を表示、転載、commitしない。通常のテストでは `.env.example` を使う。
- `deploy-commands`、本番Docker操作、Riot live test、外部サービスへの登録操作は明示依頼がある場合だけ実行する。
- `db:push` / `db:migrate` は依頼上必要な場合に限り、`DATABASE_URL` の対象を確認する。本番・共有DBへの適用には明示確認を必要とする。
- 仕様確認をユーザーへ求めるのは、結果やスコープが大きく変わる曖昧さが残る場合に限定する。

## Development Conventions

- 会話は日本語で行う。
- 新機能・バグ修正はTDDを基本とし、期待する振る舞いを日本語のテスト名で先に固定する。
- テスト名は「状況、操作、期待結果」が分かる形にする。stub / spyは `using` で自動復元する。
- テストでは `@std/testing/bdd`、`@std/assert`、`@std/testing/mock` を使う。
- APIレスポンスの成否はHTTPステータスを唯一のソースとし、HTTP APIレスポンスボディに `success` を含めない。
- Bot内部の `apiClient` やUI層で `Result` 型として `success` を使うことは許可する。ただしHTTP API契約とは区別する。
- DB設計は、Riot ID・内部レート・戦績をグローバル、Discordギルド設定・募集イベント・ロールID・VC設定をギルド別として扱う。
- 既存の実装パターンを優先し、依頼外のリファクタリングや新機能を混在させない。

## GitHub / Issue Rules

- GitHub関連情報は、利用可能ならGitHub connector / appを優先する。取得できない情報、Actions log、ローカルブランチとPRの対応確認などの不足分だけ `gh` CLIを使う。
- 詳細なタスク追跡と完了状態はGitHub Issuesを正とし、`TASKS.md` は要約Roadmapとして扱う。
- Issueの更新やIssue化は、ユーザーの明示依頼または合意がある場合だけ行う。
- PRにレビュー指摘がある場合、指摘内容の妥当性と実際のコードを調査してから対応を判断する。

## Git / Collaboration Rules

- ブランチ作成または切り替えは、依頼された実装に必要な場合だけ行う。既に適切なブランチにいる場合は切り替えない。
- 新しいブランチ名は `<type>/<kebab-topic>` 形式とし、既存の作業差分が安全に保持できることを確認する。
- commit、push、PR作成はユーザーの明示依頼がある場合だけ行う。
- commit messageの形式、許可するtype/scope、依頼外差分を含めない規約は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照する。

作業完了時は、変更内容、実行した検証、未実行の検証と理由、残るリスクを日本語で報告する。実行していない検証を成功したと報告しない。
