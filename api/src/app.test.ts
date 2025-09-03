import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { app } from "./app.ts";

describe("GET /health", () => {
  it("リクエストを送信すると、ステータスコード200と正常なボディが返される", async () => {
    const res = await app.request("/health");
    const body = await res.json();

    assertEquals(res.status, 200);
    assertEquals(body, { ok: true, message: "This API is healthy!" });
  });
});
