# デフォルト監視と opt-out の最小仕様

## 結論

issue #34 の最小仕様は「Riot ID 登録済みユーザーをギルド単位でデフォルト監視対象にし、本人が opt-out できること」です。

ただし、現行実装にはギルド別のデフォルト監視有効化設定と通知先設定がありません。通知先が未定義のまま自動監視を開始すると、どのチャンネルへ試合開始・試合結果を投稿するかを決められません。そのため、このブランチではコード実装を広げず、最小仕様と issue 完全仕様との差分を管理対象として明文化します。

## 現行仕様

- `/watch-match @member` で、Riot ID 登録済みメンバーを手動で監視対象にする。
- `/unwatch-match @member` で、手動監視を解除する。
- 監視設定は `match_watchers` にギルド別で保存する。
- 通知先は `/watch-match` を実行したチャンネルを使う。

## 最小仕様案

1. ギルド単位でデフォルト監視を有効化する設定を持つ。
2. デフォルト監視の通知先チャンネルをギルド単位で保存する。
3. Riot ID 登録済みユーザーを、手動 `match_watchers` に存在しなくても有効監視対象として解決する。
4. 本人が opt-out した場合、そのギルドではデフォルト監視対象から除外する。
5. opt-out は永続化し、再起動後も維持する。

## issue 完全仕様との差分

未実装として管理する差分は次の通りです。

- ギルド管理者がデフォルト監視を有効化・無効化するコマンド。
- デフォルト監視の通知先チャンネル設定。
- opt-out / opt-in コマンド。
- opt-out 状態確認コマンド。
- 管理者による代理 opt-out / opt-in の許可可否。
- 手動 `/watch-match` と opt-out の優先順位。
- Riot ID 登録直後に自動監視へ入るか、次回 poll から入るか。
- デフォルト監視の対象条件を Riot ID 登録済みに限定するか、ロール条件も加えるか。
- 初回通知やプライバシー説明の文言。

## 推奨データモデル

候補テーブル:

- `guild_match_watch_settings`
  - `guild_id`
  - `default_watch_enabled`
  - `default_watch_channel_id`
  - `created_at`
  - `updated_at`
- `match_watcher_opt_outs`
  - `guild_id`
  - `target_discord_id`
  - `created_at`
  - `updated_at`

`match_watchers` は手動監視の明示設定として維持します。実効監視対象の解決では、手動監視とデフォルト監視を統合し、opt-out を最後に適用します。

## 優先順位案

1. 手動 `/unwatch-match` は手動監視を解除するだけで、デフォルト監視 opt-out とは別扱いにする。
2. 本人の opt-out は、手動監視とデフォルト監視のどちらよりも優先する。
3. 管理者による代理 opt-out は、権限設計を決めてから追加する。

## 次アクション

1. デフォルト監視の通知先チャンネル設定を決める。
2. `guild_match_watch_settings` と `match_watcher_opt_outs` の migration を追加する。
3. API route と db action を追加する。
4. Bot command を追加する。
5. 実効監視対象解決を `getEnabledMatchWatchers()` へ接続する。
6. opt-out と既存手動監視の優先順位をテストで固定する。
