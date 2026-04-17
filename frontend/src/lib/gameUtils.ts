import { encodePacked, keccak256 } from "viem";
import type { PublicClient } from "viem";

import type { HexTile, LobbyState, ResourceKey } from "../types";

const BIOME_NAMES = ["Plains", "Forest", "Mountains", "Desert"] as const;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const hexDirections = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1]
] as const;

export type ActionCost = {
  food: number;
  wood: number;
  stone: number;
  ore: number;
  energy: number;
};

export type ActionCosts = {
  discover: ActionCost;
  build: ActionCost;
  upgrade: ActionCost;
  /** `GameCore.previewCollectionEnergyCost(1)` */
  collectEnergyLevel1: number;
  /** `GameCore.previewCollectionEnergyCost(2)` */
  collectEnergyLevel2: number;
  /** `GameCore.previewCollectionResourceYield(1)` — biome picks which basic resource */
  collectResourceYieldLevel1: number;
  /** `GameCore.previewCollectionResourceYield(2)` */
  collectResourceYieldLevel2: number;
};

export const short = (address?: string) => (address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "?");

export const hexId = (q: number, r: number) => `${q},${r}`;

export const generateMapSeed = () => {
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  const entropy = values.reduce((accumulator, value) => (accumulator << 32n) | BigInt(value), 0n);
  return BigInt(keccak256(encodePacked(["uint256", "uint256"], [entropy, BigInt(Date.now())])));
};

export const biomeForCoord = (seed: bigint, q: number, r: number): HexTile["biome"] => {
  const hash = keccak256(encodePacked(["uint256", "int256", "int256"], [seed, BigInt(q), BigInt(r)]));
  const biomeIndex = Number(BigInt(hash) % 4n);
  return BIOME_NAMES[biomeIndex];
};

export const generateLocalMap = (seed: bigint, radius: number): HexTile[] => {
  const hexes: HexTile[] = [];
  for (let q = -radius; q <= radius; q += 1) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r += 1) {
      hexes.push({
        id: hexId(q, r),
        q,
        r,
        biome: biomeForCoord(seed, q, r),
        owner: null,
        discoveredBy: [],
        structure: null
      });
    }
  }
  return hexes;
};

export const isAdjacent = (a: HexTile, b: HexTile) => hexDirections.some(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);

export const isAdjacentToOwnedHex = (hexes: HexTile[], target: HexTile, owner?: string) => {
  if (!owner) return false;
  return hexes.some((hex) => hex.owner?.toLowerCase() === owner.toLowerCase() && isAdjacent(hex, target));
};

const finiteResource = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export const normalizeContractResources = (raw: unknown): ActionCost => {
  const fromRecord = (record: Record<string, unknown>): ActionCost => {
    const n = (key: string) => {
      const v = record[key];
      if (v === undefined || v === null) return 0;
      const num = typeof v === "bigint" ? Number(v) : Number(v);
      return Number.isFinite(num) ? num : 0;
    };
    return {
      food: n("food"),
      wood: n("wood"),
      stone: n("stone"),
      ore: n("ore"),
      energy: n("energy")
    };
  };

  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const keys = Object.keys(raw as object);
    if (keys.includes("food") || keys.includes("energy")) {
      return fromRecord(raw as Record<string, unknown>);
    }
  }

  const arr = raw as unknown[] | null | undefined;
  if (!Array.isArray(arr)) {
    return { food: 0, wood: 0, stone: 0, ore: 0, energy: 0 };
  }
  const at = (i: number) => {
    const v = arr[i];
    if (v === undefined || v === null) return 0;
    const num = typeof v === "bigint" ? Number(v) : Number(v);
    return Number.isFinite(num) ? num : 0;
  };
  return { food: at(0), wood: at(1), stone: at(2), ore: at(3), energy: at(4) };
};

export const formatCost = (cost: Partial<ActionCost> & { food?: number }) => {
  const food = finiteResource(cost.food);
  const wood = finiteResource(cost.wood);
  const stone = finiteResource(cost.stone);
  const ore = finiteResource(cost.ore);
  const energy = finiteResource(cost.energy);

  const parts: string[] = [];
  if (food > 0) parts.push(`food ${food}`);
  if (wood > 0) parts.push(`wood ${wood}`);
  if (stone > 0) parts.push(`stone ${stone}`);
  if (ore > 0) parts.push(`ore ${ore}`);
  if (energy > 0) parts.push(`energy ${energy}`);

  return parts.length > 0 ? parts.join(" / ") : "free";
};

export const managerStatusToLabel = (status: number) => {
  switch (status) {
    case 0:
      return "open";
    case 1:
      return "active";
    case 2:
      return "completed";
    case 3:
      return "cancelled";
    default:
      return "open";
  }
};

export const gameStatusToLabel = (status: number) => {
  switch (status) {
    case 1:
      return "zero-round";
    case 2:
      return "running";
    case 3:
      return "ended";
    default:
      return "waiting";
  }
};

export const normalizeOwner = (value?: string | null) => (value && value !== zeroAddress ? value : null);

export type HexTileContractFields = {
  q: number;
  r: number;
  biome: number;
  owner: string | null;
  discovered: boolean;
  structureExists: boolean;
  structureLevel: number;
  builtAtRound: number;
  collectedAtRound: number;
};

export const parseHexTileContractResult = (raw: unknown): HexTileContractFields | null => {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw) && ("q" in (raw as object) || "owner" in (raw as object))) {
    const o = raw as Record<string, unknown>;
    const own = o.owner;
    const addr = typeof own === "string" ? own : undefined;
    return {
      q: Number(o.q ?? 0),
      r: Number(o.r ?? 0),
      biome: Number(o.biome ?? 0),
      owner: normalizeOwner(addr),
      discovered: Boolean(o.discovered),
      structureExists: Boolean(o.structureExists),
      structureLevel: Number(o.structureLevel ?? 0),
      builtAtRound: Number(o.builtAtRound ?? 0),
      collectedAtRound: Number(o.collectedAtRound ?? 0)
    };
  }
  const a = raw as unknown[];
  if (!Array.isArray(a) || a.length < 6) return null;
  const own = a[3];
  const addr = typeof own === "string" ? own : undefined;
  return {
    q: Number(a[0] ?? 0),
    r: Number(a[1] ?? 0),
    biome: Number(a[2] ?? 0),
    owner: normalizeOwner(addr),
    discovered: Boolean(a[4]),
    structureExists: Boolean(a[5]),
    structureLevel: Number(a[6] ?? 0),
    builtAtRound: Number(a[7] ?? 0),
    collectedAtRound: Number(a[8] ?? 0)
  };
};

export type LobbyRoundTuple = {
  roundIndex: number;
  roundEndsAt: number;
  zeroRoundEndsAt: number;
  status: number;
  roundStartedAt: number;
  roundDurationSeconds: number;
};

export const readLobbyRoundTuple = (raw: unknown): LobbyRoundTuple | null => {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return {
      roundIndex: Number(raw[0] ?? 0),
      roundEndsAt: Number(raw[1] ?? 0),
      zeroRoundEndsAt: Number(raw[2] ?? 0),
      status: Number(raw[3] ?? 0),
      roundStartedAt: Number(raw[4] ?? 0),
      roundDurationSeconds: Number(raw[5] ?? 0)
    };
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const n = (keys: string[]) => {
      for (const k of keys) {
        const v = o[k];
        if (v !== undefined && v !== null) {
          const num = typeof v === "bigint" ? Number(v) : Number(v);
          return Number.isFinite(num) ? num : 0;
        }
      }
      return 0;
    };
    return {
      roundIndex: n(["roundIndex"]),
      roundEndsAt: n(["roundEndsAt"]),
      zeroRoundEndsAt: n(["zeroRoundEndsAt"]),
      status: n(["status"]),
      roundStartedAt: n(["roundStartedAt"]),
      roundDurationSeconds: n(["roundDurationSeconds"])
    };
  }
  return null;
};

/** `GameCore.getDefaultLobbyPhaseDurations` — wall-clock defaults from `GameConfig` (same source as host `startGame` tuning). */
export async function readDefaultLobbyPhaseDurations(
  publicClient: PublicClient,
  gameCore: `0x${string}`,
  gameCoreAbi: readonly unknown[]
): Promise<{ zeroRoundSeconds: number; runningRoundSeconds: number } | null> {
  try {
    const raw = await publicClient.readContract({
      address: gameCore,
      abi: gameCoreAbi as any,
      functionName: "getDefaultLobbyPhaseDurations",
      args: []
    });
    if (raw == null) return null;
    if (Array.isArray(raw) && raw.length >= 2) {
      return { zeroRoundSeconds: Number(raw[0]), runningRoundSeconds: Number(raw[1]) };
    }
    if (typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      const z = o.zeroRoundSeconds ?? o[0];
      const r = o.runningRoundSeconds ?? o[1];
      if (z != null && r != null) {
        return { zeroRoundSeconds: Number(z), runningRoundSeconds: Number(r) };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export const readMapConfigTuple = (raw: unknown): { seed: bigint; radius: number } | null => {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return { seed: BigInt(raw[0] ?? 0), radius: Number(raw[1] ?? 0) };
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.mapSeed != null) {
      return {
        seed: BigInt(o.mapSeed as bigint | string | number),
        radius: Number(o.mapRadius ?? 0)
      };
    }
  }
  return null;
};

export const emptyResources = () => ({ food: 0, wood: 0, stone: 0, ore: 0, energy: 0 });

export const buildPlayerState = (
  address: string,
  resources = emptyResources(),
  craftedGoods = 0,
  alive = true
) => ({
  address,
  nickname: short(address),
  hasTicket: true,
  bankruptRounds: 0,
  alive,
  resources,
  craftedGoods
});

export type { HexTile, LobbyState, ResourceKey };