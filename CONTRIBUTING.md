# ADTeemo 開発者向けガイド

この文書は ADTeemo の開発・検証・ローカル実行に必要な情報をまとめます。利用者向けの概要は [README.md](./README.md)、仕様は [SPEC.md](./SPEC.md)、テスト規約は [TESTING_STYLE.md](./TESTING_STYLE.md) を参照してください。

## 技術構成

| Area        | Stack                                          |
| ----------- | ---------------------------------------------- |
| Runtime     | Deno 2.5+, TypeScript                          |
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
├── docs/      # 調査メモ、補足仕様
├── docker/    # Dockerfileとhealthcheck
└── drizzle/   # Drizzle migration
```

## Requirements

- Deno 2.5以上
- Docker / Docker Compose
- Discord Bot tokenとapplication client ID
- Riot API key

## 依存関係の管理

依存元はrootまたは対象workspaceの `deno.json` の `imports` に登録します。共有依存はroot、workspace固有の依存は対象workspaceへ追加してください。

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

## 主要な環境変数

| Variable                                                   | Description                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `TZ`                                                       | アプリケーションのタイムゾーン。例: `Asia/Tokyo`                                                 |
| `API_LOG_LEVEL` / `BOT_LOG_LEVEL`                          | API / Botのstdout log level。`DEBUG`, `INFO`, `WARN`, `ERROR`。既定は`INFO`                       |
| `DB_QUERY_LOG`                                             | `1`かつ`API_LOG_LEVEL=DEBUG`のときだけSQL templateを記録する。parameterは常に記録しない。         |
| `DISCORD_TOKEN`                                            | Discord Bot token                                                                                |
| `DISCORD_CLIENT_ID`                                        | Discord application client ID                                                                    |
| `DISCORD_GUILD_ID`                                         | 指定時はguild commandとしてslash commandを登録します。未指定時はglobal commandとして登録します。 |
| `API_URL`                                                  | Botから参照するBackend API URL                                                                   |
| `BOT_SERVICE_TOKEN`                                        | Bot service route用の32〜256文字のランダムBearer credential。APIとBotへ同じ現行値を設定します。  |
| `BOT_SERVICE_TOKEN_PREVIOUS`                               | credential rotation中にAPIだけが追加で受理する旧値。通常は空にします。                           |
| `DATABASE_URL`                                             | SQLite DB URL。例: `file:./data/sqlite.db`                                                       |
| `RIOT_API_KEY`                                             | Backend APIが使用するRiot API key                                                                |
| `RIOT_DEFAULT_PLATFORM`                                    | Riot platform routing。例: `jp1`                                                                 |
| `RIOT_DEFAULT_REGION`                                      | Riot regional routing。例: `asia`                                                                |
| `MATCH_WATCH_POLL_INTERVAL_MS`                             | 試合監視のポーリング間隔                                                                         |
| `MATCH_WATCH_IN_GAME_NOTIFY_INTERVAL_MS`                   | 試合中通知の更新間隔                                                                             |
| `MATCH_WATCH_RESULT_FETCH_TIMEOUT_MS`                      | 試合終了後の結果取得タイムアウト                                                                 |
| `MATCH_WATCH_MAX_ENABLED_PER_GUILD`                        | ギルドごとの有効監視対象数上限                                                                   |
| `RIOT_RATE_LIMIT_SHORT_WINDOW_LIMIT`                       | Backend API内のRiot共有キューの短期window上限。Personal Key既定値: `20`                          |
| `RIOT_RATE_LIMIT_SHORT_WINDOW_MS`                          | Backend API内のRiot共有キューの短期window。Personal Key既定値: `1000` ms                         |
| `RIOT_RATE_LIMIT_LONG_WINDOW_LIMIT`                        | Backend API内のRiot共有キューの長期window上限。Personal Key既定値: `100`                         |
| `RIOT_RATE_LIMIT_LONG_WINDOW_MS`                           | Backend API内のRiot共有キューの長期window。Personal Key既定値: `120000` ms                       |
| `RIOT_STATIC_DATA_CACHE_TTL_MS`                            | Riot static data cacheのTTL                                                                      |
| `OPGG_ENABLED`                                             | Backend APIのOP.GG試合詳細連携を有効化する                                                       |
| `API_MESSAGE_LANG` / `BOT_MESSAGE_LANG`                    | API / Botのメッセージ言語                                                                        |
| `BOT_MESSAGE_THEME`                                        | Botメッセージテーマ                                                                              |
| `RSO_CLIENT_ID` / `RSO_CLIENT_SECRET` / `RSO_REDIRECT_URI` | Riot Sign On連携設定                                                                             |

## ローカル起動

依存関係はDenoがtask実行時に解決します。

```bash
deno task db:push
deno task dev:deploy-commands
deno task dev:all
```

`db:push` は対象DBへschemaを反映し、`dev:deploy-commands` は `.env.dev` の認証情報でDiscordへslash commandを登録する状態変更操作です。ローカル開発用の対象DBを確認してから実行してください。

APIのみ、Botのみを起動する場合は次を使います。

```bash
deno task dev:api
deno task dev:bot
```

Backend APIは既定で `http://localhost:8000` に公開されます。

## Deno Tasks

| Task                  | Description                                                                   |
| --------------------- | ----------------------------------------------------------------------------- |
| `dev:all`             | APIとBotを開発モードで起動します。                                            |
| `dev:api`             | APIのみ開発モードで起動します。                                               |
| `dev:bot`             | Botのみ開発モードで起動します。                                               |
| `dev:deploy-commands` | `.env.dev` を使ってslash commandを登録します。                                |
| `deploy-commands`     | `.env` を使ってslash commandを登録します。                                    |
| `fmt:check`           | フォーマット差分を確認します。                                                |
| `lint`                | Deno lintを実行します。                                                       |
| `check`               | 主要entrypointの型チェックを実行します。                                      |
| `test:all`            | `.env.example` を読み込み、coverage付きで全テストを実行します。               |
| `test:riot-live`      | 実Riot APIで疎通確認を行います。通常はopt-inで使用します。                    |
| `quality`             | root `deno.json` のdependenciesに定義された品質確認をまとめて実行します。     |
| `check:bot-boundary`  | Bot runtimeからBackend実装・DB・外部I/Oへ直接依存していないことを確認します。 |
| `check:messages`      | メッセージ定義の整合性を確認します。                                          |
| `db:push`             | Drizzle schemaをDBに反映します。                                              |
| `db:generate`         | Drizzle migrationを生成します。                                               |
| `db:migrate`          | Drizzle migrationを適用します。                                               |

## Docker

### Development

開発用コンテナはソースを `/app` にマウントし、Deno cacheをDocker volumeに保持します。コンテナ起動時にアプリケーションは自動開始しないため、必要なtaskを `docker compose exec` で実行します。

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

本番profileはAPIとBotを分けて起動し、APIのhealthcheck成功後にBotを起動します。DBは `prod-db-data` volumeの `/app/data/sqlite.db` に保存されます。

起動前にDiscord tokenやRiot API keyとは別のcredentialを生成し、`BOT_SERVICE_TOKEN`へ設定します。例えば `openssl rand -hex 32` で64文字のランダム値を生成できます。値をshell history、ログ、Issue、テスト出力へ貼り付けないでください。

```bash
docker compose --profile prod up -d --build
docker compose --profile prod logs -f
docker compose --profile prod down
```

#### ログ、保持、閲覧権限

APIとBotのアプリケーションログはstdoutへ出力する1行JSONだけを正本とし、コンテナ内のlog fileへは書き込みません。すべてのrecordは`timestamp`, `level`, `event`, `component`を持ち、ERRORは`correlationId`と`errorCategory`も持ちます。既知のcredential、token、cookie、OAuth code/state、SQL parameter、Riot ID / PUUID、Discord user IDはnested contextでもredactされます。自由記述のmessageへ秘密値を埋め込まず、provider response bodyをそのまま記録しないでください。

APIは安全な形式の`X-Correlation-ID`を受理して同じresponse headerへ返します。headerが欠落または不正な場合はUUIDへ置き換えます。request logのpathは識別子を含む実URLではなくroute templateです。問い合わせ時はresponse headerの相関IDを共有し、tokenやrequest bodyは共有しないでください。

production ComposeのAPI / BotはDockerの`local` logging driverを使い、各コンテナで`10 MiB`、最大`5`世代にrotationします。これはhost内の短期調査用であり、コンテナ削除後の保持や長期監査を保証しません。閲覧には次を使います。

```bash
docker compose --profile prod logs -f api bot
```

ログを閲覧できるのはDocker daemonへのアクセス権を持つ運用者に限定してください。Docker socketや`docker` groupへのアクセスはhost上の強い権限を伴うため、ログ閲覧だけを目的に安易に付与せず、取得したログもcredentialと同等に限定共有します。

production APIのport `8000` はhostの `127.0.0.1` だけへbindされ、外部networkへ直接公開されません。BotはDocker network内の `http://api:8000` を利用します。RSO callbackを外部から受ける場合は、同一hostのTLS reverse proxyから `/auth/rso/callback` だけを `http://127.0.0.1:8000` へ転送してください。Bot service routeをreverse proxyの公開対象へ追加しないでください。

Riot APIのrate limit queueとbucket stateはBackend API process内だけで共有されます。productionではBackend APIを1 processで稼働させてください。複数replicaや複数workerへ拡張する場合は、先に分散queueと共有rate-limit stateを設計する必要があります。

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

フォーマット差分がある場合は内容を確認してから `deno fmt` を実行し、その後に再度 `deno task fmt:check` を確認します。

## Git workflow

ブランチは `<type>/<kebab-topic>` 形式を使います。

commit messageは日本語のConventional Commits形式を使います。

```text
<type>[optional scope]: <description>

<背景・問題・判断理由・期待される効果・既知のリスク>
```

`type` は `feat`, `fix`, `refactor`, `perf`, `style`, `test`, `docs`, `build`, `ci`, `chore` を使います。`scope` は必要に応じて `api`, `bot`, `messages`, `db`, `docker` などを使います。
