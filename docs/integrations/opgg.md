# OP.GG連携の運用

- Type: integration
- Status: current
- Summary: 有効化、処理境界、障害時fallbackと再確認条件。
- Read when: OP.GG設定変更・外部詳細取得の障害調査時。
- Related: [#53](https://github.com/akgm3i/ADTeemo/issues/53), [#56](https://github.com/akgm3i/ADTeemo/issues/56), [#73](https://github.com/akgm3i/ADTeemo/issues/73)
- Code: [client](../../api/src/integrations/opgg.ts), [service](../../api/src/services/opgg_match_detail.ts)
- Tests: [client tests](../../api/src/integrations/opgg.test.ts), [service tests](../../api/src/services/opgg_match_detail.test.ts)
- Reviewed: 2026-09-25
- Verified: local implementation only, 2026-09-25; upstream last observed 2026-06-19

Backend APIの`OPGG_ENABLED`で連携全体を制御する。無効時はHTTPを送らず、BotはOP.GG欄なしで通知を続ける。有効化は必要時の`renewal`によるOP.GG側更新も含む。Botはこの設定を参照しない。

## 処理の流れ

1. canonical Riot accountと対象participantのPUUIDを照合する。
2. Riot accountから地域・summoner slugを作り、Action IDをプロフィールHTML/chunkから取得する。
3. 最近の戦績を取得し、対象試合と一意に照合できれば詳細を取得する。
4. 不一致の場合、設定が有効かつOP.GGが更新可能な場合だけ更新する。boundedな待機後に状態を1回確認し、完了時だけ再照合する。
5. 正規化した外部詳細だけを保存し、基本の試合結果へ補足する。

Action失効時の再抽出条件、timeout、retry上限、照合許容差、URLエンコード、更新抑制と保存一意制約はCode/Testsが正本である。[ADR 0005](../adr/0005-optional-opgg-integration.md)に理由を記録している。

## 障害調査

無効、該当試合なし、更新不可は通常の補足省略として扱う。Action抽出、schema、403/429、timeoutの失敗は構造化ログのeventと分類を確認する。raw response、HTML、PUUIDやtokenをログへ追加しない。継続失敗では設定で無効化し、基本通知への影響を切り離せる。

外部接続は2026-09-25の文書再編時には検証していない。観測済みAction IDや応答は[日付付きResearch](../research/opgg-server-actions.md)だけに置く。upstream変更、誤照合、再有効化、利用規模変更時は公式利用条件と実応答を再確認する。
