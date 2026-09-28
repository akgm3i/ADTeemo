# 試合通知の配送と復旧

- Type: integration
- Status: current
- Summary: 通知intentと配送receiptを永続化し、Discord・DBの部分失敗から再開する。
- Read when: 試合通知の欠落、重複、pending停滞、Bot再起動を調査するとき。
- Related: [#99](https://github.com/akgm3i/ADTeemo/issues/99), [#116](https://github.com/akgm3i/ADTeemo/issues/116)
- Code: [delivery](../../bot/src/features/match_tracking_delivery.ts), [Discord境界](../../bot/src/features/match_tracking_notifier.ts), [repository](../../api/src/db/repositories/notification_deliveries.ts)
- Tests: [再起動と保存失敗](../../bot/src/features/match_tracking_delivery.integration.test.ts), [ARAM復旧](../../bot/src/features/match_tracking_recovery.test.ts), [leaseとbackoff](../../api/src/db/notification_deliveries.integration.test.ts)
- Reviewed: 2026-09-28
- Verified: 2026-09-26、local runtime testsと分離した検証DB・実Discordで開始・進行・結果配送を確認。2guildのうち1投稿が確認中へ戻る不整合を観測し、保存済み結果で復旧後に両投稿をRESTで再取得して確認。Mayhemの結果取得拒否は、修正版workerによる2guildの取得不可通知と結果待ち解除まで確認。2026-09-28、0012適用、保存済み観測値を補足する2投稿の更新とDiscord REST再取得を確認。観測値の保存・再起動・連戦は自動テストで検証。修正後の新しい実試合の結果配送と通信障害時の実Discord再照合は未検証。

## 配送単位と状態

通知intentはguild、channel、対象Discordユーザー、Riot account PUUID、通知種別、試合IDから安定したkeyを作る。進行通知には最後に保存済みの通知時刻も含める。同じkeyのprepareは初回payloadを維持し、別scopeでの再利用を拒否する。

outboxは正規化した試合ID、通知段階（active→pending→timeout / unavailable→result）、段階内の世代を保持する。activeは同じguild/channel/試合で共有し、結果段階はaccountごとに順序を判定する。後続段階・世代があれば古いpendingを`failed / superseded`にする。prepareだけでなくclaimでも再確認する。異なる試合・guildの配送は失効させない。

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

## 終了検知時の通知順序

終了検知時は、確認中を投稿する前に結果を取得する。取得済みなら既存の進行投稿を結果へ直接更新し、同じ投稿を同tickで「確認中→結果」と連続編集しない。期限切れも直接通知する。未確定または取得失敗の場合だけ確認中を通知し、その実際のmessage IDと結果待ちを保存する。新試合が始まっている場合も、旧試合の結果には同じ規則を適用し、新試合の状態を保持する。

2026-09-26の実測では、2guildともresultのreceiptがdeliveredだったが、一方の投稿には前段階のpending識別子と確認中のembedが残っていた。結果データと各guildの保存済み投稿IDは正常だった。Discordにも[短時間のembed編集が古い内容へ戻る報告](https://github.com/discord/discord-api-docs/issues/7980)があるが、今回のDiscord内部の原因まで特定したわけではない。不要な連続編集を除去し、2guild・連戦で投稿ごとに結果更新が1回となることをテストで固定する。

既存の不整合は、投稿が対象のpending識別子を保持していることを確認してから、同じ投稿へ保存済みresult payloadと識別子を適用して復旧した。時間を置いたREST再取得で両guildの結果識別子と結果表示を確認した。deliveredはDiscord操作の成功応答とreceipt保存を表し、その後も最新embedが保持されることを継続的に照合する状態ではない。再発時はDBだけで成功と判断せず、Discordから投稿を再取得して識別子を照合する。

## Riotによる結果取得の拒否

2026-09-26、実試合`JP1_604299462`（Spectator由来の表示: ARAM: Mayhem / KIWI）で終了検知後のMatch-v5が403を返し、両guildが確認中で待機した。同じキー・regionで前のランク試合は200、直近試合一覧も200で、当該試合は一覧に含まれなかった。Riotの[該当Issue](https://github.com/RiotGames/developer-relations/issues/1109#issuecomment-3671793822)でもMayhemの試合は非公開と説明され、Issueは`closed: is working`で閉じられている。今後の提供状況が変わる場合は再確認する。通常ARAMまで非対応と判断しない。

結果検査の`RIOT_MATCH_ACCESS_DENIED`では、確認中ではなく取得不可を既存投稿へ通知する。outboxの`unavailable:<matchId>`はtimeoutと同じstage 2とし、結果のstage 3とは区別する。通知成功後にその試合の結果待ちだけを解除し、新試合の状態と継続監視は保持する。通知が一時失敗すれば結果待ちを保持して既存の配信再試行を使う。通信失敗・429・5xxはこの終端扱いにせず、従来の結果取得再試行を続ける。

2026-09-26 15:31 JST、修正版API/Botの通常workerで両guildの取得不可通知が各1回でdeliveredとなり、REST再取得で拒否理由の表示と配送識別子の一致を確認した。両watcherの結果待ちは解除され、監視は有効のままIDLEへ戻った。試合の勝敗や戦績が取得できたという意味ではない。

Mayhemでは取得できた勝敗・戦績を表示する。Match-v5のKIWIだけは参加者戦績の部分欠損を受け入れ、未取得値を0や敗北へ変換しない。勝敗が不明、対象参加者が不在、結果取得拒否、取得期限超過の場合は、Mayhemの試合であることと結果取得不可を表示し、判明しているチャンピオン・試合時間だけを添える。結果APIの値を優先し、未取得なら試合中の観測値を使う。観測由来の時間は最終確認時点の分数と概算であることを明記し、結果待ち時間を加算しない。両方とも不明ならタイトルと取得不可の説明だけにする。メンション、試合ID、timestampは付けない。通常モードの結果入力契約は従来通り完全な戦績を要求する。部分戦績の受け入れはfixtureで検証しており、この実試合で勝敗が取得できたという意味ではない。

開始・進行時にSpectatorから取得した`gameMode`を`currentGameMode`へ保存し、終了時は`pendingResultGameMode`へ移す。これにより、再起動や次試合の開始後も取得不可となった試合のモードを判定する。[0011 migration](../../drizzle/0011_match_watcher_game_modes.sql)は既存の監視・投稿IDを保持し、既存の不明なモードはnullのままにする。過去の結果拒否を一律Mayhemへ分類しない。

Mayhemの試合中は、対象PUUIDのチャンピオンIDと確認できた経過秒数を`currentGameObservation`へ保存し、終了時に`pendingResultObservation`へ移す。進行通知を出さないpollでも観測値を更新する。同じ試合で取得済みの値は保持し、次試合の観測値を旧試合の結果へ混ぜない。[0012 migration](../../drizzle/0012_match_game_observations.sql)は既存の状態・投稿ID・モードを保持し、観測値の初期値をnullとする。既存データから自動で推測はしない。再起動、2guild、結果待ち後の拒否と成功、連戦時の分離を自動テストで確認している（2026-09-28）。

2026-09-26 16:30 JST、0011適用と修正版API/Botの起動後、上記の既存Mayhem投稿2件をstage 2 / revision 1の修正intentとして登録した。旧intentとreceiptは保持し、通常workerが各1回のeditでdeliveredにした。Discord REST再取得では、タイトルと取得不可の説明だけで、footer・追加field・timestampがないこと、タイトルURLの配送識別子が保持されることを確認した。両watcherは監視有効・IDLE・結果待ちなしを維持した。再確認のMatch-v5は当該Mayhemが403、前の通常試合が200だった。修正版で次の実試合を開始から終了まで追う検証は未実施であり、モード保持・部分戦績・連戦は自動テストによる検証である。

2026-09-28、0012適用前に分離検証DBをbackupし、API/Botを更新した。既存Mayhem試合のstage 0 payloadには両guildとも「ポッピー」、最終経過時間は17分と13分が保存されていた。同じPUUID・試合であることと全観測のチャンピオンが一致することを確認し、共有できる最新の17分を使って既存2投稿に補足した。これは当該試合だけの手動復旧であり、通常処理が過去embedを解析するものではない。stage 2 / revision 2のintentを各1回で配送し、Discord RESTで「ポッピー」「試合時間（概算）: 約17分（最終確認時点）」と配送識別子の一致を確認した。旧intent・receiptは保持し、両watcherは有効・IDLE・結果待ちなしを維持した。新実装で新しい実試合の観測から結果まで通す確認は未実施。

403はAPIキーや権限でも起き得るため、開始時のモードがMayhemと確認できない場合はRiotによるアクセス拒否までを述べる。複数の通常試合でも発生する場合はキーとアクセス権を確認する。取得拒否した過去試合の自動再取得は行わず、必要ならoutboxの試合ID・通知状態を確認して復旧を判断する。

## Discord操作の再照合

既存message IDがあればeditする。message fetchやeditの通信失敗・権限不足を新規sendの理由にしない。DiscordがUnknown Messageを返した場合だけ投稿の消失として扱う。

新規sendはintent keyをnonceに使い、`enforceNonce`を指定する。ただしDiscord公式が説明するnonceの重複排除期間は数分に限られる。長時間停止後の保証には使わない。[公式Message API](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx)

投稿のembed footerには`ADTeemo delivery:<key>`を保持し、既存footerの内容も残す。footerとURLのない簡潔な通知では、タイトルを投稿先チャンネルへのリンクにし、URL fragmentに同じ識別子を保持して本文を増やさない。履歴照合は従来のfooterとURL fragmentの両方を扱う。送信後にreceiptを保存できなかった場合、intent作成時刻まで履歴をページングし、Bot自身が投稿した同じ識別子を回収する。一意に見つかればmessage IDを保存する。検索失敗、複数候補、識別子の欠落・投稿削除では再送せずreconciliation失敗として残す。その後に別の一時障害が重なっても送信結果の不確実性を保持する。

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
