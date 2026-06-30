import { assertEquals } from "@std/assert";
import { test } from "@std/testing/bdd";
import type { AppType as ContractAppType } from "./app.ts";
import type { AppType as ImplementationAppType } from "../app.ts";

type AssertContractCompatible<T extends ContractAppType> = T;
type _ImplementationAppMatchesContract = AssertContractCompatible<
  ImplementationAppType
>;

test("Backend実装AppがAPI contractのHono RPC型を満たしている", () => {
  assertEquals(true, true);
});
