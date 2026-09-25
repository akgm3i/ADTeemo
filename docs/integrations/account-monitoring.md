# 複数account監視の運用と移行

- Type: integration
- Status: current
- Summary: メンバー同期、負荷上限、旧単一accountデータの移行と復旧条件。
- Read when: 監視を配備するとき、migration0009を適用するとき、membership障害を調べるとき。
- Related: [#34](https://github.com/akgm3i/ADTeemo/issues/34), [#48](https://github.com/akgm3i/ADTeemo/issues/48)
- Code: [membership同期](../../bot/src/features/match_watch_membership.ts), [Bot起動](../../bot/src/main.ts), [migration](../../drizzle/0009_lush_leo.sql)
- Tests: [membership tests](../../bot/src/features/match_watch_membership.test.ts), [migration tests](../../api/src/db/migrations.integration.test.ts), [policy tests](../../api/src/db/default_watch.integration.test.ts)
- Reviewed: 2026-09-25
- Verified: 2026-09-25、ローカルmigration・Bot/API integration。実Discord接続と共有DB適用は未実施。

## 配備条件とmembership

BotはGuild Members intentで完全なメンバー一覧を取得する。Discord Developer PortalでもServer Members Intentを有効にし、必要な承認条件を満たす。[Discord Gateway公式資料](https://docs.discord.com/developers/events/gateway#privileged-intents)を2026-09-25に確認した。運用設定は[CONTRIBUTING](../../CONTRIBUTING.md)、採用判断は[ADR 0006](../adr/0006-account-monitoring-policy.md)を参照する。

起動時は全guildの完全snapshotをAPIへ保存してから監視workerを始める。cacheの一部を完全なmembershipとして保存しない。起動前同期の失敗は30秒後に再試行する。保存済みwatcherのguildへBotが既に所属していない場合、そのmembershipを空にする。

参加・退出・guild復帰時も完全取得を行い、guildごとに取得と保存を順序化する。取得失敗時はmembershipを空にして停止し、guildごとに1つの30秒retryで回復する。Botのguild退出は以前のretryを取り消し、空snapshotの保存を再試行する。APIにも保存できない間は停止の確定を保証できないため、`watch.membership_*_failed`ログを確認する。

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
