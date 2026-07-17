# ADR 0002: 構造化ログの信頼境界をfield schemaに置く

- Status: Accepted
- Date: 2026-07-17
- Related: GitHub Issue #121

## Context

APIとBotはstdoutの1行JSONを本番ログの正本とする。Issue #121では、credential、OAuth値、Riot識別子、Discord user ID、SQL parameterを記録せず、相関IDやerror categoryなどの診断情報を維持することを決めた。

`Error.message`、stack、文字列causeへ構造を持たない秘密値が含まれる場合に備え、共有loggerでAuthorization header、Cookie、JSON風文字列、URL、Riot ID、API固有routeを正規表現で解析する方法も試した。しかし、quoted value、escaped quote、認証scheme、URLの区切り文字ごとに新しい解析漏れが生じた。一方で、Discordのguild/channel/message IDやroute templateなど、残すべき診断値も秘密値として扱う過剰なredactionが発生した。

任意文字列には完全な共通grammarがなく、loggerは値の生成元や意味を知らない。そのため、後段の文字列解析だけで「すべての秘密値を除去し、安全な部分だけを維持する」契約は成立しない。

## Decision

ログの信頼境界を、自由記述の内容ではなくeventとstructured fieldのschemaに置く。

### 呼び出し側の責務

- `event`と`component`はコードで定義した安定識別子とし、外部入力を連結しない。
- contextには、count、status、duration、guild/channel/message ID、検証済みroute template、列挙されたreason codeなど、意味と機密性が明確なfieldだけを渡す。
- credential、Authorization/Cookie header、request/response body、provider body、SQL parameter、Riot ID / PUUID、Discord user IDをcontextへ渡さない。必要な防御として、既知のsensitive keyはloggerでも再帰的にredactする。
- 外部処理の失敗は`error.message`へ変換せず、`warn`または`error`の第3引数へ元の`Error`を渡す。
- API request logはraw URLではなくHonoのroute templateを渡す。DB layerはSQL templateだけを渡し、parameterをloggerより前で破棄する。
- 原因追跡に追加情報が必要な場合は、外部本文ではなく安定したreason code、HTTP status、provider名などを個別fieldとして定義する。

### 共有loggerの責務

- 1行JSON、level filtering、共通field、ERRORおよび第3引数にErrorを持つWARNの相関ID/error category、循環参照、BigInt、sink failureへの耐性を提供する。
- structured keyを正規化して再帰的に評価し、credential、token、secret、Authorization/Cookie、OAuth code/state、SQL parameter、Riot ID / PUUID、Discord user IDを値全体でredactする。
- camelCase、snake_case、単数・複数形によらず、`message`、stack、cause、header、bodyを表すfieldはopaqueとして値全体をredactする。`error` fieldへ`Error`以外が渡された場合も値全体をredactする。
- `Error`からはprototypeのconstructor名、100〜599の整数であるown `status` / `statusCode`、causeが`Error`の場合の同じsafe envelopeだけを記録する。raw message、stack、string cause、その他のenumerable propertyは記録しない。
- URL objectまたは`url` / `uri` suffixのfieldはHTTP(S) originだけを記録し、userinfo、path、query、fragmentを記録しない。
- 任意文字列のAuthorization、JSON、URL、個人識別子を解析せず、API固有routeの知識を持たない。

## Consequences

- 認証scheme、quote、escape、URL punctuationなどの表記差によらず、opaqueなerror本文はログへ出ない。
- error messageとstackを直接検索できなくなる。調査はevent、component、correlation ID、error category、error class、status、安定したreason fieldを組み合わせる。
- WARNでも安全なerror envelopeと相関情報を残せるよう、`StructuredLogger.warn`はERRORと同じ第3error引数を持つ。
- 新しい診断fieldを追加する際は、値の生成元と機密性を呼び出し側で確認する必要がある。
- logger単体だけで、誤ったfield名に格納された任意の秘密文字列まで安全に分類できるとはみなさない。provider boundaryとreviewを含む多層防御を前提とする。

## Rejected alternatives

- 任意文字列を正規表現で継続的に解析する: grammar追加ごとに漏れと過剰redactionが再発し、API固有知識が共有loggerへ流入するため採用しない。
- URLのquery/hashをkey名で選択的に維持する: 未知のkeyやpathにもtoken・個人情報が入り得るため採用しない。
- DEBUG時だけraw errorやprovider bodyを記録する: 設定ミスや共有環境での保存を防げず、Issue #121の機密性境界が環境変数に依存するため採用しない。
- raw errorをhash化して記録する: 低entropyの個人情報には推測耐性がなく、原因追跡に必要な意味も維持できないため採用しない。
