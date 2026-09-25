# OP.GG Server Actionの観測記録

- Type: research
- Status: historical
- Summary: 未公開Server ActionのURL・Action ID・応答に関する過去の調査を保存する。
- Read when: OP.GG upstream変更の調査時。現在の接続保証として使わない。
- Related: [#53](https://github.com/akgm3i/ADTeemo/issues/53), [#56](https://github.com/akgm3i/ADTeemo/issues/56), [#129](https://github.com/akgm3i/ADTeemo/issues/129)
- Code: [client](../../api/src/integrations/opgg.ts)
- Tests: [client tests](../../api/src/integrations/opgg.test.ts)
- Reviewed: 2026-09-25
- Verified: 2026-06-19 (source record; not reverified)

- Observed: 2026-06-18 / 2026-06-19

この文書はnon-normativeな過去の観測記録である。2026-09-25は文書再編日であり、OP.GGへ再接続した日ではない。現在の運用は[連携ガイド](../integrations/opgg.md)、採用理由は[ADR 0005](../adr/0005-optional-opgg-integration.md)を参照する。

## 調査方法と出典

当時の調査では、プロフィール・試合詳細HTMLと参照JavaScript chunkを読み、Action名とIDを抽出し、HTTP POST応答とページ反映を比較した。以下のURL・応答は元メモに残された証拠であり、現在も到達可能とは限らない。`renewal` は外部状態を変更する操作である。

## 確認したURL構造

プロフィールページ:

```text
https://op.gg/ja/lol/summoners/jp/MelMe-darda
```

構成:

- `ja`: 表示言語。省略した `https://op.gg/lol/summoners/...` でもOP.GG側で英語ページとして表示される。
- `jp`: OP.GG上の地域slug。
- `MelMe-darda`: `gameName-tagLine` 形式のsummoner slug。

プロフィールページには戦績一覧と戦績更新ボタンがあります。ただしADTeemoの試合結果通知では、プロフィールページ自体へのリンクは表示しません。

試合詳細ページ:

例:

```text
https://op.gg/lol/summoners/jp/MelMe-darda/matches/QEguKI3c-BliQRVFs9XNvOWxr_s524kd/1781542840000
```

構成:

- `jp`: OP.GG上の地域slug。
- `MelMe-darda`: `gameName-tagLine` 形式のsummoner slug。
- `QEguKI3c-BliQRVFs9XNvOWxr_s524kd`: OP.GG側の試合ID。
- `1781542840000`: 試合作成時刻のUnix milliseconds。例では `2026-06-16T02:00:40+09:00` に対応する。

OP.GGの詳細ページHTMLには、対象試合データとして `id`, `created_at`, `game_name`, `tagline`, `puuid`, `participant_id` などが含まれていました。一方で、`id` はRiot Match-v5の `matchId` から推定できる形ではありませんでした。

2026-06-19の追加確認でも、既知のOP.GG詳細ページHTML内に `JP1_...` のようなRiot Match-v5の `metadata.matchId` 形式は見つかりませんでした。OP.GG詳細ページのURL path上の `gameId` はOP.GG側の試合IDであり、Riot Match-v5の `matchId` とは別物として扱います。

2026-06-18の追加確認では、`renewal` 実行後に `renewalStatus` が `RENEWAL_FINISH` を返し、プロフィールHTMLの `initUpdatedAt` も更新後時刻へ反映されることを確認しました。これにより、少なくとも確認時点ではブラウザ操作なしでOP.GG側のプロフィール更新を開始し、その後の通常ページ取得にも反映されることが分かっています。

## 観測時点の実装可能性

### 観測から可能と判断した範囲

- RiotアカウントからOP.GGのsummoner slugを作る。
- Server Action呼び出し先として、OP.GGプロフィールページURLを組み立てる。
- Riot Match-v5の `gameCreation` から `createdAt` millisecondsを作る。
- OP.GGの戦績一覧Server Actionから `id` と `created_at` を取得し、該当試合と照合できた場合に戦績詳細URLを組み立てる。
- OP.GG詳細データを取得できる場合、OP.GGが算出した `lane_score` をレーン戦スコアとして表示候補にする。
- OP.GG詳細データを取得できる場合、OP.GGが返す `average_tier` を試合平均Tierのfallbackとして使う。
- URL組み立てhelperを純粋関数として実装し、単体テストでslugのエンコード、地域slug、createdAtを固定する。

### 確認したServer Action

OP.GGプロフィールページのJavaScript chunkから、次のServer Actionを確認しました。Action IDはOP.GG側のビルドで変わるため、実装時に固定値としてハードコードしません。次の値は2026-06-18時点の調査メモです。

| 用途             | action名        | 2026-06-18時点の調査値                       | 主な引数                                                 |
| ---------------- | --------------- | -------------------------------------------- | -------------------------------------------------------- |
| 戦績一覧取得     | `getGames`      | `409a2b9ca50d15e50a4dace93552e3a40113dc2753` | `{ locale, region, puuid, gameType, endedAt, champion }` |
| 戦績更新開始     | `renewal`       | `405a04669583947dc03eb8c7f367adf28c8f714e86` | `{ region, puuid, isPremiumPrimary }`                    |
| 戦績更新状態確認 | `renewalStatus` | `400c02bdfd8c90756a329b312a7455e73880ad43ec` | `{ region, puuid }`                                      |
| 試合詳細取得     | `getGame`       | `402c95f7e1fc848a6cb2a7e0a1a13ad722c01e3c66` | `{ gameId, region, createdAt, locale }`                  |

`getGames` は、次のようなHTTP POSTで取得できることを確認しました。`Next-Action` の値は実行時に抽出済みのAction IDを使います。

```text
POST https://op.gg/ja/lol/summoners/jp/MelMe-darda
Accept: text/x-component
Next-Action: 409a2b9ca50d15e50a4dace93552e3a40113dc2753
Content-Type: text/plain;charset=UTF-8

[{"locale":"ja","region":"jp","puuid":"...","gameType":"TOTAL","endedAt":"","champion":""}]
```

レスポンスのaction resultには、OP.GG側の `id` と `created_at` が含まれます。例:

```json
{
  "id": "QEguKI3c-BlJMBryliBRPTOhC5B8DPr1",
  "created_at": "2026-06-18T00:06:11+09:00"
}
```

この場合の詳細URLは次の形式です。

```text
https://op.gg/ja/lol/summoners/jp/MelMe-darda/matches/QEguKI3c-BlJMBryliBRPTOhC5B8DPr1/1781708771000
```

2026-06-18の追加確認では、次のURLが `200` で到達可能でした。

```text
https://op.gg/ja/lol/summoners/jp/MelMe-darda/matches/QEguKI3c-BkyrIVYCjA57hxpJB_O3f0e/1781771329000
```

## 利用条件に関する過去の観測

2026-06-18の元メモでは、[robots.txt](https://op.gg/robots.txt)は全体を許可し、[OP.GGヘルプ](https://help.op.gg/hc/ja/articles/31091405109401-OP-GG%E3%83%87%E3%83%BC%E3%82%BF%E3%82%92%E4%BD%BF%E7%94%A8%E3%81%A7%E3%81%8D%E3%81%BE%E3%81%99%E3%81%8B)は一般的なクロールを禁止していないと記録されている。同じメモには、出典なしの商業利用や過剰リクエストは制限され得るという留保がある。これは現在の利用許諾を示さない。

## 未検証点と再確認条件

現在のAction ID、HTML/chunk構造、RSC応答schema、地域ごとの差、利用条件は再検証していない。Action不在、parse失敗、403/429、誤照合、再有効化または利用規模の変更を契機に、現行公式規約・ヘルプと実際の応答を確認する。Action IDをこの表から実装へコピーしない。外部検証時は対象と負荷を確認し、credentialやPUUIDを文書・fixtureへ保存しない。
