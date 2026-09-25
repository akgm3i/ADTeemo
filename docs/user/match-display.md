# 試合中・試合結果の通知

- Type: user
- Status: current
- Summary: 試合監視通知の読み方と欠損時の見え方。
- Read when: 通知に表示される情報や省略の理由を知りたいとき。
- Related: [#28](https://github.com/akgm3i/ADTeemo/issues/28), [#55](https://github.com/akgm3i/ADTeemo/issues/55)
- Code: [renderer](../../bot/src/features/match_tracking_renderer.ts)
- Tests: [renderer tests](../../bot/src/features/match_tracking_renderer_result.test.ts)
- Reviewed: 2026-09-25
- Verified: renderer 21 scenarios, 2026-09-25

サーバー管理者が`/watch-settings`で設定した通知先へ、所属者の全登録Riotアカウントの試合を通知します。`/watch-list`で有効な対象を確認し、本人の停止・再開は`/watch-preference`で変更します。[アカウント管理と監視設定](./riot-accounts-and-monitoring.md)を参照してください。

## 試合中

チャンピオン、キュー、マップ、モード、経過時間を表示します。同じギルド・通知先・Riot platform・試合にいる複数の監視対象は1投稿にまとめます。同じDiscordユーザーの複数accountが同じ試合にいる場合もRiot IDで区別します。複数対象では各accountのチャンピオンを一覧にし、1人だけを強調するthumbnailは付けません。

試合中にKDA、CS、Gold、LP増減、OP.GG試合詳細は表示しません。これらは試合終了後に確認します。

## 試合結果

結果は監視対象アカウントごとに表示します。最初にマップ・モード・キューを1つの「試合情報」にまとめ、チャンピオン・ロール・試合時間、KDA・キル関与率・Gold、ダメージとロール別指標の順に表示します。試合時間は分:秒、判定できないロールは「不明」です。

| ロール                 | 主に表示する指標                                                             |
| ---------------------- | ---------------------------------------------------------------------------- |
| Top / Mid / Bot / 不明 | CSと毎分値を1つのfieldに表示（例: `192 (6.4/min)`）                          |
| Jungle                 | CSと毎分値、ミニオン・JG等の合計・取得できた自陣JG・敵陣JGを1つのfieldに表示 |
| Support                | 視界スコアと毎分値を1つのfieldに表示                                         |

Jungleの「JG等 合計」はRiotの `neutralMinionsKilled` の取得値です。自陣/敵陣はその内訳として取得できた値だけを示し、合計へ加算しません。公式定義にはジャングルモンスターに加えてpetも含まれるため、合計から自陣/敵陣を引いて「中立だけ」の数を算出しません。未提供の内訳は省略します。根拠は[Riot公式Match-v5 ParticipantDto](https://developer.riotgames.com/apis/#match-v5/GET_getMatch)です（2026-09-25確認）。

ランク対象試合では[ランク・LP](./ranked-lp.md)を表示します。任意の[OP.GG連携](../integrations/opgg.md)が成功すると試合詳細リンクと、取得できたレーン戦スコア・平均Tierを補足します。プロフィールへのリンクは表示しません。

## 情報が不足している場合

- 試合参加者の詳細を取得できなければ、詳細戦績の代わりに取得できなかったことを案内します。
- 静的な表示名が解決できなければ既存名またはIDを使い、画像URLが解決できなければthumbnailを省略します。
- 一部のロール指標、ランク、OP.GGが欠損しても、取得できた結果の通知を続けます。
- LP差分が妥当でなければ現在ランクだけを表示します。CS/minやキル関与率の計算不能時もrendererがfallbackを定めます。

正確なfield順序、計算式、境界値は上記rendererとtestsが正本です。設計理由は[ADR 0003](../adr/0003-match-display-priorities.md)、追加指標の未採用案は[Proposal](../proposals/match-display-extensions.md)を参照してください。
