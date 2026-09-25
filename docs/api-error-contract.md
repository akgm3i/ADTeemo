# APIエラー契約

- Type: integration
- Status: current
- Summary: 公開HTTP応答契約とBot内部Resultの変換境界。
- Read when: route・RPC schema・エラー応答を変更するとき。
- Related: [#115](https://github.com/akgm3i/ADTeemo/issues/115)
- Code: [error contract](../api/src/contract/errors.ts), [API errors](../api/src/api_errors.ts)
- Tests: [error contract tests](../api/src/error_contract.test.ts)
- Reviewed: 2026-09-25
- Verified: local code review, 2026-09-25

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
