# Botのproduction実行権限

- Type: integration
- Status: current
- Summary: Bot起動とcommand配備のDeno permission、必要な理由、offline検証の範囲。
- Read when: Botの依存・外部通信・環境変数・動的import・Docker起動を変更するとき。
- Related: [#88](https://github.com/akgm3i/ADTeemo/issues/88), [#69](https://github.com/akgm3i/ADTeemo/issues/69)
- Code: [permission profiles](../../bot/deno.json), [Dockerfile](../../docker/Dockerfile.prod), [Compose](../../docker-compose.yml), [root tasks](../../deno.json), [command同期](../../bot/src/deploy-commands.ts)
- Tests: [設定の接続](../../bot/production-permissions.test.ts), [offline検証runner](../../bot/check-production-permissions.ts), [権限の許可・拒否](../../bot/production-permissions-smoke.ts), [Bot起動](../../bot/runtime-permissions-smoke.ts), [command配備](../../bot/deploy-permissions-smoke.ts), [command同期回帰](../../bot/src/deploy-commands.test.ts)
- Reviewed: 2026-09-29
- Verified: 2026-09-26、Deno 2.5.7とlockfileの依存でoffline smoke、Docker内のprofile検証、Discord global commandの差分なし判定、実Bot起動・API認証・Gateway再接続とResume・slash command応答を確認。検証には既存DBと分離した新規DBを使用。2026-09-29、HTTP adapter追加後のBot/command配備profileをoffline smokeとqualityで確認。今回の実Discord・Docker起動は未実施。

## Profileと用途

許可値の正本はBot workspaceの `run:prod` / `run:deploy` task。DockerのBot CMD、Composeのcommand-deployer、rootの配備taskはこれらを使う。`run:prod` はComposeの `API_URL=http://api:8000` に合わせる。Backendのhostname/portを変更するときはpermission profileと検証も更新する。

| 権限                    | Bot起動                                           | command配備                                       | 必要な理由                                                                                                                |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| net                     | `discord.com:443`, `*.discord.gg:443`, `api:8000` | `discord.com:443`                                 | Discord REST、Botだけが使うGatewayとBackend API                                                                           |
| env                     | taskに列挙したBot設定・認証・監視設定・依存用変数 | 配備設定・Discord認証・message/logger・依存用変数 | `Deno.env` とnpm依存の `process.env` 参照。Backend credentialは配備側に許可しない                                         |
| read                    | Botの `src` と `messages` workspace               | 左記と `api/src/contract`・`lib/http`             | commandのdirectory列挙、動的importとその依存、言語・theme辞書。配備はcommand経由で純粋なAPI契約とHTTP adapterも動的に読む |
| write / sys / ffi / run | 付与しない                                        | 付与しない                                        | stdout loggerにfile書込は不要。SQLite・native addon・subprocessも使わない                                                 |

`env_file` にAPI用の変数が含まれていても、許可していない `DATABASE_URL`、Riot key、RSO credential等はBotから読めない。環境変数の値や全一覧はログへ出さない。

依存由来のenv参照は、固定されたdiscord.js / ws / undiciを実行して確認した。wsはoptional native optimizationの切替、undiciはcoverage・FinalizationRegistry・HTTP parserの切替変数を読む。BotのClient生成はshard設定の有無も確認する。これらは値が未設定でも読み取りpermissionが必要なため個別に許可している。GatewayのOS情報は `process.platform` から取り、sys permissionは不要だった。

## Gateway再接続とmodule読み込み

[Discord Gateway仕様](https://docs.discord.com/developers/events/gateway#resuming)では、再接続時にREADYで受け取った `resume_gateway_url` を使う。初回hostだけに固定すると再接続先を拒否し得るため、BotにはDiscord管理下の `*.discord.gg` の443番を許可する。Deno 2.5.7でsuffix wildcardの許可と、別domain・別portの拒否を確認した。`gateway*.discord.gg` のようなhostnameの部分wildcardは同runtimeで受理されない。配備にはGateway permissionを付与しない。

[Denoのpermissionモデル](https://docs.deno.com/runtime/fundamentals/security/)では、初期static module graphの読み込みはread permissionと別扱いになる。read制限だけをBackend実装のimport禁止保証とはしない。既存の `check:bot-boundary` がmain・配備・全有効commandのruntime graphからBackend実装とDB clientへの到達を検査し、permission smokeが実際のfile読み取り拒否を保証する。

2026-09-29のHTTP期限追加では、配備側の動的command importから`lib/http/buffered_fetch.ts`へ到達し、既存のread profileで拒否されることをoffline smokeが検出した。`run:deploy`だけに`lib/http`の読み取りを追加し、API実装・DB・秘密envへの権限は追加しない。Bot本体では同moduleが初期static graphへ含まれるため、`run:prod`のread許可は従来どおりで足りる。

productionは `--cached-only --frozen --no-prompt` を使う。依存はDocker buildまたは `deno install --frozen=true` で取得し、実行時にmoduleをnetworkから取得したり、足りないpermissionを対話で追加したりしない。開発Botのwatch taskは別の権限設定を維持する。

## Offline検証と再確認条件

`deno task check:bot-permissions` は通常の `quality` とCIから実行する。親のenvは継承せず、現在のDeno cache位置、`.env.example`、dummy service credentialだけで子processを作る。productionと同じtaskを使い、Botと配備を別々のmodule graphで型検証・実行する。

許可されたhost/portをpermission queryで確認し、他の通信先、DB file、Backend実装、`.env`、API用credentialの読み取りが拒否されることを確認する。その後network permissionを取り消し、実commandの動的読込・全catalogの読込・Bot起動・配備orchestrationを実行する。Discordのlogin / REST送信境界だけを置き換えるため、実際のcommand登録やDiscord/Riotへの通信は行わない。

このsmokeはDiscord認証、TLS/WebSocketの実接続、READY後のイベント配送や再接続の成功を保証しない。本番Dockerの起動・command配備も別途明示する運用操作である。

Deno / discord.js / ws / undici更新、Botが読むenv・catalog・command依存の追加、Backend接続先変更時はprofileとsmokeを再確認する。DiscordがGatewayのdomainを変更した場合は公式仕様と実際の接続先を確認してprofileを更新する。失敗を解消するためだけに `-A`、無制限のnet/env/read、sys/ffiを追加しない。

## 実配備で観測したcommand応答

2026-09-26、Docker command-deployerの実行結果で `publish_result_validation_failed` を観測した。登録済みcommandをGETだけで調べると、Discordが空の `options` を省略し、`contexts` でDMを含めないcommandには未指定の旧 `dm_permission` を `false` として返していた。これを別定義と判断していたことが、不要な再PUTと配備後の誤エラーの原因だった。

[Discordのcommand構造](https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-structure)では `options` は省略可能で、`dm_permission` は `contexts` を使うため非推奨になっている。比較では省略された `options` を空配列として扱い、明示した `contexts` がある場合だけ未指定の `dm_permission` を比較から除く。明示された公開範囲の違いや、期待するoptionの欠落は引き続き差分・検証失敗とする。

修正後は実際のglobal commandをGETし、PUTを禁止した依存で `unchanged` を確認した。自動回帰はGET比較とPUT応答検証の両方を扱う。調査時の再配備・command更新は行っていない。

## DockerとDiscordでの実接続確認

2026-09-26、Compose project `adteemo-permission-test` の新規DBで本番用Botイメージを起動した。既存の `adteemo_prod-db-data` は使用せず、実際のBot tokenとAPI service credentialで以下を確認した。

- イメージ内で `check:bot-permissions` が成功し、通常の `run:prod src/main.ts` で `bot.ready` に到達した。
- Botからの認証付きAPI呼び出しは200、認証なしの保護routeは401になった。
- 診断用wrapperで接続イベントだけを記録し、BotのDocker networkを95秒切断した後、新規Gateway接続による復旧を確認した。この試行では `shardResume` は観測しなかった。
- 別の試行ではSDKのResume処理を一度起動し、`gateway-us-east1-b.discord.gg` への接続と `shardResume` を確認した。初回接続先は `gateway.discord.gg`。permission profileは通常Botと同一で、追加のnet permissionは付与していない。
- 利用者がDiscordから `/health`、`/riot-accounts`、`/watch-list` を実行して正常応答を確認した。Riot ID登録のAPI応答204も観測した。

実接続で見つかった初期membership二重取得の修正は[account監視の運用](./account-monitoring.md)に記録する。試合開始・終了に伴う通知配送は別の検証範囲であり、上記の成功だけでは保証しない。診断wrapperは一時ファイルで、production entrypointには含めない。
