import { dbActions } from "./db/default_actions.ts";
import type { AppDependencies } from "./dependencies.ts";
import { riotApi } from "./riot_api.ts";
import { riotStaticData } from "./riot_static_data.ts";
import { rso } from "./rso.ts";
import { opggMatchDetailService } from "./services/opgg_match_detail.ts";

export const defaultDependencies = {
  dbActions,
  riotApi,
  rso,
  riotStaticData,
  opggMatchDetailService,
} satisfies AppDependencies;
