import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { client, startBot } from "./src/main.ts";
import { matchTracker } from "./src/features/match_tracking.ts";
import { watcher } from "./src/features/testing/match_tracking_fixtures.ts";
import { verifyProductionPermissions } from "./production-permissions-smoke.ts";

const commands = await verifyProductionPermissions(true);
using login = stub(client, "login", () => Promise.resolve("offline"));
await startBot();
assertEquals(login.calls.length, 1);
assertEquals(client.commands.size, commands.commands.length);
const worker = matchTracker.createDefaultMatchTrackingWorker(client);
worker.stop();
matchTracker.warnIfRiotRequestBudgetRisk(1);
matchTracker.shouldNotifyInGame(watcher());
matchTracker.hasResultFetchTimedOut(watcher());
await client.destroy();
console.log("Production permissions verified offline: Bot runtime");
