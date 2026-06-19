# 試合結果・試合中Embed表示項目と優先順位

issue #55 では、試合結果・試合中Embedへ追加する情報の優先順位と、Discordの表示制約内でのレイアウト方針を固定します。

## 前提

- 試合結果通知は、監視対象者ごとに1 Embedで送信する。
- #34 のopt-in対象外では戦績表示自体が行われない前提のため、追加表示項目も同じ制御に従う。
- OP.GGプロフィールリンクは表示しない。表示対象は、解決できた場合のOP.GG試合詳細リンクだけとする。
- OP.GG由来情報は任意の補助情報であり、取得失敗時は該当fieldだけ省略して既存の試合結果通知を継続する。
- Discord Embedは、公式ドキュメント上で1 Embedあたり最大25 field、field value最大1024文字、Embed全体の対象文字合計最大6000文字などの制約を持つ。
  - 参考: https://docs.discord.com/developers/resources/message#embed-limits

## 表示量の上限

ADTeemoの試合結果・試合中Embedでは、Discord上のスマートフォン表示でも読み切れる量を優先し、実装上の最大値より小さい運用上限を設ける。

- 通常時の目標は12 field以内とする。
- 25 field上限へ近づく設計は採用しない。
- 1 fieldに複数行を詰める場合も、3行程度までに抑える。
- 取得できない値、信頼度が低い値、不自然な値は `-` で埋めるより省略を優先する。ただし既存の `CS/min` と `キル関与率` は、計算不能時のfallback表示を維持する。

## 試合結果Embed

試合結果Embedは、試合終了後にMatch-v5のparticipantを取得できた場合の詳細表示である。監視対象者ごとに1 Embedを送信する。

### Field構成

#### 基本表示

Match-v5の対象participantが取得できた場合、次のfieldは全ロール共通で表示する。

| 優先 | field | 由来 | 表示 |
| ---- | ----- | ---- | ---- |
| 1 | チャンピオン | Match-v5 + static data | inline |
| 2 | KDA | Match-v5 | inline |
| 3 | キル関与率 | Match-v5 | inline |
| 4 | Gold | Match-v5 | inline |
| 5 | ダメージ | Match-v5 | inline |
| 6 | キュー | Match-v5 + static data | inline |
| 7 | マップ | Match-v5 + static data | inline |
| 8 | モード | Match-v5 + static data | inline |

ダメージは `totalDamageDealtToChampions` を優先する。JungleやSupportでも集団戦貢献を確認したい場面があるため、全ロール共通の基本fieldに含める。

#### ロール別metric group

基本表示の後に、対象者のメインロールまたはMatch-v5のlane/positionに応じて最大2 fieldのmetric groupを追加する。これにより、全ロールへ同じCS指標を出して表示領域を消費することを避ける。

| ロール | 優先field | 由来 | 補足 |
| ------ | --------- | ---- | ---- |
| Top | CS、CS/min | Match-v5 | 必要に応じてレーン戦スコアをOP.GG fieldへ追加する |
| Jungle | JG CS、敵JG CS | Match-v5 | `neutralMinionsKilled` と、取得できる場合は `totalEnemyJungleMinionsKilled` を使う |
| Middle | CS、CS/min | Match-v5 | 必要に応じてレーン戦スコアをOP.GG fieldへ追加する |
| Bottom | CS、CS/min | Match-v5 | CS効率を優先する |
| Support | 視界スコア、視界スコア/min | Match-v5 | CS/CSminは原則表示しない |

Supportの追加候補として、表示余地がある場合だけコントロールワード購入数、ワード設置数、ワード破壊数を1 fieldにまとめる。初期実装では、`視界スコア` と `視界スコア/min` を優先し、ワード詳細は必要に応じて後続実装で追加する。

Jungleの敵JG CSはMatch-v5 participantに該当値が存在する場合だけ表示する。取得できない場合は `JG CS` 単独にfallbackし、fieldを無理に埋めない。

実装時はRiot Match-v5 ParticipantDtoの次の値を優先して使う。

- ダメージ: `totalDamageDealtToChampions`
- 視界スコア: `visionScore`
- 視界スコア/min: `visionScore / gameDurationMinutes`
- コントロールワード購入数: `visionWardsBoughtInGame`
- ワード設置/破壊: `wardsPlaced`, `wardsKilled`
- JG CS: `neutralMinionsKilled`
- 自陣/敵陣JG CS: `totalAllyJungleMinionsKilled`, `totalEnemyJungleMinionsKilled`

参考: https://developer.riotgames.com/apis#match-v5/GET_getMatch

基本表示8 field + ロール別2 field + ランク1 field + OP.GG1 fieldで、通常時の目標である12 field以内に収める。

#### ランク

ランク対象queueでランク情報を取得できた場合、基本表示とロール別metric groupの後に `ランク` fieldを追加する。

- 表示位置: 基本表示とロール別metric groupの後。
- 表示形式: full-width field。
- LP差分が自然に計算できる場合: `LP: +17` と `before -> after` を表示する。
- before欠損、after未反映、不自然な差分の場合: 現在ランクだけを表示する。
- ランク取得に失敗した場合: `ランク` fieldごと省略する。

#### OP.GG詳細

OP.GG試合詳細リンクを解決できた場合、`OP.GG` fieldを1つ追加する。

表示例:

```text
[試合詳細](https://op.gg/...)
レーン戦: 7.2
平均Tier: Emerald
```

- 表示位置: `ランク` fieldの後。ランクがない場合は基本表示とロール別metric groupの後。
- 表示形式: full-width field。
- 試合詳細リンクだけ取得できた場合は、リンク1行だけを表示する。
- レーン戦スコアと平均Tierは、OP.GG詳細データから取得できた場合だけ同じfield内に追加する。
- OP.GG詳細リンクを解決できない場合、OP.GG由来のレーン戦スコアと平均Tierも表示しない。

## 試合中Embed

試合中Embedは、Spectator-v5のActive Gameから作る開始通知と進捗通知である。試合中表示は結果確定前の軽量通知であり、OP.GGやMatch-v5由来の詳細戦績は表示しない。

### 単独監視対象

同じ `guildId + channelId + Riot platform + gameId` のactive group内で監視対象が1人の場合、次のfieldを表示する。

| 優先 | field | 由来 | 表示 |
| ---- | ----- | ---- | ---- |
| 1 | チャンピオン | Spectator-v5 + static data | inline |
| 2 | キュー | Spectator-v5 + static data | inline |
| 3 | マップ | Spectator-v5 + static data | inline |
| 4 | モード | Spectator-v5 + static data | inline |
| 5 | 経過時間 | Spectator-v5 | inline |

チャンピオンアイコンURLを解決できる場合は、対象チャンピオンをthumbnailにも表示する。

### 複数監視対象

同じactive group内で複数監視対象が同じ試合にいる場合、試合中通知は1投稿に統合する。この場合は対象者ごとのチャンピオンを1つのfull-width fieldにまとめる。

| 優先 | field | 由来 | 表示 |
| ---- | ----- | ---- | ---- |
| 1 | 監視対象のチャンピオン | Spectator-v5 + static data | full-width |
| 2 | キュー | Spectator-v5 + static data | inline |
| 3 | マップ | Spectator-v5 + static data | inline |
| 4 | モード | Spectator-v5 + static data | inline |
| 5 | 経過時間 | Spectator-v5 | inline |

複数監視対象時は、特定の1人だけを強調しないためthumbnailを省略する。将来、複数画像表示が必要になった場合は、Embedではなく別UIを検討する。

### 試合中表示に追加しない項目

次の項目は試合中Embedには表示しない。

- KDA / CS / Gold / Damageなど、試合終了後に確定する戦績。
- LP増減と現在ランク。LPは試合終了後のLeague-v4 snapshotで扱う。
- OP.GG試合詳細リンク、レーン戦スコア、平均Tier。OP.GG照合はMatch-v5結果取得後に行う。

## ロール別追加指標

試合結果Embedのロール別追加指標は、基本表示とロール別metric group、ランク、OP.GG fieldを出したうえで、まだ表示余地がある場合に追加する。初期実装では必須にしない。

追加する場合は、対象者のメインロールまたはMatch-v5のlane/positionに応じて、次の順で最大2 fieldまで追加する。

| ロール | 優先する追加指標 | 理由 |
| ------ | ---------------- | ---- |
| Top | レーン戦スコア、被ダメージ | レーン戦とフロントライン寄与を補足したい |
| Jungle | オブジェクトダメージ、視界 | 中立オブジェクトと視界関与の比重が高い |
| Middle | レーン戦スコア、オブジェクトダメージ | レーン主導権とマップ影響を補足したい |
| Bottom | レーン戦スコア、DPM | 継続火力を補足したい |
| Support | コントロールワード購入数、ワード設置/破壊 | 視界スコアだけでは見えない視界行動を補足したい |

ロール別追加指標の由来は、Match-v5だけで取得できる値を優先する。追加Riot API呼び出しが必要な値は初期実装では採用しない。OP.GG由来のレーン戦スコアは、OP.GG field内で表示する。

## 平均Tier

試合平均Tierは次の優先順位で扱う。

1. Match-v5の取得結果だけで算出できる場合は、ADTeemo側で算出した値を使う。
2. Match-v5参加者から各サモナーのプロフィールやランクを取得するために追加Riot API呼び出しが必要な場合は、OP.GGの `average_tier` を使う。
3. どちらからも取得できない場合は表示しない。

現時点のMatch-v5 participant情報だけでは参加者のランク分布を直接取得できないため、初期実装ではOP.GG詳細が取得できた場合の `average_tier` を表示候補にする。

## チャンピオンアイコン

試合結果Embedと単独対象の試合中Embedでは、対象participantのチャンピオンアイコンをEmbed thumbnailに表示する。

方針:

- 画像はData Dragonのchampion square imageを使う。
- Data Dragon versionは既存のstatic data取得・cacheの延長で扱い、固定URLや固定versionをコードに直書きしない。
- thumbnail設定に失敗しても、対象Embed自体は送信する。
- チャンピオン名fieldは維持する。thumbnailは視認性の補助であり、名前の代替にはしない。
- championIdから画像URLを解決できない場合はthumbnailを省略し、既存のチャンピオン名またはID fallbackを表示する。
- 複数監視対象を統合した試合中Embedではthumbnailを省略する。

## 省略とfallback

| 状況 | 表示 |
| ---- | ---- |
| Match-v5 participantが見つからない | participant missing Embedを送信し、詳細fieldは出さない |
| static data名が取得できない | Match-v5の既存名またはID fallbackを使う |
| チャンピオンアイコンURLを解決できない | thumbnailを省略し、チャンピオン名fieldは維持する |
| ロール別metricの一部が取得できない | 取得できたmetricだけ表示し、fieldを無理に埋めない |
| ランク情報が取得できない | `ランク` fieldを省略する |
| LP差分が計算不能または不自然 | 現在ランクだけ表示する |
| OP.GG連携が無効 | OP.GGへHTTPリクエストせず、OP.GG fieldを省略する |
| OP.GG詳細リンクを解決できない | OP.GG fieldを省略する |
| OP.GG詳細データだけ一部欠損 | 取得できた行だけOP.GG fieldに表示する |

## 実装時のテスト方針

- 試合中の単独監視対象では、チャンピオン、キュー、マップ、モード、経過時間が表示されることを固定する。
- 試合中の単独監視対象でチャンピオンアイコンURLを解決できる場合、Embed thumbnailが設定されることを固定する。
- 試合中の複数監視対象では、対象者ごとのチャンピオン一覧が表示され、thumbnailが省略されることを固定する。
- OP.GGなし、ランクなしでも基本表示とロール別metric groupを含む試合結果Embedが送信されることを固定する。
- SupportではCS/CSminではなく視界スコア/視界スコアminを表示することを固定する。
- JungleではJG CSと、取得できる場合の敵JG CSを表示することを固定する。
- 全ロールでダメージfieldが表示されることを固定する。
- ランクありの場合、基本表示とロール別metric groupに加えて `ランク` fieldが出ることを固定する。
- OP.GGリンクだけある場合、`OP.GG` fieldがリンク1行で出ることを固定する。
- OP.GGリンク、レーン戦スコア、平均Tierがある場合、1つの `OP.GG` fieldにまとめて出ることを固定する。
- チャンピオンアイコンURLを解決できる場合、Embed thumbnailが設定されることを固定する。
- チャンピオンアイコンURLを解決できない場合、thumbnailなしでも対象Embedが送信されることを固定する。
- OP.GG取得失敗時に試合結果Embed自体が失敗しないことを固定する。
