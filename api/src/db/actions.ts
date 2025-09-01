import { eq } from "drizzle-orm";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { db } from "./index.ts";
import { type Lane, userRoles, users } from "./schema.ts";

const userInsertSchema = createInsertSchema(users);
const userUpdateSchema = createUpdateSchema(users);
const userRolesInsertSchema = createInsertSchema(userRoles);

/**
 * Creates a user if they don't already exist.
 * @param userId The Discord user ID.
 */
export async function upsertUser(userId: string) {
  const user = { id: userId };
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
  const user = { id: userId, mainRole: role };
  const parsed = userUpdateSchema.parse(user);
  return await db.update(users).set(parsed).where(
    eq(users.id, userId),
  ).execute();
}

/**
 * Adds a lane role to a user.
 * @param userId The Discord user ID.
 * @param role The lane to add.
 */
export async function addUserRole(userId: string, role: Lane) {
  await upsertUser(userId); // Ensure user exists
  const user = { id: userId, mainRole: role };
  const parsed = userRolesInsertSchema.parse(user);
  return await db.insert(userRoles).values(parsed)
    .onConflictDoNothing().execute();
}

/**
 * Removes a lane role from a user.
 * @param userId The Discord user ID.
 * @param role The lane to remove.
 */
export async function removeUserRole(userId: string, role: Lane) {
  return await db.delete(userRoles)
    .where(eq(userRoles.userId, userId) && eq(userRoles.role, role))
    .execute();
}
