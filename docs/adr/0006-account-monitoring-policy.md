# ADR 0006: Riot identityとサーバーごとの既定監視

- Type: adr
- Status: accepted
- Summary: Riot accountはPUUID単位で所有し、全登録アカウントを監視、カスタムゲームはメインだけを使う。
- Read when: account所有権、メイン選択、監視scope、通知groupを変更するとき。
- Related: [#89](https://github.com/akgm3i/ADTeemo/issues/89), [#48](https://github.com/akgm3i/ADTeemo/issues/48), [#34](https://github.com/akgm3i/ADTeemo/issues/34)
- Code: [schema](../../api/src/db/schema.ts), [accounts repository](../../api/src/db/repositories/users.ts), [watchers repository](../../api/src/db/repositories/match_watchers.ts), [tracking service](../../bot/src/features/match_tracking_service.ts)
- Tests: [accounts](../../api/src/db/riot_accounts.integration.test.ts), [policy](../../api/src/db/default_watch.integration.test.ts), [multi-account tracking](../../bot/src/features/match_tracking_service_regression.test.ts)
- Reviewed: 2026-09-25
- Verified: 2026-09-25、migrated SQLiteとservice回帰。

## Context

Discordユーザー1人にRiot accountを1件だけ保持すると、複数アカウントの追加が上書きになる。監視通知とカスタムゲームの参加者選択は別の単位を必要とする。2026-09-25の3iの指定により、全登録アカウント監視、guildとDiscordユーザーの組でopt-out、カスタムゲームはメイン1件を採用した。

## Decision

PUUIDをaccountの一意identityとし、Discord所有者を保持する。別所有者への無条件付け替えを拒否する。同じ所有者の表示名更新ではidentityを増やさない。登録がある間はメインを1件に保ち、未指定のaccount取得はメインを返す。`users`のlegacy Riot列は複数accountの正本として更新しない。

guildの管理者が通知先と有効化を設定する。Botが同期した現在のmembershipに属する登録済み全accountを候補とし、本人のguild単位opt-outとアカウント数上限を適用する。本人停止を代理watch登録で解除しない。

watcherの永続identityはguildとPUUID、API処理ではDiscord所有者も照合する。cache、状態保存、配送冪等key、共有通知の参加者をPUUIDで区別する。同一Discordユーザーの別accountが同じ試合にいても、開始通知には両account名を残し、結果は個別に保存・通知する。opt-out、退出、解除で待機中配送を止め、prepareとclaimの境界でも現在のwatcherを照合する。

## Consequences

全accountはRiot APIの負荷を増やすため、既存の共有queueに加えてguildの有効account数を制限する。上限は人ではなくaccountで数え、管理操作の応答に除外数を返す。Discordメンバーの完全同期にはGuild Members intentが必要で、同期前に保存済みworkerを再開しない。

手入力Riot IDの公式照合はアカウントの存在確認であり、本人所有の暗号学的証明ではない。RSOによる本人認証の成立条件は[RSO運用](../integrations/rso.md)で扱う。Discord Connection idを未検証のままPUUIDとして保存しない。

## Rejected alternatives

メインだけを監視する案とaccountごとのopt-outは今回の指定と異なるため採用しない。`users.riotId`への最終登録の複製は、メインと一致しない別の正本を作るためやめる。旧代理watch/unwatchのruntime提供は本人設定と競合するため終了し、内部APIは移行互換として残す。

## Enforcement

所有権・メイン・移行は実SQLite integration、Bot→APIの契約は[policy縦断](../../tests/integration/watch_policy.integration.test.ts)、同一ユーザー複数accountと共有投稿はservice回帰で保証する。[利用ガイド](../user/riot-accounts-and-monitoring.md)と[移行・運用](../integrations/account-monitoring.md)を併せて更新する。
