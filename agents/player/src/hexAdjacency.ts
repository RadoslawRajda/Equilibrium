/** Axial hex neighbors (same grid as `gameUtils.hexDirections` on the frontend). */
export const AXIAL_HEX_NEIGHBOR_DR = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1]
] as const;

export function axialHexAdjacent(a: { q: number; r: number }, b: { q: number; r: number }): boolean {
  return AXIAL_HEX_NEIGHBOR_DR.some(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}

export type TileForDiscovery = {
  id: string;
  q: number;
  r: number;
  owner: string | null;
  discovered: boolean;
};

/**
 * Hex ids the chain allows for `discoverHex`: undiscovered and sharing an edge with at least one hex you own.
 * Matches `GameCore.discoverHex` adjacency check.
 */
export function listDiscoverableHexIds(tiles: TileForDiscovery[], playerAddressLower: string): string[] {
  const mine = tiles.filter((t) => t.owner && t.owner.toLowerCase() === playerAddressLower);
  const ids: string[] = [];
  for (const t of tiles) {
    if (t.discovered) continue;
    if (!mine.some((o) => axialHexAdjacent(o, t))) continue;
    ids.push(t.id);
  }
  return ids.sort((a, b) => a.localeCompare(b));
}
