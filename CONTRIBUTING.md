# ADTeemo 開発者向けガイド

この文書は ADTeemo の開発・検証・ローカル実行に必要な情報をまとめます。利用者向けの概要は [README.md](./README.md)、設計・調査の入口は [docs/README.md](./docs/README.md)、テスト規約は [TESTING_STYLE.md](./TESTING_STYLE.md) を参照してください。

## 技術構成

| Area        | Stack                                          |
| ----------- | ---------------------------------------------- |
| Runtime     | [.dvmrc](./.dvmrc)に固定したDeno、TypeScript   |
| Backend API | Hono RPC                                       |
| Database    | SQLite, Drizzle ORM                            |
| Discord Bot | discord.js                                     |
| Messages    | `messages` workspaceの言語・テーマ別メッセージ |
| Container   | Docker, Docker Compose                         |

## ディレクトリ構成

```text
.
├── api/       # Hono API、DB schema、Riot API連携
├── bot/       # Discord Bot、slash command、Bot側機能
├── messages/  # 多言語・テーマ別メッセージ
├── lib/       # 共通ライブラリ
├── docs/      # 索引、ADR、Proposal、Research、利用・連携ガイド
├── docker/    # Dockerfileとhealthcheck
└── drizzle/   # Drizzle migration
```

## Requirements

- [.dvmrc](./.dvmrc)に固定されたDeno
- Docker / Docker Compose
- Discord Bot tokenとapplication client ID
- Riot API key

## 依存関係の管理

依存元はrootまたは対象workspaceの `deno.json` の `imports` に登録します。共有依存はroot、workspace固有の依存は対象workspaceへ追加してください。

依存を事前取得する場合は `deno install --frozen=true` を使い、`deno.lock` と解決結果が一致しない状態をエラーにします。CIとDockerも同じ固定runtimeとfrozen lockfileを使用します。

- JSRで提供される依存は `jsr:` を優先します。JSRに適切なpackageがない場合だけ `npm:` を使います。
- ソースコードでは `@std/assert` や `@std/testing/bdd` のようなimport map上のbare specifierを使い、version付き `jsr:` / `npm:` を直書きしません。
- `https:` のmodule importと `deno.land/x` は新規追加しません。通常のHTTP API URL文字列はこの規則の対象外です。

## Environment Files

`.env.example` をテンプレートとして利用できます。

```bash
cp .env.example .env.dev
cp .env.example .env
```

ローカル開発では `.env.dev`、本番Dockerでは `.env` を使用します。

## 環境変数の正本

環境変数名と例は[.env.example](./.env.example)、受理値・必須条件・既定値は[APIの依存生成](./api/src/default_dependencies.ts)、[Bot起動](./bot/src/main.ts)、[service credential schema](./api/src/contract/service_auth.ts)および各設定読込コードが正本です。変数一覧をこの文書へ複製しません。

API接続・DB・Riot routing/rate limit・監視周期・ログlevel・message言語/テーマは`.env.example`を見て設定します。OP.GGの有効化と外部副作用は[連携ガイド](./docs/integrations/opgg.md)を確認してください。実際の秘密値は`.env`/`.env.dev`に置き、表示・転載・commitしません。

## ローカル起動

依存関係はDenoがtask実行時に解決します。

```bash
deno task db:push
deno task dev:deploy-commands
deno task dev:all
```

`db:push` は対象DBへschemaを反映し、`dev:deploy-commands` は `.env.dev` の認証情報でDiscordへslash commandを登録する状態変更操作です。ローカル開発用の対象DBを確認してから実行してください。

slash commandの登録はBot起動とは分離されています。production向けに登録する場合は、期待するcommand名と差分を確認したうえで、Botと同じimageを使うone-shot serviceを明示的に実行します。

```bash
docker compose --profile commands run --rm --build command-deployer
```

commandの読込に1件でも失敗がある場合、または有効commandが0件の場合はDiscord APIを呼びません。現在値と期待値が同一の場合もPUTを省略します。通常の `docker compose --profile prod up` やBot再起動はslash command定義を変更しません。

APIのみ、Botのみを起動する場合は次を使います。

```bash
deno task dev:api
deno task dev:bot
```

Backend APIは既定で `http://localhost:8000` に公開されます。

## Deno Tasks

完全なtask定義、実行権限、依存taskは[root deno.json](./deno.json)と[api](./api/deno.json)・[bot](./bot/deno.json)・[messages](./messages/deno.json)の定義を参照します。`deno task`で現在の一覧を表示できます。

通常検証は`deno task quality`、対象テストは`deno task test:target <test path>`を使います。いずれも`.env.example`を使い、通常テストは外部サービスへ接続しません。実Riot APIを使うlive testは[TESTING_STYLE](./TESTING_STYLE.md)のopt-in手順だけで実行します。

## Schema変更とmigration

DBの正本は[schema](./api/src/db/schema.ts)と[drizzle migrations](./drizzle)です。変更をmigrationとして生成し、既存データを保持したまま適用できることをmigration/repository integration testで検証します。新規のローカルDBで使う`db:push`と、既存DBへ履歴を適用する`db:migrate`を混同しないでください。

共有・本番DBの変更は対象`DATABASE_URL`、停止範囲、backup、事前query、適用後確認、rollback条件を先に確定し、明示確認を得て実行します。カスタムイベント・戦績の移行は[イベント整合性](./docs/custom-game-event-consistency.md)と[戦績移行手順](./docs/record-match-consistency.md)に従い、不明な旧データを推測で補完・削除しません。

## Docker

現行の開発・配備にはDocker / Docker Composeを使用します。Podman対応（#49）は保留で、runtime設定やCIには採用していません。実起動未検証を含む[調査記録](./docs/research/podman-compatibility.md)は参考資料として保持します。

### Development

開発用コンテナはソースを `/app` にマウントし、Deno cacheをDocker volumeに保持します。コンテナ起動時にアプリケーションは自動開始しないため、必要なtaskを `docker compose exec` で実行します。root `.dockerignore` は `.env*`、`.git`、coverage、`node_modules`、runtime dataをbuild contextから除外します。

```bash
docker compose --profile dev up -d --build
docker compose exec dev deno task db:push
docker compose exec dev deno task dev:all
```

対話シェルを開く場合:

```bash
docker compose exec dev bash
```

Docker内でテストを実行する場合:

```bash
docker compose --profile dev run --rm dev deno task test:all
```

停止する場合:

```bash
docker compose --profile dev down
```

### Production

本番profileはAPIとBotを分けて起動し、APIのhealthcheck成功後にBotを起動します。DBは `prod-db-data` volumeの `/app/data/sqlite.db` に保存されます。Bot起動時にslash commandは登録しません。command定義を変更したreleaseだけ、上記のone-shot serviceを先に実行してください。

起動前にDiscord tokenやRiot API keyとは別のcredentialを生成し、`BOT_SERVICE_TOKEN`へ設定します。例えば `openssl rand -hex 32` で64文字のランダム値を生成できます。値をshell history、ログ、Issue、テスト出力へ貼り付けないでください。

```bash
docker compose --profile prod up -d --build
docker compose --profile prod logs -f
docker compose --profile prod down
```

#### ログ、保持、閲覧権限

APIとBotのアプリケーションログはstdoutへ出力する1行JSONだけを正本とし、コンテナ内のlog fileへは書き込みません。すべてのrecordは`timestamp`, `level`, `event`, `component`を持ち、ERRORと第3引数にErrorを持つWARNは`correlationId`と`errorCategory`も持ちます。既知のcredential、token、cookie、OAuth code/state、SQL parameter、Riot ID / PUUID、Discord user IDはnested contextでもredactされます。

自由記述のmessage、stack、header、request/response body、provider response bodyをcontextへ渡さないでください。catchした`Error`はmessageへ変換せず、`logger.warn(event, context, error)`または`logger.error(event, context, error)`の第3引数へ渡します。loggerはerror class、妥当なHTTP status、Error causeのclassだけを記録し、raw message/stackや任意propertyは記録しません。追加の診断情報が必要な場合は、安定したreason codeやprovider名を構造化fieldとして定義します。URLはoriginだけを記録し、request pathはroute templateを別fieldで渡します。詳細な責務境界は [ADR 0002](./docs/adr/0002-structured-logging-trust-boundary.md) を参照してください。

APIは安全な形式の`X-Correlation-ID`を受理して同じresponse headerへ返します。headerが欠落または不正な場合はUUIDへ置き換えます。request logのpathは識別子を含む実URLではなくroute templateです。問い合わせ時はresponse headerの相関IDを共有し、tokenやrequest bodyは共有しないでください。

production ComposeのAPI / BotはDockerの`local` logging driverを使い、各コンテナで`10 MiB`、最大`5`世代にrotationします。これはhost内の短期調査用であり、コンテナ削除後の保持や長期監査を保証しません。閲覧には次を使います。

```bash
docker compose --profile prod logs -f api bot
```

ログを閲覧できるのはDocker daemonへのアクセス権を持つ運用者に限定してください。Docker socketや`docker` groupへのアクセスはhost上の強い権限を伴うため、ログ閲覧だけを目的に安易に付与せず、取得したログもcredentialと同等に限定共有します。

production APIのport `8000` はhostの `127.0.0.1` だけへbindされ、外部networkへ直接公開されません。BotはDocker network内の `http://api:8000` を利用します。RSO callbackを外部から受ける場合は、同一hostのTLS reverse proxyから `/auth/rso/callback` だけを `http://127.0.0.1:8000` へ転送してください。Bot service routeをreverse proxyの公開対象へ追加しないでください。

Riot APIのrate limit queueとbucket stateはBackend API process内だけで共有されます。送信可能なattemptはFIFOで直列化しますが、scope固有のcooldownやretry backoffの待機中は送信slotを解放し、別hostname/methodのrequestを継続します。5xxが明示する`Retry-After`は同一routing hostname/methodの一時cooldownとして共有し、headerのない5xxはrequest自身の線形backoffだけを適用します。productionではBackend APIを1 processで稼働させてください。複数replicaや複数workerへ拡張する場合は、先に分散queueと共有rate-limit stateを設計する必要があります。

credentialは次の順序でrotationします。

1. 新しいcredentialを生成する。
2. APIの `BOT_SERVICE_TOKEN` を新しい値、`BOT_SERVICE_TOKEN_PREVIOUS` を旧値にしてAPIを再起動する。
3. Botを新しい `BOT_SERVICE_TOKEN` で再起動する。
4. 旧Botが停止したことを確認し、`BOT_SERVICE_TOKEN_PREVIOUS` を空にしてAPIを再起動する。

APIより先にBotを切り替えると新credentialが拒否されるため、API、Bot、旧credential削除の順序を維持してください。判断理由と認証境界は [ADR 0001](./docs/adr/0001-bot-service-authentication.md) を参照してください。

## 品質確認

変更後は次を実行します。

```bash
deno task quality
```

Pull Requestと`main`へのpushでは、GitHub Actionsの固定job名`quality`が同じtaskを`.dvmrc`の固定runtimeで実行します。workflowは`.env.example`だけを使う通常テストを実行し、repository secretやlive external testは使用しません。

フォーマット差分がある場合は内容を確認してから `deno fmt` を実行し、その後に再度 `deno task fmt:check` を確認します。

## Git workflow

ブランチは `<type>/<kebab-topic>` 形式を使います。

commit messageは日本語のConventional Commits形式を使います。

```text
<type>[optional scope]: <description>

<背景・問題・判断理由・期待される効果・既知のリスク>
```

`type` は `feat`, `fix`, `refactor`, `perf`, `style`, `test`, `docs`, `build`, `ci`, `chore` を使います。`scope` は必要に応じて `api`, `bot`, `messages`, `db`, `docker` などを使います。

依頼外の既存差分はcommitへ含めません。PRには問題、変更後の振る舞い、関連Issue/doc、実施した検証と未実施の理由を記載し、実装途中の履歴で最終内容を埋めないようにします。

## Issueと文書の運用

Conventional Commitsはcommit messageだけに適用し、Issueタイトルは解決したい問題・結果を自然文で表します。種類と領域は既存Labelsで分類します。

- 親子はGitHub native sub-issueで表現し、connectorで関係を取得できない場合にも辿れるよう本文へ`Parent: #番号`と親側の`Sub-issues: #番号`を残します。
- 実装順序を制約する関係は`Depends on`、背景の共有だけは`Related`にします。親子関係だけから依存順を推測しません。
- Issue本文は問題、scope、受け入れ条件、依存、関連docリンクを保持します。作業状態・子タスク・完了履歴をrepo内のRoadmapへコピーしません。
- 調査・選択肢・採用判断は[docsの分類規則](./docs/README.md)に従ってrepo文書へ残し、Issue/PRからリンクします。文書を移動した場合は参照元を直し、外部リンクを更新できない旧pathには短い移管案内を残します。
- 仕様はcode/schema/tests、message本文はcatalogが正本です。文書には意味、判断理由、運用上必要な条件を残し、実装の列・定数・field順序を二重管理しません。

文書変更の検証は[文書索引の手順](./docs/README.md)に従います。テスト戦略とmock境界は[TESTING_STYLE](./TESTING_STYLE.md)を参照します。

## Discordメンバー同期

既定監視は起動時に完全なguildメンバー一覧を同期します。Developer PortalのServer Members Intentを有効にし、必要な承認条件を確認してください。同期できるまで監視workerを開始しません。通知先設定、上限、移行前の重複PUUID確認は[account監視の運用](./docs/integrations/account-monitoring.md)を参照してください。
