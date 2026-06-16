# ADTeemo

![GitHub License](https://img.shields.io/github/license/akgm3i/ADTeemo)

## 概要

ADTeemo は League of Legends のカスタムゲーム運営を支援する Discord Bot です。

Discord 上でカスタムゲームイベントの作成、参加募集、ロール別リアクション集計、チーム分け、VC 移動、戦績記録、指定メンバーの LoL 試合監視を行います。構成は Discord Bot と Backend API の 2 コンポーネントで、Deno workspace と Docker で開発・実行できます。

## 主な機能

- Discord slash command による Bot 操作
- Riot ID の登録・更新と Riot Games アカウント連携
- ギルド別のメインロール登録
- Bot が利用する Discord ロールの検出・作成
- Discord スケジュールイベントと募集メッセージの作成
- 募集メッセージのリアクションをもとにしたチーム分け
- `Red Team` / `Blue Team` VC への参加者移動
- カスタムゲーム結果の手動記録
- 指定メンバーの LoL 試合開始・試合中・終了結果の監視通知
- API と Bot の health check

## Slash Commands

| Command                                                                     | Description                                                                                           |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/health`                                                                   | Bot と Backend API の稼働状況を確認します。                                                           |
| `/setup-roles`                                                              | `Top`, `JG`, `Mid`, `Bot`, `Sup`, `Custom` ロールを検出し、不足分を作成します。管理者権限が必要です。 |
| `/set-main-role role:<role>`                                                | 自分のメインロールをギルド別に登録します。                                                            |
| `/set-riot-id riot-id:<GameName#TagLine> [platform:<platform>]`             | Riot ID を登録・更新します。`platform` 未指定時は `jp1` を使います。                                  |
| `/link-riot-account`                                                        | Riot Games アカウント連携用 URL を取得します。RSO 設定が必要です。                                    |
| `/create-custom-game title:<title> date:<MM/DD> time:<HH:mm> voice:<voice>` | Discord スケジュールイベントを作成し、実行チャンネルに募集メッセージを投稿します。                    |
| `/cancel-custom-game`                                                       | 自分が作成した有効なカスタムゲームイベントを選択してキャンセルします。                                |
| `/split-teams`                                                              | 募集リアクションを集計し、2 チームへ分けて VC へ移動します。                                          |
| `/record-match winner:<BLUE\|RED>`                                          | 現在の参加者について KDA / CS / Gold を対話形式で入力し、戦績を記録します。                           |
| `/watch-match member:<member>`                                              | Riot ID 連携済みメンバーの LoL 試合を継続監視し、実行チャンネルへ通知します。                         |
| `/unwatch-match member:<member>`                                            | 指定メンバーの試合監視を停止します。                                                                  |

### `/split-teams` の現状制約

- コマンド実行者が作成した、今日開始のカスタムゲームイベントを対象にします。
- コマンドは募集メッセージが投稿されたテキストチャンネルで実行してください。
- 参加者は合計 10 人である必要があります。
- 各ロールのリアクション参加者は 2 人ずつである必要があります。
- ギルド内に `Red Team` と `Blue Team` という名前のボイスチャンネルが必要です。

## 技術構成

| Area        | Stack                                           |
| ----------- | ----------------------------------------------- |
| Runtime     | Deno 2.5+, TypeScript                           |
| Backend API | Hono RPC                                        |
| Database    | SQLite, Drizzle ORM                             |
| Discord Bot | discord.js                                      |
| Messages    | `messages` workspace の言語・テーマ別メッセージ |
| Container   | Docker, Docker Compose                          |

## ディレクトリ構成

```text
.
├── api/       # Hono API、DB schema、Riot API 連携
├── bot/       # Discord Bot、slash command、Bot 側機能
├── messages/  # 多言語・テーマ別メッセージ
├── lib/       # 共通ライブラリ
├── docker/    # Dockerfile と healthcheck
└── drizzle/   # Drizzle migration
```

## 環境構築

### Requirements

- Deno 2.5 以上
- Docker / Docker Compose
- Discord Bot token と application client ID
- Riot API key

### Environment Files

`.env.example` をテンプレートとして利用できます。

```bash
cp .env.example .env.dev
cp .env.example .env
```

ローカル開発では `.env.dev`、本番 Docker では `.env` を使用します。

### 主要な環境変数

| Variable                                                   | Description                                                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `DISCORD_TOKEN`                                            | Discord Bot token                                                                                      |
| `DISCORD_CLIENT_ID`                                        | Discord application client ID                                                                          |
| `DISCORD_GUILD_ID`                                         | 指定時は guild command として slash command を登録します。未指定時は global command として登録します。 |
| `API_URL`                                                  | Bot から参照する Backend API URL                                                                       |
| `DATABASE_URL`                                             | SQLite DB URL。例: `file:./data/sqlite.db`                                                             |
| `RIOT_API_KEY`                                             | Riot API key                                                                                           |
| `RIOT_DEFAULT_PLATFORM`                                    | Riot platform routing。例: `jp1`                                                                       |
| `RIOT_DEFAULT_REGION`                                      | Riot regional routing。例: `asia`                                                                      |
| `MATCH_WATCH_POLL_INTERVAL_MS`                             | 試合監視のポーリング間隔                                                                               |
| `MATCH_WATCH_IN_GAME_NOTIFY_INTERVAL_MS`                   | 試合中通知の更新間隔                                                                                   |
| `MATCH_WATCH_RESULT_FETCH_TIMEOUT_MS`                      | 試合終了後の結果取得タイムアウト                                                                       |
| `MATCH_WATCH_MAX_ENABLED_PER_GUILD`                        | ギルドごとの有効監視対象数上限                                                                         |
| `API_MESSAGE_LANG` / `BOT_MESSAGE_LANG`                    | API / Bot のメッセージ言語                                                                             |
| `BOT_MESSAGE_THEME`                                        | Bot メッセージテーマ                                                                                   |
| `RSO_CLIENT_ID` / `RSO_CLIENT_SECRET` / `RSO_REDIRECT_URI` | Riot Sign On 連携設定                                                                                  |

## ローカル起動

依存関係は Deno が task 実行時に解決します。

```bash
deno task db:push
deno task deploy-commands
deno task dev:all
```

API のみ、Bot のみを起動する場合は次を使います。

```bash
deno task dev:api
deno task dev:bot
```

Backend API は既定で `http://localhost:8000` に公開されます。

## Deno Tasks

| Task                  | Description                                                                           |
| --------------------- | ------------------------------------------------------------------------------------- |
| `dev:all`             | API と Bot を開発モードで起動します。                                                 |
| `dev:api`             | API のみ開発モードで起動します。                                                      |
| `dev:bot`             | Bot のみ開発モードで起動します。                                                      |
| `dev:deploy-commands` | `.env.dev` を使って slash command を登録します。                                      |
| `deploy-commands`     | `.env` を使って slash command を登録します。                                          |
| `fmt:check`           | フォーマット差分を確認します。                                                        |
| `lint`                | Deno lint を実行します。                                                              |
| `check`               | 主要 entrypoint の型チェックを実行します。                                            |
| `test:all`            | `.env.example` を読み込み、coverage 付きで全テストを実行します。                      |
| `test:riot-live`      | 実 Riot API で疎通確認を行います。通常は opt-in で使用します。                        |
| `quality`             | `fmt:check` / `lint` / `check` / `check:messages` / `test:all` をまとめて実行します。 |
| `check:messages`      | メッセージ定義の整合性を確認します。                                                  |
| `db:push`             | Drizzle schema を DB に反映します。                                                   |
| `db:generate`         | Drizzle migration を生成します。                                                      |
| `db:migrate`          | Drizzle migration を適用します。                                                      |

## Docker

### Development

開発用コンテナはソースを `/app` にマウントし、Deno cache を Docker volume に保持します。コンテナ起動時にアプリケーションは自動開始しないため、必要な task を `docker compose exec` で実行します。

```bash
docker compose --profile dev up -d --build
docker compose exec dev deno task db:push
docker compose exec dev deno task dev:all
```

対話シェルを開く場合:

```bash
docker compose exec dev bash
```

Docker 内でテストを実行する場合:

```bash
docker compose --profile dev run --rm dev deno task test:all
```

停止する場合:

```bash
docker compose --profile dev down
```

### Production

本番 profile は API と Bot を分けて起動し、API の healthcheck 成功後に Bot を起動します。DB は `prod-db-data` volume の `/app/data/sqlite.db` に保存されます。

```bash
docker compose --profile prod up -d --build
```

ログ確認:

```bash
docker compose --profile prod logs -f
```

停止:

```bash
docker compose --profile prod down
```

## 品質確認

変更後は次を順に実行します。

```bash
deno task fmt:check
deno task lint
deno task check
deno task test:all
```

まとめて実行する場合:

```bash
deno task quality
```
