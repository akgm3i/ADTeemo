import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import { assertEquals } from "@std/assert";
import app from "../app.ts";
import { dbActions } from "../db/actions.ts";
import { type Lane, users } from "../db/schema.ts";
import type { InferSelectModel } from "drizzle-orm";

describe("POST /matches/:matchId/participants", () => {
  let user: InferSelectModel<typeof users>;

  beforeAll(async () => {
    user = await dbActions.upsertUser("test-user-id-for-match-test");
  });

  afterAll(async () => {
    if (user) {
      await dbActions.deleteUser(user.discordId);
    }
  });

  it("正常な戦績データがPOSTされた場合、ステータスコード201を返し、データベースに正しく戦績が記録される", async () => {
    const matchId = "test-match-id";
    const participantData: {
      userId: string;
      team: string;
      win: boolean;
      lane: Lane;
      kills: number;
      deaths: number;
      assists: number;
      cs: number;
      gold: number;
    } = {
      userId: user.discordId,
      team: "BLUE",
      win: true,
      lane: "Middle",
      kills: 10,
      deaths: 2,
      assists: 8,
      cs: 250,
      gold: 15000,
    };

    const createMatchParticipantStub = stub(
      dbActions,
      "createMatchParticipant",
      () => Promise.resolve({ id: 1 }),
    );

    const res = await app.request(
      `/matches/${matchId}/participants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(participantData),
      },
    );

    assertEquals(res.status, 201);
    assertEquals(createMatchParticipantStub.calls[0].args[0], {
      ...participantData,
      matchId,
    });

    createMatchParticipantStub.restore();
  });

  it("リクエストのbodyに必要な値が不足している場合、ステータスコード400を返す", async () => {
    const matchId = "test-match-id";
    const participantData = {
      userId: user.discordId,
      kills: 10,
    };

    const res = await app.request(
      `/matches/${matchId}/participants`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(participantData),
      },
    );

    assertEquals(res.status, 400);
  });
});
