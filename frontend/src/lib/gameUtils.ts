import { encodePacked, keccak256 } from "viem";

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

export const formatCost = (cost: { food: number; wood?: number; stone?: number; ore?: number }) => {
  const parts = [
    `food ${cost.food}`,
    cost.wood !== undefined ? `wood ${cost.wood}` : null,
    cost.stone !== undefined ? `stone ${cost.stone}` : null,
    cost.ore !== undefined ? `ore ${cost.ore}` : null
  ].filter(Boolean);

  return parts.join(" / ");
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
    default:
      return "waiting";
  }
};

export const normalizeOwner = (value?: string | null) => (value && value !== zeroAddress ? value : null);

export const emptyResources = () => ({ food: 0, wood: 0, stone: 0, ore: 0, energy: 0 });

export const buildPlayerState = (address: string, resources = emptyResources()) => ({
  address,
  nickname: short(address),
  hasTicket: true,
  bankruptRounds: 0,
  alive: true,
  resources
});

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
};

export type { HexTile, LobbyState, ResourceKey };