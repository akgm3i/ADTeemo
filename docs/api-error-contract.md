# APIエラー契約

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

## HTTP statusとcode

| Status | Code | 利用条件 |
| --- | --- | --- |
| 400 | `INVALID_JSON` | JSON request bodyを構文解析できない |
| 400 | `INVALID_REQUEST` | 構文とschemaは妥当だが、stateなどrequest全体の前提を満たさない |
| 400 | `OPGG_PARTICIPANT_MISMATCH` | 指定した試合参加者が連携済みRiotアカウントと一致しない |
| 401 | `UNAUTHORIZED` | Bot service credentialがない、不正、または期限切れである |
| 403 | `FORBIDDEN` | 認証済みだが対象操作の権限がない。現在のrouteでは未使用 |
| 404 | `ROUTE_NOT_FOUND` | API routeが存在しない |
| 404 | `RESOURCE_NOT_FOUND` | 個別codeを持たない対象resourceが存在しない |
| 404 | `EVENT_NOT_FOUND` | 対象イベントが存在しない |
| 404 | `RIOT_ACCOUNT_NOT_FOUND` | 対象DiscordユーザーにRiotアカウントが連携されていない、またはRiot IDを解決できない |
| 409 | `CONFLICT` | 個別codeを持たないresource状態の競合が発生した。現在のrouteでは未使用 |
| 409 | `MATCH_WATCHER_LIMIT_REACHED` | ギルドの有効な試合監視数が上限に達した |
| 422 | `VALIDATION_ERROR` | query、path parameter、JSON bodyが定義済みschemaに一致しない |
| 429 | `RATE_LIMITED` | API自身が呼び出し側へ再試行待機を要求する。現在のrouteでは未使用 |
| 500 | `INTERNAL_ERROR` | repository失敗や未処理例外など、呼び出し側が修正できない内部失敗が発生した |
| 502 | `RIOT_API_UNAVAILABLE` | Riot APIとの通信または応答処理に失敗した |
| 502 | `RIOT_STATIC_DATA_UNAVAILABLE` | Riot静的データの取得または解決に失敗した |

`api/src/contract/errors.ts` の `API_ERROR_STATUS_BY_CODE` を実行時とBot clientが共有する正本とし、表を変更する場合はschema、contract test、本文書を同時に更新します。

## 変換境界

- `zValidator` は共通hookを使い、malformed JSONを400、schema不一致を422へ変換します。
- routeが扱うdomain resultや既知例外は、route境界で対応する公開codeへ変換します。例外の自由記述messageはレスポンスへ転記しません。
- `notFound` は404の `ROUTE_NOT_FOUND`、`onError` は安全なJSON 500へ変換します。
- upstream失敗をcatchするrouteは公開用の安定した502へ変換し、元例外と `remote_api` 分類をrequest failureへ渡します。
- 5xxではSQL、stack、credential、provider response bodyなどの内部詳細をレスポンスにもstructured contextにも含めません。
- Bot API clientは共通schemaをparseし、HTTP statusとcodeの対応も検証してから内部の `Result.success` 形式へ変換します。通信失敗と契約不整合にはHTTP status/codeがないため、公開エラーとは別の内部失敗として扱います。

成功時の `204 No Content` と、RSO callback成功時のHTMLはこのJSON形式の対象外です。エラー時に共通JSON形式から外れるrouteはありません。
