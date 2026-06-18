# デフォルト監視とopt-outの仕様メモ

## 結論

issue #34 の現時点の方針は、Riot ID連携済みユーザーをギルド単位で既定の試合監視対象にし、ユーザーがopt-outできるようにすることです。

2026-06時点のissueコメントでは、既存の手動 `/watch-match` / `/unwatch-match` を削除してよい可能性が示されています。そのため、この文書では「手動監視を維持する案」ではなく、「Botは常に監視状態で、Riot ID連携時に監視候補へ入る案」を主案として扱います。

## 現行仕様

- `/watch-match @member` で、Riot ID登録済みメンバーを手動で監視対象にする。
- `/unwatch-match @member` で、手動監視を解除する。
- `/watch-list` で、ギルド内の有効な手動監視対象一覧を表示する。
- 監視設定は `match_watchers` にギルド別で保存する。
- 通知先は `/watch-match` を実行したチャンネルを使う。

## 目標仕様

- ギルド単位で試合監視を有効化する。
- ギルド単位で既定の通知先チャンネルを保存する。
- Riot ID登録済みユーザーを、明示的な手動watch登録なしで監視候補にする。
- Riot ID連携時、ユーザーがopt-outするかどうかを選べる導線を用意する。
- ユーザーは任意のタイミングでopt-out / opt-inを変更できる。
- opt-outは永続化し、再起動後も維持する。
- opt-out済みユーザーは実効監視対象から除外する。

## 手動監視コマンドの扱い

新方針では `/watch-match` と `/unwatch-match` は廃止候補です。

- `/watch-match` の役割はRiot ID連携済みユーザーの既定監視で置き換える。
- `/unwatch-match` の役割はopt-outで置き換える。
- `/watch-list` は実効監視対象またはopt-out状態の確認コマンドとして再設計する余地がある。
- 廃止時は既存 `match_watchers` の移行方針を決める必要がある。

## 推奨データモデル

候補テーブル:

- `guild_match_watch_settings`
  - `guild_id`: Primary Key。`guilds.id` を参照する。
  - `enabled`
  - `notification_channel_id`
  - `created_at`
  - `updated_at`
- `match_watcher_opt_outs`
  - `guild_id`: `(guild_id, target_discord_id)` の複合 Primary Key。`guilds.id` を参照する。
  - `target_discord_id`: `(guild_id, target_discord_id)` の複合 Primary Key。`users.discord_id` を参照する。
  - `created_at`
  - `updated_at`

`match_watchers` は移行期間中の手動監視設定として維持し、廃止時に削除またはmigrationで整理するか判断します。

## 実効監視対象の解決案

実効監視対象は次の順で解決します。

1. ギルドの試合監視設定が有効で、通知先チャンネルが設定されていることを確認する。
2. Riot ID連携済みユーザーを候補として取得する。
3. ギルドごとのopt-outを適用して除外する。
4. 移行期間中のみ、既存 `match_watchers` の手動監視対象を必要に応じて統合する。
5. Riot APIの負荷上限に合わせて、実効監視対象数の制限と通知を行う。

## 未決定事項

- ギルド単位の監視を既定で有効にするか、管理者が明示的に有効化するか。
- Riot ID連携時のopt-out UIをボタン、セレクト、Modalのどれで実装するか。
- opt-out / opt-inをユーザー本人だけに許可するか、管理者による代理操作も許可するか。
- `Custom` ロールなど、Riot ID登録以外の監視対象条件を追加するか。
- 初回通知やプライバシー説明の文言。
- 既存 `match_watchers` データの移行・削除方針。
- `/watch-list` の新しい表示範囲。

## 次アクション

- [ ] ギルド単位の通知先チャンネル設定を決める。
- [ ] `guild_match_watch_settings` と `match_watcher_opt_outs` のmigrationを追加する。
- [ ] API routeとdb actionを追加する。
- [ ] Riot ID連携時のopt-out導線と、任意タイミングのopt-out / opt-inコマンドを設計する。
- [ ] 実効監視対象解決を監視ループへ接続する。
- [ ] `/watch-match` / `/unwatch-match` / `/watch-list` の廃止または再設計を決める。
- [ ] opt-out、通知先未設定、既存手動監視からの移行をテストで固定する。
