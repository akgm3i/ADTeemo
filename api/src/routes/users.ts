import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { lanes } from '../db/schema.ts';
import * as actions from '../db/actions.ts';

const roleSchema = z.object({
  role: z.enum(lanes),
});

const deleteParamsSchema = z.object({
  userId: z.string(),
  role: z.enum(lanes),
});

export const usersRoutes = new Hono()
  .put(
    '/:userId/main-role',
    zValidator('json', roleSchema),
    async (c) => {
      const { userId } = c.req.param();
      const { role } = c.req.valid('json');
      await actions.setMainRole(userId, role);
      return c.json({ success: true });
    }
  )
  .post(
    '/:userId/roles',
    zValidator('json', roleSchema),
    async (c) => {
      const { userId } = c.req.param();
      const { role } = c.req.valid('json');
      await actions.addUserRole(userId, role);
      return c.json({ success: true });
    }
  )
  .delete(
    '/:userId/roles/:role',
    zValidator('param', deleteParamsSchema),
    async (c) => {
      const { userId, role } = c.req.valid('param');
      await actions.removeUserRole(userId, role);
      return c.json({ success: true });
    }
  );
