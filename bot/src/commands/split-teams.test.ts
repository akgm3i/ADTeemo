import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { describe, test } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy, stub } from "@std/testing/mock";
import type { Event, Lane } from "@adteemo/api/contract";
import { ChannelType, Message, User } from "discord.js";
import { apiClient } from "../api_client.ts";
import { MockGuildBuilder, MockInteractionBuilder } from "../test_utils.ts";
import { data, execute, splitTeamHandlers as handlers } from "./split-teams.ts";

function activeEvent(): Event {
  return {
    id: 1,
    operationKey: "interaction-1",
    name: "test-event",
    guildId: "mock-guild-id",
    creatorId: "mock-user-id",
    recruitmentChannelId: "saved-recruitment-channel",
    voiceChannelId: "voice-channel",
    discordScheduledEventId: "de-id",
    recruitmentMessageId: "msg-id",
    phase: "RECRUITING",
    syncState: "CONSISTENT",
    revision: 3,
    discordEventDeleted: false,
    recruitmentMessageDeleted: false,
    lastFailureCode: null,
    createdAt: new Date("2026-08-01T09:00:00+09:00"),
    scheduledStartAt: new Date("2026-08-01T12:00:00+09:00"),
    updatedAt: null,
  };
}

describe("split-teams command", () => {
  describe("定義", () => {
    test("コマンド名と説明が期待通りに設定されている", () => {
      const json = data.toJSON();
      assertEquals(json.name, "split-teams");
      assertEquals(json.description, "現在の参加者を自動で2チームに分けます。");
    });
  });

  describe("execute", () => {
    test("所有スコープ内の募集メッセージを使い、確定ロスター保存後にVCを移動する", async () => {
      const guild = new MockGuildBuilder().build();
      const interaction = new MockInteractionBuilder("split-teams")
        .withGuild(guild)
        .build();
      const event = activeEvent();
      using _confirmed = stub(
        handlers,
        "loadConfirmedTeams",
        () => Promise.resolve(null),
      );
      const message = {} as Message;
      const participants = {
        participantsByRole: new Map<Lane, User[]>(),
        allParticipants: new Set<User>(),
      };
      const teams = {
        teamA: new Map<Lane, User>(),
        teamB: new Map<Lane, User>(),
      };

      using fetchEventStub = stub(
        handlers,
        "fetchEvent",
        () => Promise.resolve(event),
      );
      using fetchMsgStub = stub(
        handlers,
        "fetchRecruitmentMessage",
        () => Promise.resolve(message),
      );
      using fetchParticipantsStub = stub(
        handlers,
        "fetchParticipants",
        () => Promise.resolve(participants),
      );
      using validateStub = stub(handlers, "validateParticipants", () => {});
      using splitStub = stub(handlers, "splitTeams", () => teams);
      using saveStub = stub(
        handlers,
        "saveParticipants",
        () => Promise.resolve(),
      );
      using moveStub = stub(
        handlers,
        "moveMembersToVoiceChannels",
        () => Promise.resolve(),
      );
      using announceStub = stub(
        handlers,
        "announceTeams",
        () => Promise.resolve(),
      );
      using deferSpy = spy(interaction, "deferReply");
      using editSpy = spy(interaction, "editReply");

      await execute(interaction);

      assertSpyCall(deferSpy, 0);
      assertSpyCall(fetchEventStub, 0, {
        args: [
          interaction.guildId!,
          interaction.channelId,
          interaction.user.id,
        ],
      });
      assertSpyCall(fetchMsgStub, 0, {
        args: [guild, "saved-recruitment-channel", "msg-id"],
      });
      assertSpyCall(fetchParticipantsStub, 0, { args: [message] });
      assertSpyCall(validateStub, 0, {
        args: [participants.participantsByRole, participants.allParticipants],
      });
      assertSpyCall(splitStub, 0, { args: [participants.participantsByRole] });
      assertSpyCall(saveStub, 0, {
        args: [event, teams.teamA, teams.teamB],
      });
      assertSpyCall(moveStub, 0, { args: [guild, teams.teamA, teams.teamB] });
      assertSpyCall(announceStub, 0, {
        args: [interaction, teams.teamA, teams.teamB],
      });
      assertSpyCalls(editSpy, 0);
    });

    test("確定ロスターの保存に失敗した場合はVCを移動せず成功表示もしない", async () => {
      const guild = new MockGuildBuilder().build();
      const interaction = new MockInteractionBuilder("split-teams")
        .withGuild(guild)
        .build();
      const event = activeEvent();
      using _confirmed = stub(
        handlers,
        "loadConfirmedTeams",
        () => Promise.resolve(null),
      );
      const teams = {
        teamA: new Map<Lane, User>(),
        teamB: new Map<Lane, User>(),
      };
      using _fetchEventStub = stub(
        handlers,
        "fetchEvent",
        () => Promise.resolve(event),
      );
      using _fetchMsgStub = stub(
        handlers,
        "fetchRecruitmentMessage",
        () => Promise.resolve({} as Message),
      );
      using _fetchParticipantsStub = stub(
        handlers,
        "fetchParticipants",
        () =>
          Promise.resolve({
            participantsByRole: new Map<Lane, User[]>(),
            allParticipants: new Set<User>(),
          }),
      );
      using _validateStub = stub(handlers, "validateParticipants", () => {});
      using _splitStub = stub(handlers, "splitTeams", () => teams);
      using _saveStub = stub(
        handlers,
        "saveParticipants",
        () => Promise.reject(new Error("roster save failed")),
      );
      using moveSpy = stub(
        handlers,
        "moveMembersToVoiceChannels",
        () => Promise.resolve(),
      );
      using announceSpy = stub(
        handlers,
        "announceTeams",
        () => Promise.resolve(),
      );
      using editSpy = spy(interaction, "editReply");

      await execute(interaction);

      assertSpyCalls(moveSpy, 0);
      assertSpyCalls(announceSpy, 0);
      assertSpyCall(editSpy, 0, { args: ["roster save failed"] });
    });
  });

  test("チームとレーンをDiscordユーザーID付きで初回確定APIへ10人まとめて送り既存更新APIを使わない", async () => {
    const event = activeEvent();
    const lanes: Lane[] = ["Top", "Jungle", "Middle", "Bottom", "Support"];
    const teamA = new Map<Lane, User>();
    const teamB = new Map<Lane, User>();
    for (const [index, lane] of lanes.entries()) {
      teamA.set(lane, { id: `red-${index + 1}` } as User);
      teamB.set(lane, { id: `blue-${index + 1}` } as User);
    }
    using saveStub = stub(
      apiClient,
      "confirmCustomGameEventParticipants",
      () => Promise.resolve({ success: true as const, participants: [] }),
    );

    await handlers.saveParticipants(event, teamA, teamB);

    assertSpyCall(saveStub, 0, {
      args: [1, {
        guildId: "mock-guild-id",
        recruitmentChannelId: "saved-recruitment-channel",
        participants: [
          { userId: "red-1", team: "RED", lane: "Top" },
          { userId: "red-2", team: "RED", lane: "Jungle" },
          { userId: "red-3", team: "RED", lane: "Middle" },
          { userId: "red-4", team: "RED", lane: "Bottom" },
          { userId: "red-5", team: "RED", lane: "Support" },
          { userId: "blue-1", team: "BLUE", lane: "Top" },
          { userId: "blue-2", team: "BLUE", lane: "Jungle" },
          { userId: "blue-3", team: "BLUE", lane: "Middle" },
          { userId: "blue-4", team: "BLUE", lane: "Bottom" },
          { userId: "blue-5", team: "BLUE", lane: "Support" },
        ],
      }],
    });
  });
  test("後発の抽選結果が初回確定APIで競合すると、旧PUTで上書きせずVC移動と告知を停止する", async () => {
    const interaction = new MockInteractionBuilder("split-teams").build();
    const roleNames: Lane[] = ["Top", "Jungle", "Middle", "Bottom", "Support"];
    const participantsByRole = new Map(
      roleNames.map((
        lane,
        index,
      ) => [lane, [
        { id: `red-${index}` } as User,
        { id: `blue-${index}` } as User,
      ]]),
    );
    using _event = stub(
      handlers,
      "fetchEvent",
      () => Promise.resolve(activeEvent()),
    );
    using _empty = stub(
      handlers,
      "loadConfirmedTeams",
      () => Promise.resolve(null),
    );
    using _message = stub(
      handlers,
      "fetchRecruitmentMessage",
      () => Promise.resolve({} as Message),
    );
    using _participants = stub(
      handlers,
      "fetchParticipants",
      () =>
        Promise.resolve({
          participantsByRole,
          allParticipants: new Set([...participantsByRole.values()].flat()),
        }),
    );
    using confirm = stub(
      apiClient,
      "confirmCustomGameEventParticipants",
      () =>
        Promise.resolve({
          success: false as const,
          code: "CONFLICT" as const,
          status: 409 as const,
          error: "roster already confirmed",
        }),
    );
    using oldUpdate = stub(apiClient, "saveCustomGameEventParticipants", () => {
      throw new Error("must not replace");
    });
    using move = stub(
      handlers,
      "moveMembersToVoiceChannels",
      () => Promise.resolve(),
    );
    using announce = stub(handlers, "announceTeams", () => Promise.resolve());
    using edit = spy(interaction, "editReply");
    await execute(interaction);
    assertSpyCalls(confirm, 1);
    assertSpyCalls(oldUpdate, 0);
    assertSpyCalls(move, 0);
    assertSpyCalls(announce, 0);
    assertSpyCall(edit, 0, { args: ["roster already confirmed"] });
  });

  test("前回保存したロスターがある場合、再実行すると再抽選せず同じチームでVC移動を再開する", async () => {
    const interaction = new MockInteractionBuilder("split-teams").build();
    const teams = {
      teamA: new Map<Lane, User>(),
      teamB: new Map<Lane, User>(),
    };
    using _event = stub(
      handlers,
      "fetchEvent",
      () => Promise.resolve(activeEvent()),
    );
    using _confirmed = stub(
      handlers,
      "loadConfirmedTeams",
      () => Promise.resolve(teams),
    );
    using redraw = stub(handlers, "splitTeams", () => {
      throw new Error("must not redraw");
    });
    using save = stub(handlers, "saveParticipants", () => {
      throw new Error("must not overwrite");
    });
    using move = stub(
      handlers,
      "moveMembersToVoiceChannels",
      () => Promise.resolve(),
    );
    using _announce = stub(handlers, "announceTeams", () => Promise.resolve());
    await execute(interaction);
    assertSpyCalls(redraw, 0);
    assertSpyCalls(save, 0);
    assertSpyCall(move, 0, {
      args: [interaction.guild!, teams.teamA, teams.teamB],
    });
  });
  test("同じ人が複数ロールへ反応している場合、人数が10オブジェクトでも参加者確定を拒否する", () => {
    const roles: Lane[] = ["Top", "Jungle", "Middle", "Bottom", "Support"];
    const byRole = new Map<Lane, User[]>();
    for (const [index, lane] of roles.entries()) {
      byRole.set(lane, [
        { id: `user-${index}` } as User,
        { id: index === 0 ? "user-1" : `other-${index}` } as User,
      ]);
    }
    assertThrows(() =>
      handlers.validateParticipants(
        byRole,
        new Set([...byRole.values()].flat()),
      )
    );
  });
});

test("チームVC移動時に参加者の一部を取得できない場合、一部だけ移動して成功にしない", async () => {
  const guild = new MockGuildBuilder("guild")
    .withChannel({ id: "red", type: ChannelType.GuildVoice })
    .withChannel({ id: "blue", type: ChannelType.GuildVoice }).build();
  using _settings = stub(
    apiClient,
    "getCustomGameSettings",
    () =>
      Promise.resolve({
        success: true,
        settings: {
          recruitmentChannelId: "recruit",
          lobbyChannelId: "lobby",
          redChannelId: "red",
          blueChannelId: "blue",
          roleIds: {
            Top: "top",
            Jungle: "jg",
            Middle: "mid",
            Bottom: "bot",
            Support: "sup",
          },
        },
      }),
  );
  await assertRejects(() =>
    handlers.moveMembersToVoiceChannels(
      guild,
      new Map([["Top", { id: "absent" } as User]]),
      new Map(),
    )
  );
});
