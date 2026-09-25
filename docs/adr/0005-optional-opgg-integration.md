# ADR 0005: OP.GGを失敗可能な任意連携に限定する

- Type: adr
- Status: accepted
- Summary: 未公開API依存を基本通知とRiot戦績の保存から分離する。
- Read when: OP.GG取得・保存・有効化・再試行の変更時。
- Related: [#53](https://github.com/akgm3i/ADTeemo/issues/53), [#56](https://github.com/akgm3i/ADTeemo/issues/56), [#73](https://github.com/akgm3i/ADTeemo/issues/73)
- Code: [client](../../api/src/integrations/opgg.ts), [service](../../api/src/services/opgg_match_detail.ts)
- Tests: [client tests](../../api/src/integrations/opgg.test.ts), [service tests](../../api/src/services/opgg_match_detail.test.ts)
- Reviewed: 2026-09-25
- Verified: local code review, 2026-09-25

## Context

OP.GGの試合詳細URLは独自の試合IDを必要とし、Riot match IDだけから安全に生成できない。過去の[Server Action調査](../research/opgg-server-actions.md)ではHTTPから詳細解決できたが、公開APIの安定契約ではない。

## Decision

- Backend APIだけがOP.GGと通信し、`OPGG_ENABLED`で明示的に有効化する。無効時はリクエストを送らない。
- 詳細リンクを一意に解決できた場合だけ補足を表示し、失敗時もRiot由来の基本通知を続ける。プロフィールリンクへのfallbackはしない。
- Action IDはHTML/chunkから動的に抽出してprocess内cacheに保持する。Server Action不在と分かる失効時だけbounded retryを行い、通常の失敗で追加アクセスを増やさない。
- 更新が必要な場合もOP.GG側の更新可能状態を優先し、process内の短時間抑制を併用する。状態を読み取れなければ更新せず省略する。更新完了を継続pollingしない。
- PUUID、champion、対応可能なqueue、時刻・試合長の複合条件で照合し、一意に決まらなければ誤リンク回避を優先する。
- raw HTML/RSC/JSONをDBに保存せず、matchごとの外部詳細とparticipantごとの補助値を別tableへ正規化する。Riot由来の主要戦績へprovider固有fieldを混ぜない。
- レーン戦スコアと平均Tierは取得できた場合だけ、出典が分かるOP.GG詳細リンクとともに表示する。平均Tierのためだけに全参加者のRiotランクAPIを追加取得しない。

## Consequences

外部仕様変更時に補助欄が欠けることを許容する。Action抽出用fixtureは必要最小限のHTML/chunk、応答fixtureは表示・照合に必要な値に限定する。timeout、照合幅、retry、更新待機はCode/Testsの正本を使い、環境変数を増やして同期しない。

process内抑制は分散保証ではない。複数API instanceを導入する前に共有抑制を別途判断する。利用条件は有効化・利用規模変更時に再確認する。

## Rejected alternatives

- ブラウザ自動操作: 常駐Botへブラウザ、UI変更、CAPTCHAの運用負担を持ち込む。
- 必須経路化: 未公開プロトコルの障害で基本通知まで止まる。
- Action IDの固定値・環境変数化: upstream buildごとの手動更新が必要になる。
- 曖昧な候補の採用やプロフィール代替: 該当試合への正確な導線を保証できない。
- raw payload保存: providerの構造変更と個人情報を主要データモデルへ持ち込む。

## Enforcement

上記client/service tests、[DB schema](../../api/src/db/schema.ts)、[repository tests](../../api/src/db/repositories.integration.test.ts)を参照する。障害時の運用は[連携ガイド](../integrations/opgg.md)に従う。
