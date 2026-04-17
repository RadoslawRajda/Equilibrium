export type ResourceKey = "food" | "wood" | "stone" | "ore" | "energy";

export type HexTile = {
  id: string;
  q: number;
  r: number;
  biome: "Plains" | "Forest" | "Mountains" | "Desert";
  owner: string | null;
  discoveredBy: string[];
  structure: null | {
    level: 1 | 2;
    collectedAtRound: number | null;
    builtAtRound: number;
  };
};

export type PlayerState = {
  address: string;
  nickname: string;
  hasTicket: boolean;
  bankruptRounds: number;
  alive: boolean;
  resources: Record<ResourceKey, number>;
};

export type LobbyState = {
  id: string;
  name: string;
  host: string;
  status: "waiting" | "zero-round" | "running";
  prizePool?: string;
  rounds: {
    index: number;
    startedAt: number | null;
    durationSeconds: number | null;
    nextRoundAt: number | null;
    zeroRoundEndsAt: number | null;
  };
  pollution: number;
  players: PlayerState[];
  me: PlayerState | null;
  mapHexes: HexTile[];
  activeEffects: Array<{ id: string; label: string; remainingRounds: number }>;
  globalVotes: any[];
  barterOffers: any[];
  logs: Array<{ id: string; type: string; text: string; timestamp: number }>;
  pendingEarthquake: { atRound: number; targets: string[] } | null;
};
