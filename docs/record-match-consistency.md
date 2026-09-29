# カスタム戦績の整合性と移行

- Type: integration
- Status: current
- Summary: カスタム戦績の入力継続、transaction、冪等性、旧実装とデータの扱い。
- Read when: 戦績記録・再送・migration・roster変更時。
- Related: [#113](https://github.com/akgm3i/ADTeemo/issues/113)
- Code: [match repository](../api/src/db/repositories/matches.ts)
- Tests: [repository tests](../api/src/db/repositories.integration.test.ts), [vertical tests](../tests/integration/custom_match_recording.integration.test.ts)
- Reviewed: 2026-09-29
- Verified: 2026-09-29、偽時計による15分超の入力と実Bot・Hono・一時SQLiteの保存/再送を確認。実Discordと本番DBは今回未検証。

## 目的

カスタム戦績は、1試合につき `matches` 1行と `match_participants` 10行を同じDB transactionで保存する。この文書は、イベントとの対応、再送時の冪等性、失敗時のrollback、および旧データを安全に移行する手順を定める。

イベント作成・取消の外部side effectは[カスタムゲームイベントの整合性と復旧](./custom-game-event-consistency.md)を参照する。

## 記録単位とscope

カスタム戦績の冪等性keyは `eventId + gameSequence` である。`gameSequence` はイベント内の1始まりのゲーム番号とし、正整数だけを受け付ける。保存するmatch IDは `custom:<eventId>:<gameSequence>` から決定的に生成する。

`/record-match` の `game` optionは任意で、省略時は1、指定時はその正整数を変更せず `gameSequence` に渡す。記録時には既存戦績の最大値から自動採番しない。`/next-game`は最大番号+1を案内する読み取り操作であり、番号の予約や戦績保存はしない。主催者は同じゲームの初回送信と再送で同じ番号を使い、次ゲームでは2、3のように明示する。

イベントの参照は `eventId + guildId + recruitmentChannelId` の全項目を照合する。別guildや別募集チャンネルのイベントへ、IDだけで戦績を追加することはできない。

## 保存前の不変条件

routeとrepositoryはDB transactionを始める前に、`gameSequence` が正整数であること、statsが重複のないちょうど10 user分であること、各statsが非負整数であることを検証する。

入力構造の検証後、APIは1つのtransaction内で次のDB依存条件を検証する。

1. scopeに一致するイベントが存在する。
2. 新しいkeyを保存する場合、イベントが `RECRUITING / CONSISTENT` である。
3. イベントへ確定保存済みの参加者がちょうど10人いる。
4. requestのstatsが重複のない10 user分で、確定参加者集合と完全一致する。
5. 同じkeyの既存matchがない新規保存では、10人全員にcanonical Riot accountが存在する。

requestが持つ各userの値はkills、deaths、assists、CS、Goldだけである。teamとlaneはイベントの確定roster、winはrequestのwinner、`riot_puuid` は保存時のcanonicalなメインRiot accountからAPIが導出する。呼出元の表示や一時状態を正本にしない。

通常のマッチングは`POST /events/:eventId/participants/confirm`だけを使う。同じSQLite write transactionで未確定かを確認し、10人全員を保存する。同じ10人・同じteam/lane割当の再送は冪等だが、既存rosterと異なる初回確定は409で拒否する。複数の開始操作が空rosterを読み取っていても、先に確定した割当を後続の抽選で上書きしない。競合したBotはVC移動を開始せず、再実行すると保存済みrosterから再開する。

既存の`PUT /events/:eventId/participants`は、戦績保存前の明示的な補正APIとして残す。1試合でも保存した後は異なるrosterへ変更できない。通常のmatching失敗からPUTへfallbackしない。これにより過去戦績のteam/laneとイベントrosterの対応を固定する。

## 入力セッションと保存確認

Botは確定rosterの10人について、1人分のKDA・CS・Goldを1つのmodalで収集する。slash commandの応答だけを使い続けず、入力ボタンとmodal submissionから新しいinteractionへ引き継ぐ。確認ボタンも新しいinteractionとしてacknowledgeしてから保存するため、最初のcommandから15分を超えた入力や保存結果の通知を古いtokenへ依存させない。

入力待機は2分、停止後の再開待機は最大10分、セッション全体は60分とする。現在の返信tokenには14分の安全期限を設け、期限までに保存済みではない入力一覧を表示して終了する。cancel、入力不正、入力待機のtimeout、セッション終了、保存失敗を別の結果として扱う。不正なフォーム値は再入力用に保持し、完了済みのプレイヤーの値を消さない。

セッションはcommand invocation内のメモリで保持する。同じ応答・実行者に限定したボタンと、invocation ID・入力ボタンのinteraction ID・participant IDを含むmodal IDで並行入力を分離する。対象event、game番号、winner、確定rosterは開始時に固定し、APIのcreator/guild/channel境界とtransaction内のroster照合も維持する。Bot再起動やセッション終了後の自動復元は提供しないため、終了時に対象と入力一覧を残す。

10人分の入力後も明示確認までAPIへ戦績を保存しない。確認後に送るpayloadは再試行を通じて固定し、保存失敗では再試行ボタンから同じpayloadを送る。HTTP timeout後のcommit不明も新しいgame番号で回避しない。成功応答を確認できないまま終了する場合は保存結果が未確認であることを伝える。

### 入力テストの保証移管

#146では旧チャット入力のテスト保証を次の所有者へ対応付け、移管先の成功を確認してから旧collectorを削除した。

| 旧保証                                              | 現在の所有者・判断                                                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| KDA・数値、0、不正入力                              | [collector tests](../bot/src/features/stat_collector.test.ts)で形式・安全な整数・不正draft修正・前参加者の保持を検証                          |
| 入力messageの削除権限がなくても継続                 | チャット収集/削除を廃止。modalのACK、入力受理、不正draft再送で検証し、message削除権限を前提にしない                                           |
| timeout                                             | 同collectorでボタン/modalの個別timeoutからの再開、セッション終了、画面更新遅延を検証                                                          |
| 大文字・空白・日本語の文字cancel                    | 文字による取消をボタンへ変更。collectorとcommandでcancel、一覧保持、確認前の保存0回を検証                                                     |
| timeout以外の終了・例外                             | collector failureとcommandの入力失敗表示で検証。strict fakeはcatchされたassert失敗も保持                                                      |
| command成功・中断・provider/確認/保存失敗・失敗分類 | [command tests](../bot/src/commands/record-match.test.ts)に維持し、累積15分30秒、fresh token、同payloadの明示再送を追加                       |
| 原子的保存・commit後応答喪失の再送                  | [実command・Hono・SQLite縦断](../tests/integration/custom_match_recording.integration.test.ts)で10人保存、rollback、1試合だけの再送成功を検証 |

## transactionとrollback

新規記録では、APIは次を1つのSQLite transactionで行う。

1. `matches` に決定的なmatch ID、`custom_game_event_id`、`game_sequence` を追加する。
2. `match_participants` に10行を追加し、各行へ保存時点のPUUID snapshotを含める。
3. 両方が成功した場合だけcommitする。

途中のinsert、制約違反、DB errorのいずれかが発生した場合は全体をrollbackする。matchだけ、またはparticipantの一部だけを新規保存した状態を成功として返さない。DBには次の制約も置く。

- `matches(custom_game_event_id, game_sequence)` はunique
- `match_participants(match_id, user_id)` はunique
- participantからmatch、matchからcustom eventへのforeign key

## 冪等な再送

初回commitは `201` と `created: true`、同じ記録の再送は `200` と `created: false` を返す。同じ `eventId + gameSequence` がすでにある場合、APIは保存済み10行を正規化して、今回導出した次の全値と比較する。

- user ID
- team、lane、win
- kills、deaths、assists、CS、Gold

全値が一致する場合だけ既存matchを返す。winner、stats、またはrosterが異なる場合は `409 CONFLICT` とし、既存行を上書きしない。

既存matchの確認は新規保存用のイベント状態判定より先に行う。初回commit後にイベントが取消済みまたは取消処理中になっていても、同じscope・roster・入力の再送は `created: false` を返し、異なる入力は409にする。取消後に未保存のgame番号を新規追加することはできない。

同じAPI processで複数のカスタム戦績保存が同時に到着した場合は、SQLite transactionを開始する前に[共通DB action境界](./integrations/architecture.md#sqlite操作の直列化)で他repositoryの操作とともに直列化する。同じkey・同じ入力の同時送信は一方だけが新規commitし、もう一方はそのcommitを検証して既存成功を返す。同じkey・異なる入力なら、一方だけをcommitしてもう一方は409にする。

PUUIDは初回の新規保存時だけcanonical Riot accountから取得するsnapshotであり、冪等性比較には使わない。初回記録後にRiot accountを再リンクしても、同じrequestの再送は `created: false` で既存matchを返し、保存済みsnapshotを現在のPUUIDへ更新しない。既存matchの同一request判定では、現在のcanonical Riot accountの存在も改めて要求しない。

API応答がtimeoutしてcommit結果が不明な場合は、同じ `eventId`、`gameSequence`、winner、10人分のstatsをそのまま再送する。新しいgame番号へ進めたり、先にDB行を削除したりしない。

| 結果                                   | HTTP | 呼出元の扱い                            |
| -------------------------------------- | ---- | --------------------------------------- |
| 初回にmatchと10 participantをcommit    | 201  | 成功                                    |
| 同じkey・同じ正規化内容を再送          | 200  | 既存成功の確認                          |
| 同じkeyへ異なる内容を送信              | 409  | 上書きせず、game番号と入力を確認        |
| scope不一致または対象イベントなし      | 404  | guild、募集チャンネル、event選択を確認  |
| 参加者不足・roster不一致・記録不能状態 | 409  | roster/stateを直し、同じgame番号で再送  |
| 新規保存時のcanonical Riot account不足 | 404  | Riot ID連携を完了し、同じgame番号で再送 |
| game番号、件数、重複、stats値が不正    | 422  | requestを修正してから送信               |

## 旧実装の整理と互換性

#152では#143のDB境界と#150の監視判断の統合後に、全workspaceの参照、`api/deno.json`の公開exports、HTTP routeとmigrationを再確認した。判断は次のとおりである。

| 候補                                                     | 判断と根拠                                                                                                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createMatchWithParticipants` / `createMatchParticipant` | 削除。現行routeは`recordCustomMatch`を呼び、旧関数の参照はrepository専用テストとAPI test utilityだけだった。repository factoryの戻り値、そこから推論される`DbActions`、専用payload型/schema、fake入口、専用テストも除去 |
| `updateUserRiotId` / `linkUserWithRiotId`                | 削除。新規連携は手動/RSOともcanonicalな`upsertRiotAccount`を使い、旧関数にHTTP routeやpackage公開exportはない。旧専用テスト・fake入口も除去                                                                             |
| Bot state内のrank queue / snapshot変換                   | 重複実装を除去。#150後は[共有contract](../api/src/contract/ranked_snapshots.ts)の同じ関数をBotのbefore取得とAPIのafter確定が実際に使うため、共有関数は保持                                                              |
| `ActiveNotificationGroup.messageIdAccountPuuids`         | 削除。初期化と自身の更新以外に判断用途がない。現在の共有投稿ID・対象account集合・watcher状態・結果投稿の使用済みIDとoutbox所有権は保持                                                                                  |
| `upsertMatchWatcher`                                     | 保持。移行client用HTTP routeと既存integrationが使う互換APIであり、不要な旧helperには含めない                                                                                                                            |
| 公開`createParticipantSchema` / `MatchParticipant`       | 保持。`contract` / `schema` / `validators`で公開されており、repository内部型と同じ理由では削除しない                                                                                                                    |
| 旧`users.riotId`列、旧match/participant、migration履歴   | 保持。コード削除から過去データの廃止・自動補修は導かない。0013のrouting移行は#147として別に検証する                                                                                                                     |

旧repositoryテストを削除する前に、次の保証を[現行repository integration](../api/src/db/repositories.integration.test.ts)へ対応付けて実行した。

| 旧保証                                                     | 現行経路の所有先・仕様                                                                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 試合と全参加者のcommit、同じ入力の再送                     | `recordCustomMatch`の10人一括保存、同一/異なる入力の並行再送、event/game単位の既存成功/競合                                                                     |
| 親matchだけ、または一部participantのある旧行への不足分追加 | 現行APIでは提供しない。決定的match IDの既存行衝突は拒否し、旧行を変更しない。履歴補修は本書の手動reconciliationで判断                                           |
| 同じuserの重複拒否                                         | 10件中1人を重複させた現行stats入力を拒否し、match/participantが0行のままであることを追加確認                                                                    |
| participant保存途中のDB失敗とrollback後の継続              | SQLite triggerで5人目のinsertを拒否し、全rollback後に同じkeyを再試行して10人保存できる既存テスト                                                                |
| not foundとDB障害の区別                                    | canonical account不足は`RiotAccountNotFoundError`、実SQLiteのinsert障害はnot-found系errorへ変換されないことを明示確認                                           |
| Riot IDの更新と履歴保持                                    | canonical accountの表示情報更新・PUUID所有、保存済み戦績のPUUID snapshot保持、[migration tests](../api/src/db/migrations.integration.test.ts)の旧列・旧履歴保持 |

## migration前の確認

整合性migrationは、旧schemaで禁止されていなかった次の重複があるとunique indexを作れない。

- `match_participants` の同一 `match_id + user_id`
- `custom_game_events` の同一 `recruitment_message_id`

いずれの場合もmigration全体がrollbackし、重複行を黙って削除しない。同じ募集メッセージを複数イベントが参照すると、片方の取消がもう片方のresourceを削除できてしまうため、新schemaでは1イベントだけの所有IDとする。

対象のAPI/Botを停止し、`DATABASE_URL` が適用対象を指すことを確認してSQLite DBと関連ファイルをbackupする。共有・本番DBへの `db:migrate` は明示承認を得る。まず次を実行する。

```sql
PRAGMA foreign_keys;
PRAGMA foreign_key_check;

SELECT
  match_id,
  user_id,
  COUNT(*) AS duplicate_count
FROM match_participants
GROUP BY match_id, user_id
HAVING COUNT(*) > 1
ORDER BY match_id, user_id;

SELECT
  recruitment_message_id,
  COUNT(*) AS duplicate_count
FROM custom_game_events
WHERE recruitment_message_id IS NOT NULL
GROUP BY recruitment_message_id
HAVING COUNT(*) > 1
ORDER BY recruitment_message_id;
```

`PRAGMA foreign_keys` は1、`foreign_key_check` と両方の重複queryは0行であることが通常の適用条件である。participant重複があれば、各行の `id` と全statsをexportし、運用記録と照合して正しい1行を人手で決める。backup前の削除、最新IDを機械的に残す処理、statsの平均化は行わない。

募集メッセージ重複があれば、参照する全eventとDiscord上の実メッセージをexportして正しい所有関係を確認する。別event用メッセージの作成・ID修正、または無効な旧eventのretireを個別に判断し、片方へ機械的に寄せたり共有参照を残したりしない。

旧matchの棚卸しには次を使う。

```sql
SELECT
  m.id,
  m.created_at,
  COUNT(mp.id) AS participant_count
FROM matches AS m
LEFT JOIN match_participants AS mp ON mp.match_id = m.id
GROUP BY m.id, m.created_at
ORDER BY m.created_at, m.id;
```

participantが10人未満の行も自動削除しない。Match-v5由来の行、旧カスタム戦績、入力途中の行をDBだけで安全に分類できないため、Discord運用記録やRiot match IDと突き合わせる。

## migration適用と検証

事前条件を満たしたら、停止状態を保ってmigrationを1回適用する。migrationは次を行う。

- 旧イベント値を保持してsaga列を追加する。
- `custom_game_event_participants` を追加する。
- `matches` にnullableな `custom_game_event_id` と `game_sequence` を追加する。
- `match_participants` にnullableな `riot_puuid` を追加する。
- 新しいunique indexとforeign keyを追加する。

nullableなのは旧行を推測で新イベントや現在のRiot accountへ結び付けないためである。新しいカスタム戦績APIから作られる行では、event、game番号、10人分のPUUID snapshotを必須運用とする。

適用後は次を確認する。

```sql
PRAGMA foreign_keys;
PRAGMA foreign_key_check;

SELECT
  match_id,
  user_id,
  COUNT(*) AS duplicate_count
FROM match_participants
GROUP BY match_id, user_id
HAVING COUNT(*) > 1;

SELECT
  recruitment_message_id,
  COUNT(*) AS duplicate_count
FROM custom_game_events
WHERE recruitment_message_id IS NOT NULL
GROUP BY recruitment_message_id
HAVING COUNT(*) > 1;

SELECT
  m.id,
  m.custom_game_event_id,
  m.game_sequence,
  COUNT(mp.id) AS participant_count,
  SUM(
    CASE
      WHEN mp.id IS NOT NULL AND mp.riot_puuid IS NULL THEN 1
      ELSE 0
    END
  ) AS missing_puuid_count
FROM matches AS m
LEFT JOIN match_participants AS mp ON mp.match_id = m.id
GROUP BY m.id, m.custom_game_event_id, m.game_sequence
ORDER BY m.created_at, m.id;
```

`foreign_keys` は1、foreign key違反と両方の重複は0行でなければ再起動しない。旧matchのevent/gameと旧participantのPUUIDがnullのまま残ること自体はmigration失敗ではない。

## 旧データのcleanupとreconciliation

旧行を新しいevent/gameへ一括で推測接続しない。特に、現在のDiscord userに紐づくPUUIDを旧participantへ無条件backfillすると、試合当時とは別accountの履歴に変わる可能性がある。

1. 旧match、participant全列、関連するDiscord投稿や外部試合IDをexportする。
2. Riot公式match、確認済みカスタム戦績、入力途中または不明の行へ分類する。
3. 確認済みカスタム戦績だけ、対応するevent、1始まりのgame番号、試合当時のPUUIDを確定する。
4. 変換する場合は、`eventId + gameSequence` と `matchId` の重複がないことを確認し、対象IDを限定した保守transactionを別途レビューする。
5. 変換前後のmatch数、participant数、stats合計を照合する。元行の削除はこの照合とbackup確認の後に独立して判断する。
6. 情報不足の行はnullのまま隔離し、推測で補完または削除しない。

新APIを使って旧行と同じ内容を再登録すると、旧matchも残って集計が二重になる可能性がある。再登録をcleanupの代替にせず、先に履歴をどちらへ正規化するか決める。

移行がparticipantまたは募集メッセージのunique index作成で失敗した場合、integration testで保証するrollback後の旧schemaが維持される。重複解消後に同じmigrationを再実行し、上記postflight queryをすべて確認してからAPI/Botを再起動する。
