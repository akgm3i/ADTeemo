# カスタム戦績の整合性と移行

- Type: integration
- Status: current
- Summary: カスタム戦績のtransaction、冪等性、旧データ移行。
- Read when: 戦績記録・再送・migration・roster変更時。
- Related: [#113](https://github.com/akgm3i/ADTeemo/issues/113)
- Code: [match repository](../api/src/db/repositories/matches.ts)
- Tests: [repository tests](../api/src/db/repositories.integration.test.ts), [vertical tests](../tests/integration/custom_match_recording.integration.test.ts)
- Reviewed: 2026-09-25
- Verified: local code review, 2026-09-25

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

同じAPI processで複数のカスタム戦績保存が同時に到着した場合は、SQLite transactionを開始する前にrepository内で直列化する。同じkey・同じ入力の同時送信は一方だけが新規commitし、もう一方はそのcommitを検証して既存成功を返す。同じkey・異なる入力なら、一方だけをcommitしてもう一方は409にする。

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
