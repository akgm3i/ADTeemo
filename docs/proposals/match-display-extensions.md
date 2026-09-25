# 試合結果の追加指標候補

- Type: proposal
- Status: proposed
- Summary: 表示余地がある場合の補助指標と平均Tierの未採用代替案。
- Read when: 表示項目を拡張するとき。
- Related: [#55](https://github.com/akgm3i/ADTeemo/issues/55), [#100](https://github.com/akgm3i/ADTeemo/issues/100)
- Code: [renderer](../../bot/src/features/match_tracking_renderer.ts)
- Tests: [renderer tests](../../bot/src/features/match_tracking_renderer.test.ts)
- Reviewed: 2026-09-25
- Verified: not adopted

この文書の追加指標は未採用候補であり、現在利用できる表示は[利用ガイド](../user/match-display.md)を参照する。[#100](https://github.com/akgm3i/ADTeemo/issues/100)の時間・ロール表示、関連fieldの統合、取得可能なJG CS内訳は実装済みで、以下の補助指標とは区別する。旧設計から選択肢と理由を保存する。

## ロール別追加指標

試合結果Embedのロール別追加指標は、基本表示とロール別metric group、ランク、OP.GG fieldを出したうえで、まだ表示余地がある場合に追加する。初期実装では必須にしない。

追加する場合は、対象者のメインロールまたはMatch-v5のlane/positionに応じて、次の順で最大2 fieldまで追加する。

| ロール  | 優先する追加指標                          | 理由                                           |
| ------- | ----------------------------------------- | ---------------------------------------------- |
| Top     | レーン戦スコア、被ダメージ                | レーン戦とフロントライン寄与を補足したい       |
| Jungle  | オブジェクトダメージ、視界                | 中立オブジェクトと視界関与の比重が高い         |
| Middle  | レーン戦スコア、オブジェクトダメージ      | レーン主導権とマップ影響を補足したい           |
| Bottom  | レーン戦スコア、DPM                       | 継続火力を補足したい                           |
| Support | コントロールワード購入数、ワード設置/破壊 | 視界スコアだけでは見えない視界行動を補足したい |

ロール別追加指標の由来は、Match-v5だけで取得できる値を優先する。追加Riot API呼び出しが必要な値は初期実装では採用しない。OP.GG由来のレーン戦スコアは、OP.GG field内で表示する。

## 平均Tier

試合平均Tierは次の優先順位で扱う。

1. Match-v5の取得結果だけで算出できる場合は、ADTeemo側で算出した値を使う。
2. Match-v5参加者から各サモナーのプロフィールやランクを取得するために追加Riot API呼び出しが必要な場合は、OP.GGの `average_tier` を使う。
3. どちらからも取得できない場合は表示しない。

現時点のMatch-v5 participant情報だけでは参加者のランク分布を直接取得できないため、初期実装ではOP.GG詳細が取得できた場合の `average_tier` を表示候補にする。

## Open questions

追加指標を入れても通知量の目標を維持できるか、どのロールで利用価値が高いか、追加API取得なしで十分に信頼できるかを採用前に確認する。Supportのワード購入・設置・破壊を1 fieldにまとめる案も、この基準で判断する。現行のOP.GG平均Tier表示自体は[連携ガイド](../integrations/opgg.md)に従う。
