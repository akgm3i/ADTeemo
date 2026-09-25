# Riotアカウントと試合監視

- Type: user
- Status: current
- Summary: 複数アカウントの登録・メイン選択・解除と、サーバーごとの監視設定。
- Read when: Riot IDを登録するとき、通知先や本人の監視を変更するとき。
- Related: [#48](https://github.com/akgm3i/ADTeemo/issues/48), [#34](https://github.com/akgm3i/ADTeemo/issues/34), [#89](https://github.com/akgm3i/ADTeemo/issues/89)
- Code: [account command](../../bot/src/commands/riot-accounts.ts), [watch settings](../../bot/src/commands/watch-settings.ts), [preference](../../bot/src/commands/watch-preference.ts)
- Tests: [account command tests](../../bot/src/commands/riot-accounts.test.ts), [policy integration](../../tests/integration/watch_policy.integration.test.ts)
- Reviewed: 2026-09-25
- Verified: 2026-09-25、ローカルcommandとBot→API→SQLite。実Discord command登録・実OAuthは未実施。

## 登録とメインアカウント

`/set-riot-id riot-id:<GameName#TagLine> [platform:<server>]`で自分のアカウントを追加します。Riot公式APIで照合し、同じアカウントの再登録は表示名を更新します。別アカウントを追加しても既存登録を消しません。他のDiscordユーザーに登録済みのアカウントは、自動で所有者を変更できません。手入力はRiot上の本人所有証明ではないため、誤登録や所有権の競合は管理者が確認します。

`/riot-accounts`で一覧を確認します。`action:main`はメイン変更、`action:remove`は選んだアカウントの解除です。選択メニューは本人だけが操作できます。10件ずつ表示し、続きは`page`で指定します。

最初の登録をメインにします。カスタムゲームはメイン1アカウントを使います。メインを解除した場合、残っている最も古い登録をメインにします。最後の登録を解除すると未登録になります。過去の保存済み戦績は登録解除やメイン変更で書き換わりません。

RSOの認証・登録処理は実装済みですが、Riot側承認とcredential・redirect設定が未確認のため`/link-riot-account`は未提供です。[RSOの提供条件](../integrations/rso.md)を参照してください。Discordのconnected accountsを使う自動登録も未提供です。

## サーバーの監視と本人設定

サーバー管理者は`/watch-settings mode:enabled channel:<通知先>`で試合監視を有効にします。通知先未設定の新規サーバーは監視しません。有効なサーバーでは、所属するユーザーの登録済み**全アカウント**を既定で監視します。メイン以外も対象です。

`/watch-preference action:opt-out`は、そのサーバーで自分の全アカウントの監視と待機中の通知を止めます。`action:opt-in`で再び監視を許可します。他のサーバーの設定や他のユーザーには影響しません。登録時にも`/set-riot-id ... watch-preference:opt-out`で停止を選べます。サーバーごとの設定なのでDMでは指定しません。

`/watch-settings mode:disabled`はサーバー全体の監視を停止します。`/watch-list`は現在の実効監視対象をRiot ID付きで表示します。旧`/watch-match`と`/unwatch-match`は提供しません。

監視数はサーバーごとのアカウント上限内です。上限超過数は管理者の設定時に返し、実際の対象は`/watch-list`で確認します。新規登録・opt-inによって上限を超えた場合、全員の監視は保証しません。サーバー退出、Botの退出、アカウント解除でも対象から外します。

opt-out以降に待機中の通知を新しくclaimしたり、古いworkerが新しい配送を保存して再開したりすることを防ぎます。ただしDiscordへの送信が既に実行中だった場合、その送信を取り消す保証はありません。過去の通知を自動削除する操作ではありません。

試合の表示は[試合通知ガイド](./match-display.md)、運用条件と移行は[監視の運用](../integrations/account-monitoring.md)を参照してください。
