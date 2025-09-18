import { z } from "zod";
import { lanes } from "./db/schema.ts";

export const createParticipantSchema = z.object({
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
