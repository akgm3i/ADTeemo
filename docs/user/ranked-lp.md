# ランクとLP表示の読み方

- Type: user
- Status: current
- Summary: ランク対象試合のLP差分と欠損時表示。
- Read when: 結果通知のランク・LP欄を読むとき。
- Related: [#54](https://github.com/akgm3i/ADTeemo/issues/54)
- Code: [rank summary](../../api/src/services/match_tracking.ts)
- Tests: [rank summary tests](../../api/src/services/match_tracking.test.ts)
- Reviewed: 2026-09-25
- Verified: local code review, 2026-09-25

Solo/DuoとFlexのランク対象試合で、取得できた現在ランクを表示します。Custom、Normal、ARAMではランク欄を表示しません。

LP増減は試合前後のLeague-v4情報を比較した推定で、Match-v5が直接返す値ではありません。妥当に比較できる場合はLP増減とbefore → afterを表示します。たとえばEmerald IV 99 LPからEmerald III 16 LPへの変化を+17 LPとして扱います。

試合前の情報がない、試合後の反映が遅い、差分が不自然な場合は差分を表示せず、取得できた現在ランクだけを表示します。ランク情報を取得できなくても試合結果自体は通知します。

保存・正規化の理由は[ADR 0004](../adr/0004-ranked-snapshot-lifecycle.md)、正確なqueue判定と計算境界は上記Code/Testsが正本です。
