import { eq } from "drizzle-orm";
import type { Database } from "../index.ts";
import { authStates } from "../schema.ts";

export function createAuthRepository(database: Database) {
  async function getAuthState(state: string) {
    return await database.query.authStates.findFirst({
      where: eq(authStates.state, state),
    });
  }

  async function deleteAuthState(state: string) {
    await database.delete(authStates).where(eq(authStates.state, state))
      .execute();
  }

  async function createAuthState(state: string, discordId: string) {
    await database.insert(authStates).values({ state, discordId }).execute();
  }

  return {
    getAuthState,
    deleteAuthState,
    createAuthState,
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
