import { assertThrows } from "@std/assert";
import { responseContracts } from "@adteemo/api/contract";
import { requestResult } from "./transport.ts";
import { createApiClient } from "../api_client.ts";
import { createRpcClientStub, invalidJsonResponse } from "./test_utils.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { describe, test } from "@std/testing/bdd";

import {
  CONTRACT_ERROR,
  type HttpFailureResult,
  readApiError,
} from "./transport.ts";

import { apiError, response } from "./test_utils.ts";

describe("transport", () => {
  test("HTTP failure型はcodeに対応しないstatusを拒否する", () => {
    const mismatchedPairIsRejected: {
      success: false;
      error: string;
      code: "INTERNAL_ERROR";
      status: 404;
    } extends HttpFailureResult ? false : true = true;

    assertEquals(mismatchedPairIsRejected, true);
  });

  test("共通error envelopeを受け取ると、statusとcodeの対応を検証して型付き結果を返す", async () => {
    const parsed = await readApiError(
      response(apiError("RIOT_ACCOUNT_NOT_FOUND"), 404),
    );

    assertEquals(parsed, {
      code: "RIOT_ACCOUNT_NOT_FOUND",
      message: "Riot account not found",
      status: 404,
    });
  });

  test("HTTP statusとerror codeが一致しないとき、bodyを転記せず契約不整合として拒否する", async () => {
    await assertRejects(
      () =>
        readApiError(
          response(
            apiError("INTERNAL_ERROR", "private provider response body"),
            404,
          ),
        ),
      Error,
      CONTRACT_ERROR,
    );
  });
});

test("全JSON endpointがnull bodyを返すと、endpointとstatusを持つ契約エラーを返す", async () => {
  for (const contract of Object.values(responseContracts)) {
    if (contract.statuses.includes(204)) continue;
    const result = await requestResult(
      contract,
      () => Promise.resolve(response(null, contract.statuses[0])),
    );
    assertEquals(result.success, false, contract.path);
    if (result.success) continue;
    assertEquals(result.contractError?.kind, "contract_error");
    assertEquals(
      result.contractError?.endpoint,
      `${contract.method} ${contract.path}`,
    );
    assertEquals(result.contractError?.status, contract.statuses[0]);
  }
});

test("成功JSONのdecodeに失敗すると、本文の秘密値を転記しない契約エラーを返す", async () => {
  const result = await requestResult(
    responseContracts.health,
    () => Promise.resolve({ ...invalidJsonResponse(200), ok: true }),
  );
  assertEquals(result.success, false);
  if (result.success) return;
  assertEquals(result.error, CONTRACT_ERROR);
  assertEquals(result.contractError?.validationPaths, ["body"]);
});

test("strict fakeに未消費responseがあると、テスト終了時に失敗する", () => {
  const rpc = createRpcClientStub([{
    contract: responseContracts.health,
    result: response({ message: "ok" }),
  }]);
  assertThrows(() => rpc[Symbol.dispose](), Error, "Unconsumed RPC responses");
});

test("strict fakeへ未定義requestを送ると、clientが例外を変換してもテスト終了時に失敗する", async () => {
  const rpc = createRpcClientStub([]);
  await createApiClient({ rpcClient: rpc.rpcClient }).checkHealth();
  assertThrows(() => rpc[Symbol.dispose](), Error, "Unexpected RPC calls");
});

test("record型の動的keyに秘密値が含まれていても、validation pathへ転記しない", async () => {
  const result = await requestResult(
    responseContracts.staticData,
    () =>
      Promise.resolve(
        response({
          champions: { "private-provider-value": { name: 123, iconUrl: null } },
          queues: {},
          maps: {},
          gameModes: {},
        }),
      ),
  );
  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.contractError?.validationPaths, [
      "champions.<key>.name",
    ]);
  }
});
