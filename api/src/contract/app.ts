import { Hono } from "@hono/hono";
import { zValidator } from "@hono/zod-validator";
import {
  callbackQuerySchema,
  createEventSchema,
  createMatchWatcherSchema,
  createParticipantSchema,
  finalizeRankSnapshotsSchema,
  inspectMatchWatcherActiveGameSchema,
  linkByRiotIdSchema,
  loginUrlQuerySchema,
  platformAndPuuidSchema,
  regionAndMatchIdSchema,
  resolveOpggMatchDetailSchema,
  riotStaticDataResolveSchema,
  roleSchema,
  updateMatchWatcherStateSchema,
  upsertPendingRankSnapshotsSchema,
} from "./schemas.ts";
import type {
  ActiveGame,
  Event,
  LeagueEntry,
  MatchRankSnapshot,
  MatchWatcher,
  OpggMatchDetail,
  RiotAccount,
  RiotMatch,
  RiotStaticDataResolveData,
} from "./models.ts";

function hasContractError(): boolean {
  return false;
}

const errorResponse = { error: "" };

const usersContractRoutes = new Hono()
  .patch(
    "/link-by-riot-id",
    zValidator("json", linkByRiotIdSchema),
    (c) => {
      if (hasContractError()) return c.json(errorResponse, 404);
      return c.body(null, 204);
    },
  )
  .get("/:userId/riot-account", (c) => {
    if (hasContractError()) return c.json(errorResponse, 404);
    return c.json({ account: {} as RiotAccount }, 200);
  })
  .put(
    "/:userId/main-role",
    zValidator("json", roleSchema),
    (c) => c.body(null, 204),
  );

const eventsContractRoutes = new Hono()
  .post("/", zValidator("json", createEventSchema), (c) => c.body(null, 201))
  .get("/by-creator/:creatorId", (c) => c.json({ events: [] as Event[] }, 200))
  .get("/today/by-creator/:creatorId", (c) => {
    if (hasContractError()) return c.json(errorResponse, 404);
    return c.json({ event: {} as Event }, 200);
  })
  .delete("/:discordEventId", (c) => c.body(null, 204));

const matchesContractRoutes = new Hono()
  .post(
    "/rank-snapshots/pending",
    zValidator("json", upsertPendingRankSnapshotsSchema),
    (c) => c.body(null, 204),
  )
  .post(
    "/:matchId/rank-snapshots/finalize",
    zValidator("json", finalizeRankSnapshotsSchema),
    (c) =>
      c.json({
        snapshots: {
          before: [] as MatchRankSnapshot[],
          after: [] as MatchRankSnapshot[],
        },
      }, 200),
  )
  .post(
    "/:matchId/external-details/opgg/resolve",
    zValidator("json", resolveOpggMatchDetailSchema),
    (c) => {
      if (hasContractError()) return c.json(errorResponse, 400);
      if (hasContractError()) return c.json(errorResponse, 404);
      if (hasContractError()) return c.json(errorResponse, 500);
      return c.json({ detail: null as OpggMatchDetail | null }, 200);
    },
  )
  .post(
    "/:matchId/participants",
    zValidator("json", createParticipantSchema),
    (c) => {
      if (hasContractError()) return c.json(errorResponse, 404);
      return c.json({ id: 0 }, 201);
    },
  );

const matchWatchersContractRoutes = new Hono()
  .post(
    "/",
    zValidator("json", createMatchWatcherSchema),
    (c) => {
      if (hasContractError()) return c.json(errorResponse, 404);
      if (hasContractError()) return c.json(errorResponse, 409);
      return c.body(null, 204);
    },
  )
  .get("/enabled", (c) => c.json({ watchers: [] as MatchWatcher[] }, 200))
  .get(
    "/enabled/:guildId",
    (c) => c.json({ watchers: [] as MatchWatcher[] }, 200),
  )
  .patch(
    "/:guildId/:targetDiscordId/state",
    zValidator("json", updateMatchWatcherStateSchema),
    (c) => c.body(null, 204),
  )
  .post(
    "/:guildId/:targetDiscordId/tracking/active-game",
    zValidator("json", inspectMatchWatcherActiveGameSchema),
    (c) => {
      if (hasContractError()) return c.json(errorResponse, 404);
      if (hasContractError()) return c.json(errorResponse, 502);
      return c.json({
        account: {} as RiotAccount,
        activeGame: null as ActiveGame | null,
      }, 200);
    },
  )
  .delete("/:guildId/:targetDiscordId", (c) => c.body(null, 204));

const riotStaticDataContractRoutes = new Hono().post(
  "/resolve",
  zValidator("json", riotStaticDataResolveSchema),
  (c) => {
    if (hasContractError()) return c.json(errorResponse, 400);
    if (hasContractError()) return c.json(errorResponse, 502);
    return c.json({} as RiotStaticDataResolveData, 200);
  },
);

const riotContractRoutes = new Hono()
  .get(
    "/active-games/:platform/:puuid",
    zValidator("param", platformAndPuuidSchema),
    (c) => {
      if (hasContractError()) return c.json(errorResponse, 502);
      return c.json({ activeGame: null as ActiveGame | null }, 200);
    },
  )
  .get(
    "/matches/:region/:matchId",
    zValidator("param", regionAndMatchIdSchema),
    (c) => {
      if (hasContractError()) return c.json(errorResponse, 502);
      return c.json({ match: null as RiotMatch | null }, 200);
    },
  )
  .get(
    "/league-entries/:platform/:puuid",
    zValidator("param", platformAndPuuidSchema),
    (c) => {
      if (hasContractError()) return c.json(errorResponse, 502);
      return c.json({ entries: [] as LeagueEntry[] }, 200);
    },
  )
  .route("/static-data", riotStaticDataContractRoutes);

const authContractRoutes = new Hono()
  .get(
    "/rso/login-url",
    zValidator("query", loginUrlQuerySchema),
    (c) => c.json({ url: "" }, 200),
  )
  .get(
    "/rso/callback",
    zValidator("query", callbackQuerySchema),
    (c) => {
      if (hasContractError()) return c.json(errorResponse, 400);
      if (hasContractError()) return c.json(errorResponse, 500);
      return c.html("", 200);
    },
  );

export const contractApp = new Hono()
  .get("/health", (c) => c.json({ message: "" }, 200))
  .route("/users", usersContractRoutes)
  .route("/events", eventsContractRoutes)
  .route("/matches", matchesContractRoutes)
  .route("/match-watchers", matchWatchersContractRoutes)
  .route("/riot", riotContractRoutes)
  .route("/auth", authContractRoutes);

export type AppType = typeof contractApp;
