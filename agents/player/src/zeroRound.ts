import type { PublicClient } from "viem";
import { keccak256, toBytes, zeroAddress } from "viem";

import type { Tile } from "./maputil.js";

export type StartingCandidate = { id: string; q: number; r: number; biome: string };

function isZeroOwner(addr: unknown): boolean {
  if (addr == null) return true;
  const s = String(addr).toLowerCase();
  return s === "0x" || s === zeroAddress.toLowerCase();
}

/** Free starting hexes: chain owner is zero; q,r/biome come from local map (authoritative for picks). */
export async function buildStartingCandidates(
  client: PublicClient,
  gameCore: `0x${string}`,
  gameCoreAbi: readonly unknown[],
  lobbyId: bigint,
  tiles: Tile[]
): Promise<StartingCandidate[]> {
  const out: StartingCandidate[] = [];
  for (const t of tiles) {
    const raw = (await client.readContract({
      address: gameCore,
      abi: gameCoreAbi,
      functionName: "getHexTile",
      args: [lobbyId, t.id]
    })) as readonly unknown[];
    if (!isZeroOwner(raw[3])) continue;
    out.push({ id: t.id, q: t.q, r: t.r, biome: t.biome });
  }
  return out;
}

export function normalizeHexId(raw: string): string {
  return raw.trim().replace(/\s*,\s*/g, ",");
}

/** Prefer Plains, then other biomes; stable order for LLM cap. */
export function trimStartingCandidatesForLlm(
  candidates: StartingCandidate[],
  max: number
): StartingCandidate[] {
  if (candidates.length <= max) return [...candidates];
  const order: Record<string, number> = { Plains: 0, Forest: 1, Mountains: 2, Desert: 3 };
  const sorted = [...candidates].sort((a, b) => {
    const da = order[a.biome] ?? 9;
    const db = order[b.biome] ?? 9;
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });
  return sorted.slice(0, max);
}

/** When LLM fails or returns an invalid id — varies by wallet + lobby + attempt so bots diverge. */
export function deterministicStartingPick(
  candidates: StartingCandidate[],
  walletAddress: string,
  lobbyIdStr: string,
  attempt: number
): StartingCandidate {
  const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  const input = `${walletAddress.toLowerCase()}:${lobbyIdStr}:${attempt}:${sorted.map((c) => c.id).join("|")}`;
  const h = keccak256(toBytes(input));
  const idx = Number(BigInt(h) % BigInt(sorted.length));
  return sorted[idx]!;
}
