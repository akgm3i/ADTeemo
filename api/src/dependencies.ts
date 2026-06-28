import type { DbActions } from "./db/actions.ts";
import type { riotApi } from "./riot_api.ts";
import type { rso } from "./rso.ts";
import type { riotStaticData } from "./riot_static_data.ts";
import type { opggMatchDetailService } from "./services/opgg_match_detail.ts";

export type AppDependencies = {
  dbActions: DbActions;
  riotApi: typeof riotApi;
  rso: typeof rso;
  riotStaticData: typeof riotStaticData;
  opggMatchDetailService: typeof opggMatchDetailService;
};
