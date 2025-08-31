import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { users, userRoles, type Lane } from './schema.ts';

/**
 * Creates a user if they don't already exist.
 * @param userId The Discord user ID.
 */
export async function upsertUser(userId: string) {
  await db.insert(users).values({ id: userId }).onConflictDoNothing().execute();
}

/**
 * Sets the main role for a user.
 * @param userId The Discord user ID.
 * @param role The user's main lane.
 */
export async function setMainRole(userId: string, role: Lane) {
  await upsertUser(userId); // Ensure user exists
  return await db.update(users).set({ mainRole: role }).where(eq(users.id, userId)).execute();
}

/**
 * Adds a lane role to a user.
 * @param userId The Discord user ID.
 * @param role The lane to add.
 */
export async function addUserRole(userId: string, role: Lane) {
  await upsertUser(userId); // Ensure user exists
  return await db.insert(userRoles).values({ userId, role }).onConflictDoNothing().execute();
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
