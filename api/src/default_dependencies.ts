import { dbActions } from "./db/default_actions.ts";
import type { AppDependencies } from "./dependencies.ts";
import { opggClient } from "./integrations/opgg.ts";
import { apiLogger } from "./logger.ts";
import { riotApi } from "./riot_api.ts";
import {
  createRiotStaticData,
  fetchRiotStaticDataJson,
} from "./riot_static_data.ts";
import { rso } from "./rso.ts";
import { createOpggMatchDetailService } from "./services/opgg_match_detail.ts";

const riotStaticData = createRiotStaticData({
  dbActions,
  env: Deno.env,
  fetchJson: fetchRiotStaticDataJson,
  logger: apiLogger,
});

const opggMatchDetailService = createOpggMatchDetailService({
  dbActions,
  env: Deno.env,
  logger: apiLogger,
  opggClient,
});

export const defaultDependencies = {
  dbActions,
  riotApi,
  rso,
  riotStaticData,
  opggMatchDetailService,
  env: Deno.env,
} satisfies AppDependencies;
