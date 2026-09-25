# カスタムゲームの運営

- Type: user
- Status: current
- Summary: 募集、ロール、チーム分け、取消、戦績記録の現行操作。
- Read when: Discordでカスタムゲームを運営するとき。
- Related: [#51](https://github.com/akgm3i/ADTeemo/issues/51), [#113](https://github.com/akgm3i/ADTeemo/issues/113), [#114](https://github.com/akgm3i/ADTeemo/issues/114)
- Code: [commands](../../bot/src/commands), [registry](../../bot/src/common/command_registry.ts)
- Tests: [create tests](../../bot/src/commands/create-custom-game.test.ts), [record tests](../../bot/src/commands/record-match.test.ts)
- Reviewed: 2026-09-25
- Verified: 2026-09-25、command / repository tests。実Discordへの登録・VC移動は未実施。

## 準備と募集

`/set-riot-id`でRiot IDを登録します。複数登録時は`/riot-accounts action:main`でカスタムゲームに使うメインアカウントを選び、`/set-main-role`でギルドごとのメインロールを設定します。`/setup-roles`はTop、JG、Mid、Bot、Sup、Customロールの不足分を作成します。

`/create-custom-game`でタイトル、日付、時刻、VCを指定すると、Discordスケジュールイベントを作り、実行チャンネルへロール別リアクション付きの募集を投稿します。未完了の作成が残る場合は、同じcommandを繰り返して別イベントを増やさず、`/cancel-custom-game`から対象を確認します。復旧の詳しい扱いは[整合性と復旧](../custom-game-event-consistency.md)に従います。

## ギルド設定とチーム分け

管理者は募集チャンネルとLobby・Red・Blueの3つのVCを用意し、`/setup-custom-game recruitment:<募集先> lobby:<集合VC> red:<赤VC> blue:<青VC>`で確認・保存します。各VCは別のものを選びます。ロールは`/setup-roles`で作成し、同名ロールが複数ある場合は整理してください。設定はギルド別にchannel ID・role IDで保持するため、VCの名前を変更しても利用できます。削除・作り直し後は設定し直します。募集の投稿先は`/create-custom-game`を実行したチャンネル、イベントのVCはその`voice`指定です。

募集チャンネルで`/start-matching`を使うと、自分が作成したイベントをメニューから選べます。開始日が今日でないイベントも対象です。先頭25件以外は`/split-teams event:<ID>`で直接指定します。`event`省略時だけ、従来どおり今日開始のイベントを選びます。他の主催者・ギルド・募集チャンネルのイベントは操作できません。

参加者は異なる10人、各ロール2人ずつ必要です。人数不足・過多、ロール人数不足は通知し、参加者確定やVC移動を開始しません。初回はロールごとにランダムに2チームへ割り当て、ロスターを一度だけ確定保存してから設定済みのRed/Blue VCへ移動し、結果を表示します。内部レートやランクによる戦力均等化は現在の操作に含まれません。

複数の開始操作が競合した場合は先に保存した割当を保持し、後続操作はVC移動前に止まります。VC移動が途中で失敗した場合も同じイベントで再実行します。保存済みロスターを使うため再抽選されません。退出者などを取得できない場合も成功表示せず、参加者の状態を修正してから再試行します。

## 次ゲーム

`/next-game event:<ID>`は確定参加者を設定済みLobbyへ戻し、保存済み戦績の次のgame番号を案内します。同じチームで再戦する場合は`/split-teams event:<ID>`でチームVCへ戻り、終了後に表示された番号で記録します。VC移動の再実行ではgame番号を消費しません。戦績が保存されるまでは同じ次番号を返します。

現在の次ゲームは同じ参加者・チームを維持します。サイド交代・再抽選・メンバー入替えには新規イベントを使ってください。既存戦績の所属チームを後から変えないためです。

## 戦績と取消

`/record-match winner:<BLUE|RED> [game:<正整数>] [event:<ID>]`で確定参加者のKDA、CS、Goldを対話形式で入力します。eventを指定するとそのイベント、省略すると今日開始のイベントが対象です。gameを省略すると1です。同じ試合の再送では同じ番号と内容を使い、次ゲームには別の番号を指定します。全員のRiot ID登録が必要です。

保存済み戦績の上書きは行いません。一部だけを保存せず、試合と全参加者をまとめて保存します。1試合でも記録した後はイベントの確定参加者割当を変更できません。[戦績整合性ガイド](../record-match-consistency.md)に再送・移行時の扱いを記載しています。

`/cancel-custom-game`では、自分が現在のギルド・募集チャンネルで作成した有効なイベントを選択します。候補が25件を超える場合は`/cancel-custom-game event:<イベントID>`で対象を絞れます。指定できるのは同じギルド・募集チャンネルで自分が作成したイベントです。取消が途中で失敗した場合も同じ対象から再試行できます。

現在有効なcommandとoptionの正本はregistryと各command定義です。[イベント中心フロー案](../proposals/custom-game-flow.md)は将来案として区別します。
