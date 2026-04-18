import { encodePacked, keccak256 } from "viem";

const BIOMES = ["Plains", "Forest", "Mountains", "Desert"] as const;

export function biomeForCoord(seed: bigint, q: number, r: number): (typeof BIOMES)[number] {
  const hash = keccak256(encodePacked(["uint256", "int256", "int256"], [seed, BigInt(q), BigInt(r)]));
  const biomeIndex = Number(BigInt(hash) % 4n);
  return BIOMES[biomeIndex];
}

export type Tile = { id: string; q: number; r: number; biome: string };

export function generateTiles(seed: bigint, radius: number): Tile[] {
  const hexes: Tile[] = [];
  for (let q = -radius; q <= radius; q += 1) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r += 1) {
      hexes.push({
        id: `${q},${r}`,
        q,
        r,
        biome: biomeForCoord(seed, q, r)
      });
    }
  }
  return hexes;
}
