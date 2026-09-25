# ADTeemo Project

ADTeemoはLeague of Legendsのカスタムゲーム運営を支援するDiscord Botです。技術構成・setupは[CONTRIBUTING](./CONTRIBUTING.md)、現在利用できる機能は[README](./README.md)を参照してください。

## 正本と文書ルーティング

作業前に必要な文書だけを読み、実装・設定・Issueの状態を推測で補完しないこと。

| 読む場面                                          | 正本・参照先                                              |
| ------------------------------------------------- | --------------------------------------------------------- |
| 実行task、workspace、依存定義を変更する           | rootまたは対象workspaceの `deno.json`                     |
| topic・変更pathから採用判断や調査を探す           | [docs/README.md](./docs/README.md)の逆引き                |
| 現在の挙動・契約を確認する                        | 対象code/schema/tests。Proposalを現行仕様として扱わない   |
| setup、環境変数、Docker、migration、Git/Issue運用 | [CONTRIBUTING.md](./CONTRIBUTING.md)                      |
| テストを追加・再編する                            | [TESTING_STYLE.md](./TESTING_STYLE.md)                    |
| message keyや文体を変更する                       | [messages/README.md](./messages/README.md)                |
| 優先度、受け入れ条件、完了状態を確認する          | [GitHub Issues](https://github.com/akgm3i/ADTeemo/issues) |

外部サービスを扱う文書はVerified/Observedと再確認条件を読み、文書再編日を外部検証日とみなさないこと。

## 依存・検証の制約

- Deno v2の仕様に従い、Deno v1前提の書き方を持ち込まないこと。
- 依存追加時は[CONTRIBUTINGの依存管理規則](./CONTRIBUTING.md)に従い、共有かworkspace固有かを確認する。
- Honoの詳細確認が必要な場合は公式ドキュメントを参照すること。
- コード変更後は原則 `deno task quality` を実行する。正確な構成はroot `deno.json` が正本。
- 文書だけの変更は対象format、[文書リンク・metadata検証](./docs/README.md)、`git diff --check`など変更に比例して確認する。
- テストの追加・修正では[TESTING_STYLE](./TESTING_STYLE.md)を読み、通常テストでは`.env.example`を使う。

## Safety and Scope

- レビュー、調査、説明、状況確認は読み取り専用とし、明示依頼なしにファイル、ブランチ、Issue、外部サービスを変更しない。
- 実装作業では最初に現在ブランチと未コミット差分を確認し、既存差分を変更・削除・commit対象へ混入させない。
- `.env` の内容を表示、転載、commitしない。通常のテストでは `.env.example` を使う。
- `deploy-commands`、本番Docker操作、Riot live test、外部サービスへの登録操作は明示依頼がある場合だけ実行する。
- `db:push` / `db:migrate` は依頼上必要な場合に限り、`DATABASE_URL` の対象を確認する。本番・共有DBへの適用には明示確認を必要とする。
- 仕様確認をユーザーへ求めるのは、結果やスコープが大きく変わる曖昧さが残る場合に限定する。

## Development Conventions

- 会話は日本語で行う。
- 新機能・バグ修正はTDDを基本とする。期待する振る舞いの固定方法、命名、ライブラリ、mock境界はTESTING_STYLEに従う。
- API変更時は[APIエラー契約](./docs/api-error-contract.md)を読み、HTTP statusを成否の正本とする。HTTP bodyに`success`を含めない。Bot内部Resultの`success`と混同しない。
- DB設計は、Riot ID・内部レート・戦績をグローバル、Discordギルド設定・募集イベント・ロールID・VC設定をギルド別として扱う。
- 既存の実装パターンを優先し、依頼外のリファクタリングや新機能を混在させない。

## GitHub / Issue Rules

- GitHub関連情報は、利用可能ならGitHub connector / appを優先する。取得できない情報、Actions log、ローカルブランチとPRの対応確認などの不足分だけ `gh` CLIを使う。
- タスク追跡と完了状態はGitHub Issuesだけを正とする。Issueタイトル・Labels・Parent/Depends on/Relatedの規則はCONTRIBUTINGを参照する。
- Issueの更新やIssue化は、ユーザーの明示依頼または合意がある場合だけ行う。
- PRにレビュー指摘がある場合、指摘内容の妥当性と実際のコードを調査してから対応を判断する。

## Git / Collaboration Rules

- ブランチ作成または切り替えは、依頼された実装に必要な場合だけ行う。既に適切なブランチにいる場合は切り替えない。
- 新しいブランチ名は `<type>/<kebab-topic>` 形式とし、既存の作業差分が安全に保持できることを確認する。
- commit、push、PR作成はユーザーの明示依頼がある場合だけ行う。
- commit messageの形式、許可するtype/scope、依頼外差分を含めない規約は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照する。

作業完了時は、変更内容、実行した検証、未実行の検証と理由、残るリスクを日本語で報告する。実行していない検証を成功したと報告しない。
