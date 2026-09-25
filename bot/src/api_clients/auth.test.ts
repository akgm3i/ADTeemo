import { assertEquals } from "@std/assert";
import { test } from "@std/testing/bdd";
import { responseContracts } from "@adteemo/api/contract";
import { createAuthApiClient } from "./auth.ts";
import { createRpcClientStub, response } from "./test_utils.ts";
for (const body of [null, {}, { url: 123 }, { url: "invalid" }]) {
  test(`login URLのpayloadが不正なとき、URLなしにせず契約エラーを返す (${JSON.stringify(body)})`, async () => {
    using rpc = createRpcClientStub([{
      contract: responseContracts.loginUrl,
      result: response(body),
    }]);
    const result = await createAuthApiClient({ rpcClient: rpc.rpcClient })
      .getLoginUrl("user-1", "guild-1");
    assertEquals(result.success, false);
    if (!result.success) {
      assertEquals(result.contractError?.kind, "contract_error");
    }
  });
}
