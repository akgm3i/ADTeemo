# 複数account監視の運用と移行

- Type: integration
- Status: current
- Summary: メンバー同期、負荷上限、旧単一accountデータの移行と復旧条件。
- Read when: 監視を配備するとき、account移行を適用するとき、membership障害を調べるとき。
- Related: [#34](https://github.com/akgm3i/ADTeemo/issues/34), [#48](https://github.com/akgm3i/ADTeemo/issues/48)
- Code: [membership同期](../../bot/src/features/match_watch_membership.ts), [Bot起動](../../bot/src/main.ts), [account migration](../../drizzle/0009_lush_leo.sql), [routing migration](../../drizzle/0013_canonical_riot_platforms.sql)
- Tests: [membership tests](../../bot/src/features/match_watch_membership.test.ts), [起動イベント回帰](../../bot/src/main_membership.test.ts), [migration tests](../../api/src/db/migrations.integration.test.ts), [policy tests](../../api/src/db/default_watch.integration.test.ts)
- Reviewed: 2026-09-29
- Verified: 2026-09-26、ローカルmigration・Bot/API integrationと、分離した検証DBでの実Discordメンバー同期・worker起動を確認。共有DB適用は未実施。2026-09-29、membershipの偽時計・manual schedulerと実Bot client→Hono→一時SQLite、routing migrationの保持を確認。今回の実Discord/Riot疎通は未実施。

## 配備条件とmembership

BotはGuild Members intentで完全なメンバー一覧を取得する。Discord Developer PortalでもServer Members Intentを有効にし、必要な承認条件を満たす。[Discord Gateway公式資料](https://docs.discord.com/developers/events/gateway#privileged-intents)を2026-09-25に確認した。運用設定は[CONTRIBUTING](../../CONTRIBUTING.md)、採用判断は[ADR 0006](../adr/0006-account-monitoring-policy.md)を参照する。

起動時は `ClientReady` で全guildの完全snapshotをAPIへ保存してから監視workerを始める。READY前の `GuildAvailable` では取得せず、初期同期との二重取得を避ける。cacheの一部を完全なmembershipとして保存しない。起動前同期の失敗は30秒後に再試行する。保存済みwatcherのguildへBotが既に所属していない場合、そのmembershipを空にする。

完全snapshotの確立後は、Gatewayの参加・退出差分をローカルの一覧へ反映してAPIへ保存する。参加・退出のたびに全件取得しない。初期取得中の差分も記録し、取得結果へ反映してから保存する。`Partials.GuildMember`を有効にし、まだcacheへ入っていない退出者のイベントも処理する。

全件取得は起動・guild参加/復帰で行い、同じguildの要求を集約する。取得開始間隔は少なくとも30秒空け、Gatewayの[RATE_LIMITED](https://docs.discord.com/developers/events/gateway-events#rate-limited)に含まれる`retry_after`（秒）も待機期限へ反映する。別guildの同期は独立して進む。初期再試行でも完全snapshotが取得・保存済みのguildを再取得しない。

取得失敗・guild unavailableでは未知のmembershipを空として保存し、退出者の監視を継続しない。取得失敗はguildごとに1つのretryで回復し、API保存だけの失敗は最新の一覧を再送する。Botのguild退出は以前の世代の取得結果・retryを破棄し、空snapshotの保存を再試行する。Discord取得待ちは保存queueを保持せず、退出の空保存を待たせない。APIにも保存できない間は停止の確定を保証できないため、`watch.membership_*_failed`ログを確認する。

## 上限と設定

新規guildは通知先未設定で停止する。管理者が`/watch-settings`で有効化すると、そのguildの所属者の全登録accountから本人opt-outを除いた候補を監視する。`MATCH_WATCH_MAX_ENABLED_PER_GUILD`の正確な既定値・制約は[設定](../../api/src/db/actions.ts)を正とし、account数で適用する。Discord IDとPUUIDの順で決定的に選び、上限外件数を設定応答へ返す。

RiotのリクエストqueueはAPI process共有、Botのtickはbudgetに従う。ギルドごとに監視を停止・通知先を変更した場合、旧channel宛てpending配送を失敗扱いにして、新しい設定の配送と混ぜない。本人が再びopt-inして現在のworkerから同じintentが要求された場合だけ、`watch_disabled`配送を同じnonce・attempt数のまま再開する。過去の送信結果が不明なら`reconciliation`を維持する。receiptと再試行は[通知配送](./match-notification-delivery.md)の責務である。

## 旧データ移行

migration0009は旧accountをメインとして保持し、watcherへそのPUUIDを結び付ける。進行中game・pending result・メッセージIDなどの状態は保持する。既存の無効watcherはguildと本人のopt-outへ移す。

旧guild内の通知先が1つならそのchannelを設定し、複数なら自動で選ばずguild監視を無効にする。管理者が`/watch-settings`で通知先を決めてから再開する。移行時membershipは旧watcherから仮に引き継ぎ、Bot起動時の完全同期で置き換える。

別ユーザーに同じPUUIDが登録されている場合、所有者を推測して片方を削除しない。移行はtransactionごと失敗し旧データを残す。accountのないwatcherも同様に移行を止める。適用前に読み取りで次を確認し、対象者を確認してから別途解消する。

```sql
SELECT puuid, COUNT(*) FROM riot_accounts GROUP BY puuid HAVING COUNT(*) > 1;
SELECT w.guild_id, w.target_discord_id
FROM match_watchers AS w LEFT JOIN riot_accounts AS a
  ON a.discord_id = w.target_discord_id
WHERE a.puuid IS NULL;
```

`users`のlegacy Riot列だけに残った古い登録は、gameName/tagLine/platformを推測で作らないためcanonical accountへ自動移行しない。本人が`/set-riot-id`で公式照合して再登録する。migration生成と一時DBへの検証だけを行っており、本番・共有DBには適用していない。共有DBの適用は対象とbackupを確認した運用操作として扱う。

## PH2・TH2のrouting移行

2026-09-29に[Riot公式Routing Values](https://support-developer.riotgames.com/hc/en-us/articles/22698698001939-League-of-Legends)でPH2・TH2のSG2統合を再確認した。新規登録可能なplatform、regional routing、provider変換は[純粋なrouting定義](../../api/src/contract/riot_routing.ts)を正本とする。Botの選択肢とAPI入力は現行platformだけを受理し、regionはplatformから導出する。環境既定値と移行前に発行したRSO stateも登録保存前にcanonical化する。登録用のregionは`RIOT_DEFAULT_PLATFORM`から導出し、独立した`RIOT_DEFAULT_REGION`設定は使用しない。将来の追加時はこの定義と契約テスト・command登録差分を見直す。

[データmigration0013](../../drizzle/0013_canonical_riot_platforms.sql)は`riot_accounts`のPH2/TH2だけをSG2/SEAへ変更し、PUUID、Discord所有者、メイン指定、表示名、時刻を保持する。旧accountに結び付くwatcherに`currentGameId`があり`currentMatchId`がなければ、移行前platformとgame IDから元の試合IDを確定してからaccountを変更する。既存のcurrent/pending match IDや通知IDをSG2へ文字列置換しない。

過去match、pending/final rank snapshot、外部詳細、outboxのpayload・lease・receiptは更新しない。結果検査は保存済み試合IDを引き継ぎ、そのprefixに対応するplatformで旧pending snapshotを参照する。新しい試合の観測は現在のaccount routingを使う。この保持と再適用の冪等性は[migration tests](../../api/src/db/migrations.integration.test.ts)で一時SQLiteを使って検証している。旧endpointの実応答や実際の過去試合取得可否は実通信未検証であり、特定のHTTP statusを想定した移行は行わない。

配備時は次の順で適用する。本番・共有DBへの操作とDiscord command登録は、この実装変更に含まれない。

1. 対象DB、Bot/APIの停止範囲、backupの復元方法を確認する。BotとAPIを停止し、DB全体を整合した状態でbackupする。
2. 適用前に`riot_accounts`のplatform別件数と、旧platformに関連するwatcher・pending snapshot・通知receiptの件数を控える。個人識別子を共有ログへ出さない。
3. 対象を明示して通常のmigration手順を実施する。`db:push`で既存履歴を代替しない。
4. accountにPH2/TH2が残らず、PUUID・所有者・main指定と履歴件数が変わらないことを確認する。旧試合IDは残っていてよい。
5. 新API/Botを同じ変更で起動し、初回membership同期と監視を確認する。`/set-riot-id`のplatform選択肢を更新するcommand登録を別途実施する。

移行失敗や保持対象の差異があれば起動せず調査する。旧accountの所属を履歴だけから逆算して戻さず、rollbackが必要なら稼働前backup全体と対応する旧アプリへ戻す。外部サービス仕様、routing、試合ID契約が変わる場合は公式資料と移行テストを再確認する。

## 起動時の重複取得の観測

2026-09-26、実Discord接続で `GuildAvailable` と `ClientReady` が同じguildのメンバー一覧を続けて要求し、後者が `GuildMembersTimeout` になることを観測した。30秒後の再試行は成功し、workerのAPI呼び出しが始まった。

[Discord公式のrate limit変更](https://docs.discord.com/developers/change-log#introducing-rate-limit-when-requesting-all-guild-members)では、全メンバー要求は同一guild・Botにつき30秒に1回に制限される。固定したdiscord.jsでは初期 `GuildAvailable` がREADYより前に発火するため、この段階は `ClientReady` の完全同期へ任せる。READY後のguild復帰では従来どおり再同期する。イベントの順序やmember取得APIを変更する際は、この二重取得とworker開始までを再確認する。

修正後は通常のDocker entrypointでREADYから約0.7秒以内に2guildのsnapshot保存とworker初回tickを確認した。検証DBは本番・共有DBと分離しており、共有DBへのmigration適用結果ではない。

## 廃止した補助処理と保持する互換性

#152で旧`users.riotId`更新関数と自己更新だけの通知account mapを削除した。canonicalなaccount連携、旧列のデータ、移行client用`upsertMatchWatcher`は維持する。Bot/APIで使うrank変換は共有contractへ集約済みであり、削除対象ではない。参照根拠と旧テスト保証の移管先は[整理記録](../record-match-consistency.md#旧実装の整理と互換性)を参照する。
