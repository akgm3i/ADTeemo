import { Hono } from "jsr:@hono/hono";
import { zValidator } from "jsr:@hono/zod-validator";
import { z } from "npm:zod";
import { lanes } from "../db/schema.ts";
import { dbActions } from "../db/actions.ts";

const roleSchema = z.object({
  role: z.enum(lanes),
});

export const usersRoutes = new Hono()
  .put(
    "/:userId/main-role",
    zValidator("json", roleSchema),
    async (c) => {
      const { userId } = c.req.param();
      const { role } = c.req.valid("json");
      await dbActions.setMainRole(userId, role);
      return c.json({ success: true });
    },
  );

export type UsersRoutes = typeof usersRoutes;
