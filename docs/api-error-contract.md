# APIエラー契約

- Type: integration
- Status: current
- Summary: 公開HTTP応答契約とBot内部Resultの変換境界。
- Read when: route・RPC schema・エラー応答を変更するとき。
- Related: [#115](https://github.com/akgm3i/ADTeemo/issues/115)
- Code: [error contract](../api/src/contract/errors.ts), [API errors](../api/src/api_errors.ts)
- Tests: [error contract tests](../api/src/error_contract.test.ts), [Riot応答診断](../api/src/riot_api_diagnostics.test.ts), [Riot応答の正規化](../api/src/riot_api.test.ts)
- Reviewed: 2026-09-26
- Verified: 2026-09-26、local code review・qualityと、実Riot応答のnull PUUIDによる502の再現・正規化後の監視復旧と、Match-v5の403を専用codeへ分類した両guildの取得不可通知を確認。

Backend APIの成否はHTTPステータスだけで判定します。すべてのエラーレスポンスは `application/json` で、次の共通形式を使います。

```json
{
  "code": "RIOT_ACCOUNT_NOT_FOUND",
  "message": "Riot account not found"
}
```

`code` はBotなどの呼び出し側が分岐する安定した識別子、`message` は利用者へ提示できる公開文言です。レスポンスへ `success` や旧形式の `error` は含めません。

`details` は入力検証に失敗した場合だけ使用し、Zod issueの `code` と `path` だけを公開します。入力値、Zodの自由記述message、expected/received、request bodyは公開しません。

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "issues": [
      { "code": "invalid_type", "path": ["name"] }
    ]
  }
}
```

## HTTP statusとcodeの正本

[api/src/contract/errors.ts](../api/src/contract/errors.ts)の`API_ERROR_STATUS_BY_CODE`を実行時とBot clientが共有します。全code/status表を文書へ複製せず、変更時はschemaと[contract tests](../api/src/contract/errors.test.ts)、[route契約テスト](../api/src/error_contract.test.ts)を更新します。

malformed JSONとschema不一致、未認証、対象なし、状態競合、内部失敗、upstream失敗を、それぞれの公開codeとして区別します。個々の対応statusは上記定義を参照してください。

## 変換境界

- `zValidator` は共通hookを使い、malformed JSONを400、schema不一致を422へ変換します。
- routeが扱うdomain resultや既知例外は、route境界で対応する公開codeへ変換します。例外の自由記述messageはレスポンスへ転記しません。
- `notFound` は404の `ROUTE_NOT_FOUND`、`onError` は安全なJSON 500へ変換します。
- upstream失敗をcatchするrouteは公開用の安定した502へ変換し、元例外と `remote_api` 分類をrequest failureへ渡します。
- 5xxではSQL、stack、credential、provider response bodyなどの内部詳細をレスポンスにもstructured contextにも含めません。
- Bot API clientは共通schemaをparseし、HTTP statusとcodeの対応も検証してから内部の `Result.success` 形式へ変換します。通信失敗と契約不整合にはHTTP status/codeがないため、公開エラーとは別の内部失敗として扱います。

成功時の `204 No Content` と、RSO callback成功時のHTMLはこのJSON形式の対象外です。エラー時に共通JSON形式から外れるrouteはありません。

## 成功レスポンスと契約違反

全2xxのstatus/schemaは[responseContracts](../api/src/contract/responses.ts)が正本です。`createApp`のresponse middlewareとBot clientが同じschemaで検証し、providerとconsumerの契約を別々に宣言しません。

正常な空結果は`match: null`、`activeGame: null`、`detail: null`、`entries: []`など、そのendpointに定義されたwrapperで表します。JSON body自体のnull、必須field欠落、不正な日時は成功扱いにしません。本文不要のendpointだけ204を許可し、JSONを返す契約のendpointで204を返すことも契約違反です。

Botでは不正な2xxを`ApiContractError`（`kind: contract_error`）へ変換し、公開HTTPエラーや通信失敗と区別します。provider側の不正応答は安全な500へ閉じ、内部値をレスポンスへ漏らしません。

実providerとの対応は[contract app tests](../api/src/contract/app.test.ts)、resourceごとのparse・失敗は[Bot resource tests](../bot/src/api_clients)で検証します。facadeの[api_client.test.ts](../bot/src/api_client.test.ts)は組み立てを検証し、各resourceの全挙動を複製しません。fakeの未定義呼出し・未消費応答の扱いは[テスト方針](../TESTING_STYLE.md)に従います。

## 試合結果へのアクセス拒否

結果検査のMatch-v5呼出しで`RiotApiRequestError`のHTTP 403を受けた場合は、`502 / RIOT_MATCH_ACCESS_DENIED`として返す。正常な未反映（200の`match: null`）、通信失敗・429・5xxの`RIOT_API_UNAVAILABLE`と区別し、provider失敗を成功レスポンスへ変換しない。元例外は`remote_api`として記録し、公開本文にprovider本文やcredentialを含めない。この分類は結果検査に限り、Spectator等の403は変更しない。

Botは取得拒否を終端の取得不可通知として扱い、通知完了後にその試合の結果待ちを解除する。403はモードの非公開以外に認証・権限の問題でも起こるため、文言で特定モード非対応やキー失効と断定しない。対象試合IDと通知はoutboxに残り、APIキー等の設定を直しただけで過去の拒否された試合を自動再取得する仕様ではない。

## Riot応答の検証失敗の診断

Riotが2xxを返しても、JSON解析または消費するfieldのschema検証に失敗した場合は、従来どおり成功に変換せず502へ分類する。`riot_api.invalid_response` に固定の `reason`（`parse` / `schema`）、個人識別子を含まないmethod template、Riot側HTTP statusを記録する。schema失敗では `issueCode` と固定field名・配列indexからなる `path` も残す。入力値、provider本文、Zodの自由記述messageは記録しない。診断出力自体の失敗で元の失敗種別を置き換えない。

2026-09-26の実環境では、1試合目の結果配送後にwatcherがIDLEへ戻った一方、2試合目の進行中だけactive-game検査が毎分502になった。既存ログには `RiotApiRequestError` の名前しかなく、当時の解析・検証失敗の項目は確定できなかった。診断を反映した次の実試合で、参加者の `puuid: null` による同じ502を再現した。Riotは200を返しており、監視対象者自身のPUUIDは取得できていた。

Spectator-v5の参加者PUUIDは、Riot境界で `null` を既存契約のID省略へ正規化する。参加者そのものや試合全体を捨てず、取得できた監視対象者のID・champion・team情報は保持する。HTTP契約のPUUIDは従来どおり省略可能な文字列であり、他fieldの型不正は引き続き失敗とする。Riotの応答形式が変わる場合は、実際の検証項目を確認してから正規化範囲を見直す。

正規化を検証APIへ反映した後、同日の13:56 JSTの通常workerで同じ実試合のactive-game検査が200となり、2guildの開始通知が `delivered`、watcherが `IN_GAME` へ進んだ。Botの監視設定やDB状態を手作業で修正せず復旧した。検知できなかった過去試合の通知を遡って生成する変更は含まない。
