import type { PublicClient } from "viem";

export type ResourcePouch = { food: number; wood: number; stone: number; ore: number; energy: number };

export type GameSnapshot = {
  lobbyId: number;
  round: {
    status: number;
    roundIndex: number;
    roundEndsAt: number;
    zeroRoundEndsAt: number;
  };
  resources: ResourcePouch;
  craftedGoods: number;
  ownedHexCount: number;
  tiles: Array<{
    id: string;
    q: number;
    r: number;
    biome: string;
    owner: string | null;
    discovered: boolean;
    structure: { exists: boolean; level: number; collectedThisRound?: boolean };
  }>;
  proposals: Array<{ id: number; title: string; effectKey: string; resolved: boolean }>;
  /** Present when `trimSnapshotForLlm` dropped tiles so the model does not invent hex ids. */
  snapshotNote?: string;
  /** On-chain costs + booleans so the model does not hallucinate “waiting for ore”. */
  economyHints?: {
    roundIsRunning: boolean;
    victoryGoodsThreshold: number;
    alloyNeededToWin: number;
    craftAlloyCost: ResourcePouch;
    canCraftAlloy: boolean;
    discoverCostNext: ResourcePouch;
    canAffordDiscover: boolean;
  };
};

function asResourcePouch(x: unknown): ResourcePouch {
  if (Array.isArray(x)) {
    return {
      food: Number(x[0] ?? 0),
      wood: Number(x[1] ?? 0),
      stone: Number(x[2] ?? 0),
      ore: Number(x[3] ?? 0),
      energy: Number(x[4] ?? 0)
    };
  }
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return {
      food: Number(o.food ?? 0),
      wood: Number(o.wood ?? 0),
      stone: Number(o.stone ?? 0),
      ore: Number(o.ore ?? 0),
      energy: Number(o.energy ?? 0)
    };
  }
  return { food: 0, wood: 0, stone: 0, ore: 0, energy: 0 };
}

function canPayResources(player: ResourcePouch, cost: ResourcePouch): boolean {
  return (
    player.food >= cost.food &&
    player.wood >= cost.wood &&
    player.stone >= cost.stone &&
    player.ore >= cost.ore &&
    player.energy >= cost.energy
  );
}

export async function buildSnapshot(
  client: PublicClient,
  gameCore: `0x${string}`,
  gameCoreAbi: readonly unknown[],
  lobbyId: bigint,
  me: `0x${string}`,
  tileIds: string[]
): Promise<GameSnapshot> {
  const round = (await client.readContract({
    address: gameCore,
    abi: gameCoreAbi,
    functionName: "getLobbyRound",
    args: [lobbyId]
  })) as readonly bigint[];
  /* tuple: roundIndex, roundEndsAt, zeroRoundEndsAt, status, roundStartedAt, roundDurationSeconds */

  const [food, wood, stone, ore, energy] = (await client.readContract({
    address: gameCore,
    abi: gameCoreAbi,
    functionName: "getPlayerResources",
    args: [lobbyId, me]
  })) as bigint[];

  const craftedGoods = (await client.readContract({
    address: gameCore,
    abi: gameCoreAbi,
    functionName: "getPlayerCraftedGoods",
    args: [lobbyId, me]
  })) as bigint;

  const ownedHexCount = (await client.readContract({
    address: gameCore,
    abi: gameCoreAbi,
    functionName: "getPlayerOwnedHexCount",
    args: [lobbyId, me]
  })) as bigint;

  const propCount = Number(
    (await client.readContract({
      address: gameCore,
      abi: gameCoreAbi,
      functionName: "getProposalCount",
      args: [lobbyId]
    })) as bigint
  );

  const proposals: GameSnapshot["proposals"] = [];
  for (let i = 0; i < propCount; i += 1) {
    const pr = (await client.readContract({
      address: gameCore,
      abi: gameCoreAbi,
      functionName: "getProposal",
      args: [lobbyId, BigInt(i)]
    })) as readonly unknown[];
    const title = String(pr[0] ?? "");
    const effectKey = String(pr[1] ?? "");
    const resolved = Boolean(pr[4]);
    proposals.push({ id: i, title, effectKey, resolved });
  }

  const tiles: GameSnapshot["tiles"] = [];
  const roundIndex = Number(round[0] ?? 0n);
  const gameStatus = Number(round[3] ?? 0n);
  for (const id of tileIds) {
    const t = (await client.readContract({
      address: gameCore,
      abi: gameCoreAbi,
      functionName: "getHexTile",
      args: [lobbyId, id]
    })) as readonly unknown[];
    const owner = t[3] as string;
    const zero = "0x0000000000000000000000000000000000000000";
    const biomeIdx = Number(t[2] ?? 0n);
    const biomes = ["Plains", "Forest", "Mountains", "Desert"];
    const collectedAt = Number(t[8] ?? 0n);
    tiles.push({
      id,
      q: Number(t[0] ?? 0n),
      r: Number(t[1] ?? 0n),
      biome: biomes[biomeIdx] ?? "Plains",
      owner: owner && owner.toLowerCase() !== zero.toLowerCase() ? owner : null,
      discovered: Boolean(t[4]),
      structure: {
        exists: Boolean(t[5]),
        level: Number(t[6] ?? 0n),
        collectedThisRound: collectedAt === roundIndex
      }
    });
  }

  const resources: ResourcePouch = {
    food: Number(food),
    wood: Number(wood),
    stone: Number(stone),
    ore: Number(ore),
    energy: Number(energy)
  };

  const craftCostRaw = (await client.readContract({
    address: gameCore,
    abi: gameCoreAbi,
    functionName: "previewCraftAlloyCost",
    args: []
  })) as unknown;
  const discoverCostRaw = (await client.readContract({
    address: gameCore,
    abi: gameCoreAbi,
    functionName: "previewDiscoverCost",
    args: [lobbyId, me]
  })) as unknown;
  const victoryThreshold = Number(
    (await client.readContract({
      address: gameCore,
      abi: gameCoreAbi,
      functionName: "getVictoryGoodsThreshold",
      args: []
    })) as bigint
  );

  const craftAlloyCost = asResourcePouch(craftCostRaw);
  const discoverCostNext = asResourcePouch(discoverCostRaw);
  const roundIsRunning = gameStatus === 2;
  const goods = Number(craftedGoods);
  const alloyNeededToWin = Math.max(0, victoryThreshold - goods);
  const hasUndiscovered = tiles.some((t) => !t.discovered);

  const economyHints = {
    roundIsRunning,
    victoryGoodsThreshold: victoryThreshold,
    alloyNeededToWin,
    craftAlloyCost,
    canCraftAlloy: roundIsRunning && alloyNeededToWin > 0 && canPayResources(resources, craftAlloyCost),
    discoverCostNext,
    canAffordDiscover: roundIsRunning && hasUndiscovered && canPayResources(resources, discoverCostNext)
  };

  return {
    lobbyId: Number(lobbyId),
    round: {
      status: gameStatus,
      roundIndex,
      roundEndsAt: Number(round[1] ?? 0n),
      zeroRoundEndsAt: Number(round[2] ?? 0n)
    },
    resources,
    craftedGoods: goods,
    ownedHexCount: Number(ownedHexCount),
    tiles,
    proposals,
    economyHints
  };
}

/**
 * Small LLMs often ramble about large JSON instead of returning a plan. Keep discovered tiles first, then cap count.
 */
export function trimSnapshotForLlm(snap: GameSnapshot, maxTiles: number): GameSnapshot {
  const cap = Math.max(12, Math.floor(maxTiles));
  if (snap.tiles.length <= cap) return snap;
  const discovered = snap.tiles.filter((t) => t.discovered);
  const rest = snap.tiles.filter((t) => !t.discovered);
  const merged = [...discovered, ...rest].slice(0, cap);
  return {
    ...snap,
    tiles: merged,
    snapshotNote: `tiles capped ${merged.length}/${snap.tiles.length}; discovered listed first; use only hex ids from "tiles".`
  };
}
