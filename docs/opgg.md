# OP.GG戦績詳細リンクの仕様メモ

## 結論

issue #28 の外部戦績ページリンクは、OP.GGのプロフィールページではなく、試合ごとの戦績詳細ページを対象にします。
具体的な実装追跡は、#28 の子Issueである #53 と #56 で扱います。

ただし、ADTeemoがRiot Match-v5の結果だけからOP.GG戦績詳細URLを安定生成することはできません。OP.GGの戦績詳細URLにはRiotの `match.metadata.matchId` ではなく、OP.GG側の試合IDが必要です。

2026-06-18時点の調査では、OP.GGのプロフィールページが使うNext.js Server Actionを直接HTTP POSTすれば、ブラウザ操作なしで戦績一覧を取得できました。戦績一覧レスポンスには `id` と `created_at` が含まれるため、該当試合を照合できれば試合詳細URLを組み立てられます。

一方で、この取得経路はOP.GGの公開APIではなく、Next.jsの内部プロトコルとOP.GG側の実装に依存します。そのため、ADTeemoの必須機能にはせず、失敗しても既存通知を継続する任意連携として扱います。

そのため、現時点の仕様は次の方針にします。

- OP.GGプロフィールページへのリンクは表示しない。
- OP.GG戦績詳細リンクは、OP.GG側の試合IDを解決できる場合だけ追加表示する。
- OP.GG側の試合IDを解決できない場合、詳細リンクは表示しない。
- ブラウザ自動操作でOP.GGの更新ボタンをクリックする設計は採用しない。
- OP.GGの更新処理は、HTTPで `renewal` Server Actionを呼び出せる可能性がある。ただし外部状態を変更し、rate limitやOP.GG側仕様変更の影響を受けるため、設定で明示的に有効化された場合だけ使う。
- `renewal` 実行後の状態確認は負荷を抑えるため、3秒後に `renewalStatus` を1回だけ呼び出して終了する。継続pollingは行わない。
- OP.GGの未公開Server Actionに依存する処理は、タイムアウト、Action IDの動的抽出、キャッシュ、失敗時fallback、機能停止用の設定を必須にする。

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

2026-06-18の追加確認では、`renewal` 実行後に `renewalStatus` が `RENEWAL_FINISH` を返し、プロフィールHTMLの `initUpdatedAt` も更新後時刻へ反映されることを確認しました。これにより、少なくとも確認時点ではブラウザ操作なしでOP.GG側のプロフィール更新を開始し、その後の通常ページ取得にも反映されることが分かっています。

## 実装可能性

### 可能

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

### 採用しない / 制限する

理由:

- Playwright等でOP.GGを開き、DOMを操作する方式は採用しない。Discord Botの常駐処理にブラウザ自動操作を入れると、実行環境、rate limit、CAPTCHA、UI変更の影響を受けやすい。
- OP.GG Server Actionは公開APIではないため、本番の必須経路にはしない。
- OP.GG側の更新処理はOP.GGの状態と更新可能時刻に依存する。`renewal` を使う場合でも、3秒後に `renewalStatus` を1回確認して `RENEWAL_FINISH` でなければ詳細リンクを諦める。
- `renewalStatus` もOP.GG側の状態を返すため、完全な読み取り専用処理とは見なさない。
- プロフィールページを戦績詳細URLとして扱うことはしない。プロフィールリンクへのfallbackも行わない。

### Action IDの解決

Server Action IDは、OP.GG側のNext.jsビルドごとに変わるため、コード内に固定しません。

実装時は、OP.GG連携の初回実行時に対象サモナーのプロフィールHTMLを取得し、参照されているJavaScript chunkまたはServer Action manifest相当のデータから `getGames` / `renewal` / `renewalStatus` / `getGame` に対応するAction IDを抽出します。抽出できたAction IDはプロセス内で保持し、次回以降のOP.GG呼び出しでは保持済みの値を使います。

保持済みAction IDでServer Action呼び出しが失敗した場合、OP.GG側のビルド更新を疑い、プロフィールHTMLとchunkを再取得してAction IDを再抽出します。再抽出後に同じOP.GG操作を1回だけ再試行し、それでも失敗する場合はOP.GG詳細リンクとOP.GG由来情報を省略します。

この方針により、OP.GGのビルド更新に追従するための環境変数やコード更新を通常運用から外します。

### 更新可能時刻の扱い

`renewal` を呼ぶかどうかは、Bot側が独自に永続化した時刻ではなく、OP.GGプロフィールHTMLに含まれる更新状態を一次情報として判定します。プロフィールHTMLから最終更新時刻や更新可能状態を読み取れない場合は、`renewal` を呼ばずに詳細リンクなしでfallbackします。

Bot側では、同一プロセス内で同じ `region + puuid` に対して短時間に `renewal` を連打しないためのメモリ上の抑制だけを持ちます。この抑制はOP.GG側の状態より強い情報ではなく、Bot再起動後の復元対象にも含めません。複数Botプロセスで運用する必要が出た場合にのみ、DBや分散ロックによる抑制を再検討します。

## ADTeemo仕様への取り込み方

試合結果Embedに外部戦績リンクを追加する場合、リンク生成は次の入力を受け取るhelperに分離します。

- provider: 当面は `opgg`
- region slug: 例 `jp`
- gameName
- tagLine
- locale: 例 `ja`
- providerMatchId: OP.GG側の試合ID。詳細リンク生成時だけ必要。
- createdAtMs: 詳細リンク生成時だけ必要。

詳細リンクは `providerMatchId` がない場合に `null` を返し、Embedには詳細リンク欄を追加しません。これにより、外部サービス取得に失敗しても既存の試合結果通知は継続します。

OP.GG詳細リンク解決を有効にする場合は、次の順序にします。

1. Riot IDからOP.GGのsummoner slugとServer Action呼び出し先URLを生成する。
2. OP.GG連携の初回実行時、または保持済みAction IDで失敗した場合に、プロフィールHTMLとchunkからServer Action IDを抽出して保持する。
3. `getGames` Server Actionで最近の戦績一覧を取得する。
4. Match-v5の対象試合と、PUUID、試合開始時刻、champion、queue、game lengthなどで照合する。
5. 一致した場合だけ `buildOpggMatchDetailUrl` で詳細URLを生成する。
6. 一致しない場合、設定でOP.GG更新が有効かつプロフィールHTML上で更新可能と判断できる場合だけ `renewal` を呼ぶ。
7. `renewal` 実行から3秒後に `renewalStatus` を1回だけ呼ぶ。
8. `RENEWAL_FINISH` の場合だけ `getGames` を再実行する。
9. それでも一致しなければ詳細リンクを省略する。

外部呼び出しは短いtimeoutと回数上限を持ち、429 / 403 / HTML構造変更 / Server Action ID再抽出失敗時はログに残してfallbackします。

## 表示情報の優先順位

### レーン戦スコア

レーン戦スコアはRiot Match-v5から直接取得できないため、OP.GG試合詳細を取得できた場合だけ表示候補にします。

- 表示元: OP.GG詳細データの `lane_score`
- 表示条件: OP.GG詳細リンク解決または詳細データ取得に成功した場合
- fallback: 取得できない場合は表示しない

### 試合平均Tier

試合平均Tierは次の優先順位で扱います。

1. Match-v5の取得結果だけで算出できる場合は、ADTeemo側で算出した値を使う。
2. Match-v5参加者から各サモナーのプロフィールやランクを取得するために追加Riot API呼び出しが必要な場合は、OP.GGの `average_tier` を使う。
3. OP.GG詳細データも取得できない場合は表示しない。

この方針により、Riot APIへの追加負荷を避けつつ、OP.GG詳細が得られる場合だけ補助情報を増やします。

## 設定

OP.GG連携は未公開Server Actionに依存するため、環境変数で明示的に有効化します。ただし設定項目は増やしすぎず、連携全体を有効にするかどうかだけを扱います。

- `OPGG_ENABLED`: OP.GG試合詳細リンク解決、必要時の `renewal`、OP.GG詳細情報取得を有効にする。

`OPGG_ENABLED` が有効でない場合、ADTeemoはOP.GGへHTTPリクエストを送らず、既存の試合結果通知だけを継続します。

Server Action ID用の環境変数は設けません。Action IDは初回実行時にOP.GGから抽出して保持し、失敗時に再抽出します。

request timeout、照合許容幅、`renewalStatus` 確認までの3秒待機などは実装定数として管理します。
