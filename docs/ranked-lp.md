# ランク・LP表示の仕様メモ

## 目的

issue #54 では、ランク対象queueの試合結果EmbedにLP増減と現在ランクを表示します。LP増減はRiot Match-v5だけでは取得できないため、League-v4の試合前後スナップショットから算出します。

## 対象queue

対象は次の両方です。

- Solo/Duo: `RANKED_SOLO_5x5`
- Flex: `RANKED_FLEX_SR`

Match-v5の `queueId` がランク対象queueでない場合、LP・ランク欄は表示しません。Custom / Normal / ARAMでは表示しません。

## 取得タイミング

### before

試合前スナップショットは、Spectator-v5のActive Game検知時に取得します。

- 取得元: League-v4 entries by PUUID
- 一時保持対象: 対象プレイヤーのSolo/DuoとFlexのentry
- 取得失敗時: 試合監視・試合結果通知は継続します。

Active Game時点ではRiot Match-v5の `metadata.matchId` が未確定であり、親になる `matches` 行も存在しません。そのため、この時点では最終保存先の `match_rank_snapshots` には直接保存せず、試合終了後の突き合わせ用に一時保存します。

### after

試合後スナップショットは、Match-v5の試合結果を取得できたタイミングで取得します。追加の固定待機は入れず、既存の試合結果検知周期に委ねます。

Riot側の反映遅延によりafterがまだ旧値の場合があります。その場合、LP差分が0または不自然になる可能性があるため、before/after差分を無理に表示せず、現在ランクのみの表示へfallbackします。

## DB保存方針

ランク情報は試合情報と同じDBに保存します。ただし、`matches` へbefore/after列を直接追加する設計は採用しません。また、Active Game時点のbeforeは `matches` の親行がまだ存在しないため、`matches` を親にする最終テーブルへは直接保存しません。

理由:

- ランクはmatch単位ではなく、参加者PUUID、queue type、取得phaseに属する情報である。
- Solo/DuoとFlexの両方を保存するため、matchに固定列として持つとqueue追加や複数account対応に弱い。
- #48 のサブアカウント対応では、Discord user単位よりRiot account / PUUID単位の正規化が必要になる。
- beforeだけ、afterだけ、または取得失敗のような欠損状態を自然に扱う必要がある。
- before取得時点ではRiot Match-v5の `metadata.matchId` が未確定であり、物理FK付きの `match_rank_snapshots.match_id` へ保存すると親行不在になり得る。

そのため、ランクスナップショットは次の2段階で保存します。

1. Active Game検知時は、`platform + game_id + puuid + queue_type` をキーにしたステージングテーブルへbeforeを保存する。
2. Match-v5結果取得時に `matches` 行を作成または更新し、ステージング済みbeforeと取得済みafterを `match_rank_snapshots` へ保存する。

ステージング行は `match_rank_snapshots` への移行後に削除します。試合終了を検知できなかった行は、期限切れとして後続の監視処理または定期cleanupで削除します。

例: `pending_match_rank_snapshots`

主な列:

- `platform`
- `game_id`: Spectator-v5 `gameId`
- `puuid`
- `queue_type`: `RANKED_SOLO_5x5` または `RANKED_FLEX_SR`
- `tier`: 例 `EMERALD`
- `rank`: 例 `IV`
- `league_points`
- `wins`
- `losses`
- `fetched_at`
- `expires_at`

一意制約:

- `platform + game_id + puuid + queue_type`

最終保存先として、`matches` を親にしたランクスナップショットテーブルを追加します。

例: `match_rank_snapshots`

主な列:

- `match_id`: Riot Match-v5 `metadata.matchId`
- `puuid`
- `platform`
- `queue_type`: `RANKED_SOLO_5x5` または `RANKED_FLEX_SR`
- `phase`: `before` または `after`
- `tier`: 例 `EMERALD`
- `rank`: 例 `IV`
- `league_points`
- `wins`
- `losses`
- `fetched_at`

一意制約:

- `match_id + puuid + queue_type + phase`

`tier`, `rank`, `league_points` は、そのqueueのentryが存在する場合だけ保存します。Unrankedや取得失敗は、entryなしとして扱います。

## LP差分計算

LP差分は、同じ `match_id + puuid + queue_type` の `before` と `after` が揃った場合だけ計算します。

同一tier / division内:

```text
after.league_points - before.league_points
```

divisionまたぎ:

- 100LPは次のdivisionまたはtierの0LPと同値として扱います。
- 例: `E4 99LP -> E3 16LP` は `+17LP` と表示する。
- 例: `E4 2LP -> E4 19LP` は `+17LP` と表示する。

tier / divisionの順位は、Riotのrank順に基づく内部変換で計算します。Master以上はdivisionがないため、tier内LP差分として扱います。

beforeが欠損している場合、またはbefore/afterの対応が不自然な場合はLP差分を表示せず、afterの現在ランクだけを表示します。

## 表示方針

afterが取得できる場合、現在ランクを表示します。

before/afterが両方取得でき、同じqueueとして妥当に比較できる場合:

```text
LP: +17
Emerald IV 2LP -> Emerald IV 19LP
```

beforeが取得できない場合:

```text
現在: Emerald IV 19LP
```

ランク情報取得に失敗した場合、試合結果Embed自体は通常通り送信します。LP・ランク欄だけ省略します。
