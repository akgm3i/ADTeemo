# ADTeemo

![GitHub License](https://img.shields.io/github/license/akgm3i/ADTeemo)

ADTeemoはLeague of Legendsのカスタムゲーム運営を支援するDiscord Botです。Discord上で参加募集、ロール希望の収集、チーム分け、VC移動、戦績記録、LoL試合監視を扱えます。

## 主な機能

- Discord slash commandによるBot操作
- Riot IDの登録・更新とRiot Gamesアカウント連携URLの発行
- ギルド別のメインロール登録
- Botが利用するDiscordロールの検出・作成
- Discordスケジュールイベントと募集メッセージの作成
- 募集メッセージのリアクションをもとにしたチーム分け
- `Red Team` / `Blue Team` VCへの参加者移動
- カスタムゲーム結果の手動記録
- Riot ID連携済みメンバーのLoL試合監視、試合中更新、終了後結果通知
- 同一試合にいる複数監視対象の試合中通知統合
- ギルド内の有効な試合監視対象一覧表示
- BotとBackend APIのhealth check

## Slash Commands

| Command                                                                     | Description                                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `/health`                                                                   | BotとBackend APIの稼働状況を確認します。                                          |
| `/setup-roles`                                                              | `Top`, `JG`, `Mid`, `Bot`, `Sup`, `Custom` ロールを検出し、不足分を作成します。   |
| `/set-main-role role:<role>`                                                | 自分のメインロールをギルド別に登録します。                                        |
| `/set-riot-id riot-id:<GameName#TagLine> [platform:<platform>]`             | Riot IDを登録・更新します。                                                       |
| `/link-riot-account`                                                        | Riot Gamesアカウント連携用URLを取得します。                                       |
| `/create-custom-game title:<title> date:<MM/DD> time:<HH:mm> voice:<voice>` | Discordスケジュールイベントを作成し、実行チャンネルに募集メッセージを投稿します。 |
| `/cancel-custom-game`                                                       | 自分が作成した有効なカスタムゲームイベントを選択してキャンセルします。            |
| `/split-teams`                                                              | 募集リアクションを集計し、2チームへ分けてVCへ移動します。                         |
| `/record-match winner:<BLUE\|RED>`                                          | 現在の参加者についてKDA / CS / Goldを対話形式で入力し、戦績を記録します。         |
| `/watch-match member:<member>`                                              | Riot ID連携済みメンバーのLoL試合を継続監視し、実行チャンネルへ通知します。        |
| `/unwatch-match member:<member>`                                            | 指定メンバーの手動アクティビティ監視を停止します。                                |
| `/watch-list`                                                               | 実行ギルド内の有効なアクティビティ監視対象一覧を表示します。                      |

## 制約

### `/split-teams`

- コマンド実行者が作成した、今日開始のカスタムゲームイベントを対象にします。
- コマンドは募集メッセージが投稿されたテキストチャンネルで実行してください。
- 参加者は合計10人である必要があります。
- 各ロールのリアクション参加者は2人ずつである必要があります。
- ギルド内に `Red Team` と `Blue Team` という名前のボイスチャンネルが必要です。

### アクティビティ監視

- 現在は `/watch-match` で指定したメンバーを手動監視します。
- デフォルト監視とopt-outは設計中です。
- 試合中通知はRiot公式APIで取得できる情報に限定されます。KDA、CS、Goldなどのライブ戦績は終了後の結果通知で扱います。

## 関連ドキュメント

- 仕様: [SPEC.md](./SPEC.md)
- Roadmap要約: [TASKS.md](./TASKS.md)
- 開発者向け情報: [CONTRIBUTING.md](./CONTRIBUTING.md)
