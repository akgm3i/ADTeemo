# 構成とデータ所有境界

- Type: integration
- Status: current
- Summary: Bot/API/DBの責務と変更時に読む正本。
- Read when: workspace境界、DBモデル、外部API取得を変更するとき。
- Related: [#69](https://github.com/akgm3i/ADTeemo/issues/69), [#112](https://github.com/akgm3i/ADTeemo/issues/112), [#113](https://github.com/akgm3i/ADTeemo/issues/113), [#114](https://github.com/akgm3i/ADTeemo/issues/114)
- Code: [API app](../../api/src/app.ts), [Bot main](../../bot/src/main.ts), [schema](../../api/src/db/schema.ts)
- Tests: [Bot boundary tests](../../bot/check-runtime-boundary.test.ts), [repository tests](../../api/src/db/repositories.integration.test.ts)
- Reviewed: 2026-09-29
- Verified: 2026-09-29、local code reviewと一時SQLiteの並行更新・rollbackテスト。外部サービス実通信は未実施。

## 構成

```mermaid
graph LR
    User[Discord利用者] --> Discord[Discord]
    Discord --> Bot[Bot]
    Bot --> API[Backend API]
    API --> DB[(SQLite)]
    API --> Riot[Riot API / static data]
    API --> Opgg[任意のOP.GG連携]
    Bot --> Discord
```

Botはinteraction解釈・表示・Discord操作を担い、Riot API、静的データ、OP.GG、DB操作はBackend APIへ集約する。各workspaceの依存・実行taskはdeno.json、実行環境・Docker・設定は[CONTRIBUTING](../../CONTRIBUTING.md)を参照する。

## データ所有境界

プレイヤー本人のDiscord identity、Riot account、戦績はグローバルに扱う。メインロールはuserとguildの組、募集イベントとwatcherはguild単位で扱う。戦績は開催元eventとgame番号を参照し、記録時のPUUID snapshotを保持する。内部レートを採用する場合も全ギルド共有のプレイヤー評価という境界を維持するが、算出・集計は別の採用判断である。

Discord側resource ID、募集channel、使用VC、saga状態はeventの所有情報である。guild設定とrole IDはguild別、Riot accountはPUUID単位でDiscord所有者とメイン指定を保持する。監視は全登録account、カスタムゲームはメイン1件を使う。[ADR 0006](../adr/0006-account-monitoring-policy.md)とschemaを正とし、Proposalの候補tableを現行モデルとみなさない。

## 不変条件と入口

- 認証と外部到達性: [ADR 0001](../adr/0001-bot-service-authentication.md)。Bot credentialを他サービスの秘密値と共有しない。
- ログ: [ADR 0002](../adr/0002-structured-logging-trust-boundary.md)。stdout構造化ログを正本にし、opaqueなError本文や個人識別子を保存しない。
- HTTPエラー: [APIエラー契約](../api-error-contract.md)。成否はHTTP statusで判定し、HTTP bodyにsuccessを持たせない。
- 外部副作用とDB: [イベント整合性](../custom-game-event-consistency.md)、[戦績整合性](../record-match-consistency.md)。scope、冪等性、transactionと復旧をそれぞれの境界で守る。
- 監視通知: [表示ADR](../adr/0003-match-display-priorities.md)、[ランクADR](../adr/0004-ranked-snapshot-lifecycle.md)、[OP.GG連携](./opgg.md)。
- 文言: [messages編集ガイド](../../messages/README.md)。実際の文言はcatalogだけに保持する。

## SQLite操作の直列化

本番は1つの`Database`を[DB action factory](../../api/src/db/actions.ts)へ渡す。全repositoryの公開actionはこのDB単位で同じqueueを共有する。transactionを使わない更新と、一覧取得中にwatcherを再調整するactionも対象である。同じDBから複数のaction集合を生成してもqueueを共有し、別のテストDBは独立する。

[SQLiteは同じDBへのwriterを同時に1つに制限する](https://www.sqlite.org/isolation.html)。固定依存`@libsql/client 0.15.15`のlocal実装はtransaction開始後に通常操作用の接続を別途作るため、機能別のqueueでは`SQLITE_BUSY`を防げない。公開action全体を直列化し、失敗後もqueueを進める。読み取りだけのactionも同じ入口を通す小さな構成とし、全actionに外部HTTP待ちを含めない。transactionは原子的保存とrollbackを引き続き担う。

内部repository関数とtransaction内SQLは再enqueueしない。イベントrosterとカスタム戦績だけの専用queueは廃止した。[並行書き込みテスト](../../api/src/db/writes.integration.test.ts)と[repository tests](../../api/src/db/repositories.integration.test.ts)が競合、rollback後の継続、再送の保証を持つ。queueはprocessと`Database`インスタンスの範囲であり、同じファイルを複数のAPI processや独立した接続factoryから更新する運用を追加する場合は、書き込み所有者を改めて設計する。migrationは稼働中のAPIと競合させない。

## Riot共有queue

Riotへの呼び出しはBackend API process内の共有queueへ集約する。routing hostnameとmethodに応じたcooldown、rate-limit header、Retry-Afterを後続requestへ反映する。送信可能attemptはFIFOで直列化し、特定scopeの待機中は他scopeの送信slotを塞がない。timeout・network・429・5xxに限定したbounded retryと要求全体のdeadlineを持つ。

正確なtimeout、attempt数、backoff、header処理は[queue実装](../../api/src/riot_api.ts)と[tests](../../api/src/riot_api_queue.test.ts)が正本。queueはprocess-localなので、標準運用はAPI 1 processとする。Bot sagaの排他もprocess-localであり、複数instance導入前に共有claimと状態を設計する。運用手順はCONTRIBUTINGへ集約する。
