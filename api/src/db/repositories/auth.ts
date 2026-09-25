import { eq } from "drizzle-orm";
import type { RiotPlatform, RiotRegion } from "../../contract/domain.ts";
import type { Database } from "../index.ts";
import { authStates } from "../schema.ts";

export type AuthStateBinding = {
  discordId: string;
  guildId: string;
  platform: RiotPlatform;
  region: RiotRegion;
};

export function createAuthRepository(database: Database) {
  async function getAuthState(state: string) {
    return await database.query.authStates.findFirst({
      where: eq(authStates.state, state),
    });
  }

  async function consumeAuthState(state: string) {
    // DELETE RETURNING atomically claims a state even for concurrent callbacks.
    const claimed = await database.delete(authStates).where(
      eq(authStates.state, state),
    ).returning();
    return claimed.at(0);
  }

  async function createAuthState(state: string, binding: AuthStateBinding) {
    await database.insert(authStates).values({ state, ...binding }).execute();
  }

  return { getAuthState, consumeAuthState, createAuthState };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
