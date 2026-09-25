# ADR 0004: ランクsnapshotを試合前のpendingと確定後に分ける

- Type: adr
- Status: accepted
- Summary: 親matchがないbefore取得と欠損を扱える正規化された保存。
- Read when: League-v4取得、rank snapshot保存、LP計算の変更時。
- Related: [#54](https://github.com/akgm3i/ADTeemo/issues/54), [#48](https://github.com/akgm3i/ADTeemo/issues/48)
- Code: [schema](../../api/src/db/schema.ts), [repository](../../api/src/db/repositories/matches.ts), [service](../../api/src/services/match_tracking.ts)
- Tests: [repository tests](../../api/src/db/repositories.integration.test.ts), [service tests](../../api/src/services/match_tracking.test.ts)
- Reviewed: 2026-09-25
- Verified: local code review, 2026-09-25

## Context

LP増減はMatch-v5だけでは取得できない。Active Game検知時点ではMatch-v5のmatch IDや親match行がなく、試合終了後だけの取得ではbeforeを復元できない。ランクはDiscordユーザー全体でなくRiot identityとqueue、取得phaseに属し、Solo/DuoとFlexや欠損を表現する必要がある。

## Decision

Active Game検知時にLeague-v4のSolo/Duo・Flex entryを取得し、platformとgame、PUUIDとqueueで対応するpending snapshotへ保存する。Match-v5結果取得時に親matchとbefore/afterを確定保存し、対応するpendingを削除する。取り残されたpendingは期限でcleanupする。

rank情報をmatchesの固定列へ混ぜず、参加者identity・queue・phaseごとのsnapshotへ正規化する。entryなし、beforeだけ、afterだけの状態を許容し、取得失敗でも監視と結果通知を続ける。

試合後は結果を取得できたタイミングでLeague-v4を取得し、固定の追加待機は設けない。反映前やbefore欠損、不自然な差分は現在ランクへfallbackする。divisionを跨ぐLPを順位へ正規化して比較し、Master以上のdivisionなしも計算側で扱う。

## Consequences

取得phaseを保持でき、将来の複数accountでもDiscordユーザー単位の固定列に依存しない。一方、League-v4の反映時差があるため差分表示を常に保証しない。unique key、列、TTL、計算式・境界値の正本はCode/Testsに置く。

## Rejected alternatives

- matchesへbefore/afterとqueue別固定列を追加: identity・queue・欠損の組合せを表しづらい。
- 試合中beforeを確定snapshotへ直接保存: 物理FKの親行が存在しない。
- 結果取得後に固定時間待つ: 反映を保証できず、基本通知まで遅らせる。
- 不自然な差分もそのまま表示: 確度のないLP値を確定情報として見せてしまう。

## Enforcement

上記schema/repository/serviceとtestsが保存・cleanup・計算を検証する。[利用ガイド](../user/ranked-lp.md)には表示の意味だけを記載する。
