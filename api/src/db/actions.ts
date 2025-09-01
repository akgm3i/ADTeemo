import { eq } from "drizzle-orm";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { db } from "./index.ts";
import { type Lane, users } from "./schema.ts";

const userInsertSchema = createInsertSchema(users);
const userUpdateSchema = createUpdateSchema(users);

/**
 * Creates a user if they don't already exist.
 * @param userId The Discord user ID.
 */
export async function upsertUser(userId: string) {
  const user = { discordId: userId };
  const parsed = userInsertSchema.parse(user);
  await db.insert(users).values(parsed).onConflictDoNothing().execute();
}

/**
 * Sets the main role for a user.
 * @param userId The Discord user ID.
 * @param role The user's main lane.
 */
export async function setMainRole(userId: string, role: Lane) {
  await upsertUser(userId); // Ensure user exists
  const user = { discordId: userId, mainRole: role };
  const parsed = userUpdateSchema.parse(user);
  return await db.update(users).set(parsed).where(
    eq(users.discordId, userId),
  ).execute();
}
