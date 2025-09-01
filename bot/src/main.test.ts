import { assertExists } from "jsr:@std/assert";
import { client } from "./main.ts";

Deno.test("Bot client should be instantiated", () => {
  assertExists(client, "The client should exist and be an object.");
});
