import { assert, assertEquals } from "@std/assert";
import { REST } from "discord.js";
import { loadCommands } from "./src/common/command_loader.ts";
import { runCommandDeployment } from "./src/deploy-commands.ts";
import { verifyProductionPermissions } from "./production-permissions-smoke.ts";

await verifyProductionPermissions(false);
let writes = 0;
const result = await runCommandDeployment({
  env: Deno.env,
  loadCommands,
  createRest: (token) => {
    const rest = new REST().setToken(token);
    assert(rest);
    return {
      get: () => Promise.resolve([]),
      put: (_route, { body }) => {
        writes++;
        return Promise.resolve(body);
      },
    };
  },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  correlationId: () => "permission-smoke",
});
assertEquals(result.status, "updated");
assertEquals(writes, 1);
console.log("Production permissions verified offline: command deployment");
