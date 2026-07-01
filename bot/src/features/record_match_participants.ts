import type { Lane } from "@adteemo/api/contract";

export type RecordMatchParticipant = {
  user: {
    id: string;
    username: string;
  };
  lane: Lane;
  team: "BLUE" | "RED";
};

function getActiveParticipants(): Promise<RecordMatchParticipant[]> {
  return Promise.resolve([
    { user: { id: "user1", username: "Player1" }, lane: "Top", team: "BLUE" },
    {
      user: { id: "user2", username: "Player2" },
      lane: "Jungle",
      team: "BLUE",
    },
    {
      user: { id: "user3", username: "Player3" },
      lane: "Middle",
      team: "BLUE",
    },
    {
      user: { id: "user4", username: "Player4" },
      lane: "Bottom",
      team: "BLUE",
    },
    {
      user: { id: "user5", username: "Player5" },
      lane: "Support",
      team: "BLUE",
    },
    { user: { id: "user6", username: "Player6" }, lane: "Top", team: "RED" },
    { user: { id: "user7", username: "Player7" }, lane: "Jungle", team: "RED" },
    { user: { id: "user8", username: "Player8" }, lane: "Middle", team: "RED" },
    { user: { id: "user9", username: "Player9" }, lane: "Bottom", team: "RED" },
    {
      user: { id: "user10", username: "Player10" },
      lane: "Support",
      team: "RED",
    },
  ]);
}

export const recordMatchParticipantProvider = {
  getActiveParticipants,
};
