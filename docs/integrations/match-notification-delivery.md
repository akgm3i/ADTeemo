# 試合通知の配送と復旧

- Type: integration
- Status: current
- Summary: 通知intentと配送receiptを永続化し、Discord・DBの部分失敗から再開する。
- Read when: 試合通知の欠落、重複、pending停滞、Bot再起動を調査するとき。
- Related: [#99](https://github.com/akgm3i/ADTeemo/issues/99), [#116](https://github.com/akgm3i/ADTeemo/issues/116)
- Code: [delivery](../../bot/src/features/match_tracking_delivery.ts), [Discord境界](../../bot/src/features/match_tracking_notifier.ts), [repository](../../api/src/db/repositories/notification_deliveries.ts)
- Tests: [再起動と保存失敗](../../bot/src/features/match_tracking_delivery.integration.test.ts), [ARAM復旧](../../bot/src/features/match_tracking_recovery.test.ts), [leaseとbackoff](../../api/src/db/notification_deliveries.integration.test.ts)
- Reviewed: 2026-09-25
- Verified: local runtime tests, 2026-09-25; Discord実接続は未実施

## 配送単位と状態

通知intentはguild、channel、対象Discordユーザー、Riot account PUUID、通知種別、試合IDから安定したkeyを作る。進行通知には最後に保存済みの通知時刻も含める。同じkeyのprepareは初回payloadを維持し、別scopeでの再利用を拒否する。

outboxは正規化した試合ID、通知段階（active→pending→timeout→result）、段階内の世代を保持する。activeは同じguild/channel/試合で共有し、結果段階はaccountごとに順序を判定する。後続段階・世代があれば古いpendingを`failed / superseded`にする。prepareだけでなくclaimでも再確認する。異なる試合・guildの配送は失効させない。

結果投稿のmessage IDは、最初の結果段階intentのprepare transactionでaccountへ予約する。別accountが同じIDを要求した場合は新規投稿に切り替える。確定後のwatcherがIDLEになっても予約はoutboxに残る。同じ投稿・通知streamの有効leaseがある場合、後続配送は完了または期限切れを待つ。lease期限を超えて外部Discord処理が継続する分散実行まで、厳密な外部書込順序を保証するものではない。

Discord送信より先に`notification_deliveries`へintentを保存する。workerはleaseを取得してから送信し、成功時はmessage IDをreceiptとして保存する。その後でwatcherの現在状態・結果待ち状態を更新する。配送とwatcher更新は別のcommitであり、分散transactionやexactly-onceを保証するものではない。

| 配送状態                            | 次の動作                                                    |
| ----------------------------------- | ----------------------------------------------------------- |
| pending、期限到来、leaseなし        | leaseを取得して配送する                                     |
| pending、backoffまたは有効leaseあり | 待機する                                                    |
| delivered                           | receiptを再利用し、Discordへ再送せずwatcher更新を再試行する |
| failed                              | 自動配送を停止し、失敗理由を残す                            |

一時失敗と待機中は、そのwatcherの状態処理を中断する。他watcherの処理は続行する。恒久失敗はoutboxと`match_tracking.delivery_permanent_failure`に残し、通知成功時刻を進めず、結果待ちを解除して次の試合監視を続ける。

起動後と各tickで、期限到来済みのpending配送を再開する。lease期限、試行上限、指数backoffの正確な値はrepositoryとテストが正本である。workerが失敗記録前に終了した場合もlease期限後に回収でき、試行上限で停止する。

## Discord操作の再照合

既存message IDがあればeditする。message fetchやeditの通信失敗・権限不足を新規sendの理由にしない。DiscordがUnknown Messageを返した場合だけ投稿の消失として扱う。

新規sendはintent keyをnonceに使い、`enforceNonce`を指定する。ただしDiscord公式が説明するnonceの重複排除期間は数分に限られる。長時間停止後の保証には使わない。[公式Message API](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx)

投稿のembed footerには`ADTeemo delivery:<key>`を保持し、既存footerの内容も残す。送信後にreceiptを保存できなかった場合、intent作成時刻まで履歴をページングし、Bot自身が投稿した同じ識別子を回収する。一意に見つかればmessage IDを保存する。検索失敗、複数候補、識別子の欠落・投稿削除では再送せずreconciliation失敗として残す。その後に別の一時障害が重なっても送信結果の不確実性を保持する。

履歴のnonceは復旧に使わない。discord.js 14.22.1はnonceが再取得時に失われることを明記している。[公式Messageクラス](https://discord.js.org/docs/packages/discord.js/14.22.1/Message:Class)。nonceと`enforceNonce`は直後の重複送信防止だけに使う。テストの履歴もnonceをnullにして検証する。

### 既存DBの更新

[0010 migration](../../drizzle/0010_notification_order.sql)で順序情報の列を追加する。既存行のpayload・receiptは保持し、判定できない試合や段階を推測して埋めない。更新前のpendingはclaim時に`failed / ordering_unknown`として自動配送を停止する。順序情報も永続識別子もない旧配送は、Discord側の投稿とDBを確認して手動で照合する。保存済みのdelivered receiptは引き続き利用できる。本番・共有DBへの適用は別途運用手順に従う。

## 運用確認

読み取り調査は次で行う。共有・本番DBを変更する場合は対象とbackupを確認し、明示承認を得る。

```sql
SELECT key, guild_id, target_discord_id, riot_account_puuid, channel_id, status,
       message_id, attempts, next_attempt_at, lease_until, reason
FROM notification_deliveries
WHERE status <> 'delivered'
ORDER BY created_at;
```

`failed`行は自動削除しない。`watch_disabled`だけは、本人のopt-in等でwatcherが再び有効となり、現在のworkerが同じintentをprepareした場合に同nonceとattempt数で再開できる。過去attemptがあれば送信結果の不確実性を`reconciliation`で保持する。それ以外の恒久失敗を自動再登録しない。Discordの投稿と永続識別子を確認し、既存投稿の回収か新規配送が必要かを判断する。手動復旧には対象keyとDiscord側の確認結果を記録する。payload、外部応答本文、tokenを通常ログへ追加しない。

#99には報告時のログや完全な入力が残っていない。今回のARAMテストは、結果取得後の通知失敗・状態保存失敗と復旧を再現したもので、当時の原因を一意に特定した記録ではない。
