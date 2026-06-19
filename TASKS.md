# ADTeemo Roadmap Summary

ADTeemoの詳細な未実装・改善作業はGitHub Issuesを正として追跡する。このファイルは、現在の主要テーマとローカル文書から見た要約Roadmapである。

作業を追加・完了するときは、原則として関連issueを更新する。issue化されていない技術課題だけ、このファイルの「Issue化前の技術課題」に短く残す。

## Open Issues

- [ ] [#28 試合結果・試合中表示の拡張](https://github.com/akgm3i/ADTeemo/issues/28)
  - [x] `CS/min` を試合結果Embedに表示する。
  - [x] `キル関与率` を試合結果Embedに表示する。
  - [x] [#53 OP.GG試合詳細リンク解決と詳細データ取得](https://github.com/akgm3i/ADTeemo/issues/53)
  - [x] [#54 LP増減と現在ランク表示の取得・保存設計](https://github.com/akgm3i/ADTeemo/issues/54)
  - [x] [#55 試合結果・試合中Embedの追加表示項目とロール別優先順位の設計](https://github.com/akgm3i/ADTeemo/issues/55)
  - [x] [#56 OP.GG未公開Server Action依存の運用リスク整理](https://github.com/akgm3i/ADTeemo/issues/56)
  - [x] [#65 ロール別metric groupとダメージ表示](https://github.com/akgm3i/ADTeemo/issues/65)
  - [ ] [#66 試合結果・単独試合中Embedのチャンピオンthumbnail](https://github.com/akgm3i/ADTeemo/issues/66)
- [ ] [#34 デフォルト監視とopt-out](https://github.com/akgm3i/ADTeemo/issues/34)
  - [ ] Riot ID連携済みユーザーを既定監視候補にする。
  - [ ] opt-out / opt-inを永続化する。
  - [ ] Riot ID連携時と任意タイミングのopt-out導線を用意する。
  - [ ] ギルド単位の通知先チャンネル設定を追加する。
  - [ ] `/watch-match` / `/unwatch-match` の廃止または移行方針を決める。
- [ ] [#35 Discord connected accounts調査](https://github.com/akgm3i/ADTeemo/issues/35)
  - [x] Bot tokenだけでは任意GuildMemberのconnected accountsを読めないことを確認する。
  - [x] Discord OAuth2 `identify connections` とredirect URIが必要なことを整理する。
  - [ ] Discord OAuth2 redirect URIを決める。
  - [ ] 実データでConnection Objectの `type` / `name` / `id` を検証する。
  - [ ] Riot ID登録フローへ組み込めるか判断する。
- [ ] [#48 サブアカウント対応](https://github.com/akgm3i/ADTeemo/issues/48)
  - [ ] 1 Discordユーザーに複数Riotアカウントを登録できるDBモデルを設計する。
  - [ ] メインアカウントとサブアカウントの切り替え・表示方針を決める。
  - [ ] 登録済みアカウント一覧コマンドを設計する。
  - [ ] 登録解除コマンドをインタラクティブに設計する。
- [ ] [#49 Podman移行](https://github.com/akgm3i/ADTeemo/issues/49)
  - [ ] 現行Docker ComposeとPodman / Podman Composeの互換性を確認する。
  - [ ] 開発用profileと本番profileの起動手順を検証する。
  - [ ] DEVELOPMENT / AGENTSのコマンド表記を更新する。
  - [ ] CIへの影響を確認する。
- [ ] [#50 公式パッチノート通知](https://github.com/akgm3i/ADTeemo/issues/50)
  - [ ] 公式パッチノートの取得元と更新検知方法を決める。
  - [ ] ギルド単位の通知先チャンネル設定を設計する。
  - [ ] 重複通知防止のため、通知済み記事ID / URLを保存する。
  - [ ] 将来の他ニュース通知へ拡張できる設計にする。
- [ ] [#51 カスタムゲーム運営フロー](https://github.com/akgm3i/ADTeemo/issues/51)
  - [ ] 対象イベントを明示的に選べるUIを追加する。
  - [ ] 参加者不足・過多・ロール不足の通知を実装する。
  - [ ] 参加者確定、チーム分け、VC移動までのイベント状態遷移を設計する。
  - [ ] Message Componentsでキャンセル、再マッチング、次ゲームを操作できるようにする。
  - [ ] 募集チャンネル、VC、ロールIDなどのギルド設定を永続化する。

## Issue化前の技術課題

### 開発体験・CI

- [ ] CI要件を整理し、GitHub Actionsで `deno task quality` を実行するworkflowを追加する。
- [ ] Docker内テストの標準コマンド `docker compose --profile dev run --rm dev deno task test:all` をCIまたはREADMEに組み込むか判断する。
- [ ] `deno task test:all` が必要とする `--allow-sys` / `--allow-ffi` 権限を、DB factory導入後に縮小できるか確認する。

### API・DB

- [ ] `api/src/db/index.ts` の module-level `db` singletonを段階的に解消し、`createDb(url)` と `createApp({ dbActions })` を導入する。
- [ ] DB action tests を一時 SQLite DBで隔離できるようにする。
- [ ] `users.riotId` のレガシー性を整理し、不要であれば削除または正しいモデル名へ移行する。
- [ ] `matches` はグローバル戦績として維持しつつ、開催元の `guild_id` または `custom_game_event_id` を参照できるようにする。
- [ ] ギルド固有設定テーブルとAPIを設計する。対象は募集チャンネル、Lobby/Red/Blue VC、ロールID、イベント操作権限など。
- [ ] `api/src/routes/matches.ts` に試合レコード作成APIを追加し、`/record-match` と `matches` / `match_participants` を正しく接続する。
- [ ] APIエラー形式を `{ error: string }` 基本形、必要時 `{ code, error, details }` に統一し、主要route testsでHTTP APIレスポンスに `success` が含まれないことを確認する。

### Bot・イベント運営

- [ ] `/setup-roles` をギルド設定の再同期コマンドとして扱い、既存ロールID更新と不足ロール作成を同時に行えるようにする。
- [ ] 募集メッセージをロールIDメンションに対応させ、`@Custom` 文字列依存を解消する。
- [ ] コマンド全体のサブコマンド化またはイベント中心フローへの段階移行を検討する。

### 戦績・レート

- [ ] `/record-match` の戦績入力を Message ComponentsやModal Componentsで簡易化する。
- [ ] Match-v5で取得した戦績を `matches` / `match_participants` に保存し、内部レート更新へ接続する。
- [ ] 内部レートを全ギルド共有のプレイヤー評価として保存するスキーマと更新ロジックを設計する。
- [ ] チーム分け時の戦力均等化ロジックと内部レート計算式を高度化する。
- [ ] `/my-stats` など、個人戦績を確認する追加コマンドを設計・実装する。

### Web UI

- [ ] Webサイトの要件定義を実施し、管理者・参加者向けの主要ユースケースとAPI連携要件を整理する。
- [ ] 要件に基づきWeb UIを実装する。
