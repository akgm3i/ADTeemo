import { Hono } from "@hono/hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { dbActions } from "../db/actions.ts";
import { lanes } from "../db/schema.ts";

const app = new Hono();

const createParticipantSchema = z.object({
  userId: z.string(),
  team: z.enum(["BLUE", "RED"]),
  win: z.boolean(),
  lane: z.enum(lanes),
  kills: z.number().int().min(0),
  deaths: z.number().int().min(0),
  assists: z.number().int().min(0),
  cs: z.number().int().min(0),
  gold: z.number().int().min(0),
});

app.post(
  "/:matchId/participants",
  zValidator("json", createParticipantSchema),
  async (c) => {
    const { matchId } = c.req.param();
    const participantData = c.req.valid("json");

    try {
      const result = await dbActions.createMatchParticipant({
        ...participantData,
        matchId,
      });
      return c.json({ success: true, id: result.id }, 201);
    } catch (e) {
      console.error(e);
      return c.json(
        { success: false, error: "Failed to create participant" },
        500,
      );
    }
  },
);

export default app;
