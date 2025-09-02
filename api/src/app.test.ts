import { assertEquals } from "jsr:@std/assert";
import { app } from "./app.ts";

Deno.test("GET /health should return a healthy response", async () => {
  const res = await app.request("/health");
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, message: "This API is healthy!" });
});
