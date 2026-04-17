import { describe, expect, it } from "vitest";

import {
  biomeForCoord,
  buildPlayerState,
  emptyResources,
  formatCost,
  gameStatusToLabel,
  generateLocalMap,
  isAdjacent,
  isAdjacentToOwnedHex,
  managerStatusToLabel,
  normalizeContractResources,
  normalizeOwner,
  short
} from "./gameUtils";

describe("gameUtils", () => {
  it("formats addresses consistently", () => {
    expect(short("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234...5678");
    expect(short()).toBe("?");
  });

  it("formats resource costs", () => {
    expect(formatCost({ food: 10, wood: 20, stone: 30, ore: 40 })).toBe("food 10 / wood 20 / stone 30 / ore 40");
    expect(formatCost({ food: 0, wood: 0, stone: 0, ore: 0, energy: 5 })).toBe("energy 5");
    expect(formatCost({ food: 0, wood: 0, stone: 0, ore: 0, energy: 0 })).toBe("free");
  });

  it("normalizes viem-style resource structs", () => {
    expect(
      normalizeContractResources({
        food: 10n,
        wood: 20n,
        stone: 30n,
        ore: 40n,
        energy: 50n
      })
    ).toEqual({ food: 10, wood: 20, stone: 30, ore: 40, energy: 50 });
    expect(normalizeContractResources([1n, 2n, 3n, 4n, 5n])).toEqual({
      food: 1,
      wood: 2,
      stone: 3,
      ore: 4,
      energy: 5
    });
  });

  it("maps statuses to labels", () => {
    expect(managerStatusToLabel(0)).toBe("open");
    expect(managerStatusToLabel(2)).toBe("completed");
    expect(gameStatusToLabel(1)).toBe("zero-round");
    expect(gameStatusToLabel(3)).toBe("ended");
    expect(gameStatusToLabel(99)).toBe("waiting");
  });

  it("generates a stable hex layout for a fixed seed", () => {
    const hexes = generateLocalMap(123n, 2);
    expect(hexes).toHaveLength(19);
    expect(hexes[0]?.id).toBe("-2,0");
    expect(hexes.find((hex) => hex.id === "0,0")?.biome).toBe(biomeForCoord(123n, 0, 0));
  });

  it("detects adjacency and owned hex access", () => {
    const center = { id: "0,0", q: 0, r: 0, biome: "Plains", owner: null, discoveredBy: [], structure: null };
    const neighbor = { id: "1,0", q: 1, r: 0, biome: "Forest", owner: null, discoveredBy: [], structure: null };
    const nonNeighbor = { id: "2,0", q: 2, r: 0, biome: "Forest", owner: null, discoveredBy: [], structure: null };
    expect(isAdjacent(center, neighbor)).toBe(true);
    expect(isAdjacent(center, nonNeighbor)).toBe(false);
    expect(isAdjacentToOwnedHex([{ ...center, owner: "0xabc" }, neighbor], neighbor, "0xabc")).toBe(true);
  });

  it("normalizes owners and creates player state defaults", () => {
    expect(normalizeOwner("0x0000000000000000000000000000000000000000")).toBeNull();
    expect(normalizeOwner("0x1111111111111111111111111111111111111111")).toBe("0x1111111111111111111111111111111111111111");

    const player = buildPlayerState("0x1234567890abcdef1234567890abcdef12345678");
    expect(player.nickname).toBe("0x1234...5678");
    expect(player.resources).toEqual(emptyResources());
    expect(player.craftedGoods).toBe(0);
    expect(player.alive).toBe(true);
  });
});
