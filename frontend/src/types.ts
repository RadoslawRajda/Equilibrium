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
  /** Smelted “alloy” from basics; victory at on-chain threshold */
  craftedGoods?: number;
};

/** On-chain `GameCore.getTrade` row for UI (lobby-scoped). */
export type TradeOfferView = {
  id: number;
  maker: string;
  /** `0x000…0` means any player may accept */
  taker: string;
  accepted: boolean;
  createdAtRound: number;
  /** Inclusive: valid while effective (projected) round ≤ this; see `projectRunningRoundClock` in UI. */
  expiresAtRound: number;
  offer: Record<ResourceKey, number>;
  request: Record<ResourceKey, number>;
};

export type LobbyState = {
  id: string;
  name: string;
  host: string;
  status: "waiting" | "zero-round" | "running" | "ended" | "cancelled";
  /** LobbyManager enum: OPEN=0, ACTIVE=1, COMPLETED=2, CANCELLED=3 */
  lobbyManagerStatus?: number;
  /** Set when LobbyManager.completeGame was called */
  declaredWinnerAddress?: string | null;
  /** When match ended on-chain but LM has no winner yet: best-effort from crafted goods / last alive */
  inferredWinnerAddress?: string | null;
  /** LobbyManager.hasTicket(lobbyId, connected wallet) — independent of GameCore roster. */
  viewerLobbyManagerTicket?: boolean;
  /** LM ticket but not yet in GameCore (e.g. legacy session); use `joinLobby` or rely on host start sync. */
  viewerNeedsGameCoreJoin?: boolean;
  prizePool?: string;
  rounds: {
    index: number;
    startedAt: number | null;
    durationSeconds: number | null;
    nextRoundAt: number | null;
    zeroRoundEndsAt: number | null;
  };
  players: PlayerState[];
  me: PlayerState | null;
  mapHexes: HexTile[];
  activeEffects: Array<{ id: string; label: string; remainingRounds: number }>;
  globalVotes: any[];
  barterOffers: TradeOfferView[];
  logs: Array<{ id: string; type: string; text: string; timestamp: number }>;
  pendingEarthquake: { atRound: number; targets: string[] } | null;
};
