import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { assertSpyCall, stub } from "@std/testing/mock";
import { testClient } from "@hono/hono/testing";
import app from "../app.ts";
import { dbActions } from "../db/actions.ts";
import type { Lane } from "../db/schema.ts";

describe("routes/matches.ts", () => {
  const client = testClient(app);

  describe("POST /matches/:matchId/participants", () => {
    const matchId = "test-match-id";

    describe("正常系", () => {
      it("有効な参加者データが指定されたとき、参加者の戦績が記録され、201 Createdを返す", async () => {
        const participantData: {
          userId: string;
          team: "BLUE" | "RED";
          win: boolean;
          lane: Lane;
          kills: number;
          deaths: number;
          assists: number;
          cs: number;
          gold: number;
        } = {
          userId: "test-user-id",
          team: "BLUE",
          win: true,
          lane: "Middle",
          kills: 10,
          deaths: 2,
          assists: 8,
          cs: 250,
          gold: 15000,
        };

        using createParticipantStub = stub(
          dbActions,
          "createMatchParticipant",
          () => Promise.resolve({ id: 1 }),
        );

        const res = await client.matches[":matchId"].participants.$post({
          param: { matchId },
          json: participantData,
        });

        assertEquals(res.status, 201);
        assert(res.ok);
        assertSpyCall(createParticipantStub, 0, {
          args: [{ ...participantData, matchId }],
        });
      });
    });

    describe("異常系", () => {
      it("無効なデータ（必須項目不足）が指定されたとき、400エラーを返す", async () => {
        const participantData = {
          userId: "test-user-id",
          kills: 10,
        };
        const req = new Request(
          `http://localhost/matches/${matchId}/participants`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(participantData),
          },
        );

        const res = await app.request(req);
        assertEquals(res.status, 400);
      });
    });
  });
});
