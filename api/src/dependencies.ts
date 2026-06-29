import type { DbActions } from "./db/actions.ts";
import type { riotApi } from "./riot_api.ts";
import type { rso } from "./rso.ts";
import type { RiotStaticDataService } from "./riot_static_data.ts";
import type { OpggMatchDetailService } from "./services/opgg_match_detail.ts";
import type { StructuredLogger } from "../../lib/logger/mod.ts";

export type EnvReader = {
  get(key: string): string | undefined;
};

export type AppDependencies = {
  dbActions: DbActions;
  riotApi: typeof riotApi;
  rso: typeof rso;
  riotStaticData: RiotStaticDataService;
  opggMatchDetailService: OpggMatchDetailService;
  env: EnvReader;
  logger: StructuredLogger;
};
