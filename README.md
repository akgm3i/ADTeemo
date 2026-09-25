# ADTeemo

![GitHub License](https://img.shields.io/github/license/akgm3i/ADTeemo)

ADTeemoはLeague of Legendsのカスタムゲーム運営を支援するDiscord Botです。Discord上で参加募集、ロール希望の収集、チーム分け、VC移動、戦績記録、LoL試合監視を扱えます。

## 主な機能

- Discord slash commandによるBot操作
- 複数Riotアカウントの登録・一覧・メイン選択・解除
- ギルド別のメインロール登録
- Botが利用するDiscordロールの検出・作成
- Discordスケジュールイベントと募集メッセージの作成
- 募集メッセージのリアクションをもとにしたチーム分け
- ギルド設定したRed/Blue VCへの参加者移動と次ゲームのLobby復帰
- カスタムゲーム結果の手動記録
- Riot ID連携済みメンバーのLoL試合監視、試合中更新、終了後結果通知
- 同一試合にいる複数監視対象の試合中通知統合
- ギルド内の有効な試合監視対象一覧表示
- BotとBackend APIのhealth check

## Slash Commands

| Command                                                                                            | Description                                                                       |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `/health`                                                                                          | BotとBackend APIの稼働状況を確認します。                                          |
| `/setup-roles`                                                                                     | `Top`, `JG`, `Mid`, `Bot`, `Sup`, `Custom` ロールを検出し、不足分を作成します。   |
| `/set-main-role role:<role>`                                                                       | 自分のメインロールをギルド別に登録します。                                        |
| `/set-riot-id riot-id:<GameName#TagLine> [platform:<platform>] [watch-preference:opt-out\|opt-in]` | Riot IDを登録・更新します。                                                       |
| `/create-custom-game title:<title> date:<MM/DD> time:<HH:mm> voice:<voice>`                        | Discordスケジュールイベントを作成し、実行チャンネルに募集メッセージを投稿します。 |
| `/cancel-custom-game`                                                                              | 自分が作成した有効なカスタムゲームイベントを選択してキャンセルします。            |
| `/setup-custom-game recruitment:<channel> lobby:<vc> red:<vc> blue:<vc>`                           | 管理者が募集・VC・ロール設定を保存します。                                        |
| `/start-matching`                                                                                  | 自分が作成したイベントを選択して参加者を確定します。                              |
| `/next-game event:<ID>`                                                                            | 参加者をLobbyへ戻し、次ゲームの記録番号を案内します。                             |
| `/split-teams [event:<ID>]`                                                                        | 募集リアクションを集計し、2チームへ分けてVCへ移動します。                         |
| `/record-match winner:<BLUE\|RED> [game:<正整数>] [event:<ID>]`                                    | 確定参加者の戦績を記録します。同じ試合の再送には同じgame番号を使います。          |
| `/riot-accounts [action:list\|main\|remove] [page:<番号>]`                                         | 自分の登録アカウントを一覧し、メイン変更・解除を選択します。                      |
| `/watch-settings mode:enabled\|disabled [channel:<通知先>]`                                        | 管理者がサーバーの試合監視と通知先を設定します。                                  |
| `/watch-preference action:opt-out\|opt-in`                                                         | このサーバーで自分の全アカウントの監視を停止・再開します。                        |
| `/watch-list`                                                                                      | 実行ギルド内の有効なアクティビティ監視対象一覧を表示します。                      |

## 制約

### `/split-teams`

- コマンド実行者が作成したイベントを指定できます。`event`省略時は今日開始のイベントを対象にします。
- コマンドは募集メッセージが投稿されたテキストチャンネルで実行してください。
- 参加者は合計10人である必要があります。
- 各ロールのリアクション参加者は2人ずつである必要があります。
- 管理者が`/setup-custom-game`で異なるLobby/Red/Blue VCを設定する必要があります。

### アクティビティ監視

- 通知先設定済みのサーバーでは、所属者の全登録アカウントを既定で監視します。
- 本人が `/watch-preference` でサーバーごとに停止・再開できます。
- 試合中通知はRiot公式APIで取得できる情報に限定されます。KDA、CS、Goldなどのライブ戦績は終了後の結果通知で扱います。

## 関連ドキュメント

- [Riotアカウント管理と監視設定](./docs/user/riot-accounts-and-monitoring.md)
- [カスタムゲームの操作と制約](./docs/user/custom-games.md)
- [試合中・結果通知の読み方](./docs/user/match-display.md)
- [開発・運用](./CONTRIBUTING.md)
- [設計・調査・提案の索引](./docs/README.md)
- [要望・不具合・Roadmap](https://github.com/akgm3i/ADTeemo/issues)

commandの提供可否は[registry](./bot/src/common/command_registry.ts)、正確なoption定義は[各command実装](./bot/src/commands)が正本です。

RSOの`/link-riot-account`はRiot側の承認・外部設定が未確認のため未提供です。[現在の実装と提供条件](./docs/integrations/rso.md)を参照してください。
