import type { PublicClient } from "viem";

import { listDiscoverableHexIds } from "./hexAdjacency.js";
import { projectRunningRoundClock } from "./roundClock.js";
import { computeRebalanceTradeDraft } from "./tradeHints.js";
import type { BasicResourceKey } from "./tradeHints.js";

export type ResourcePouch = { food: number; wood: number; stone: number; ore: number; energy: number };

export type GameSnapshot = {
  lobbyId: number;
  /** Lowercase 0x address; use to match `tiles[].owner`. */
  playerAddress: string;
  round: {
    status: number;
    roundIndex: number;
    roundEndsAt: number;
    zeroRoundEndsAt: number;
    roundStartedAt: number;
    roundDurationSeconds: number;
    /**
     * Wall-clock projection (same math as `GameCore._syncRoundFromTimestamp`). On-chain `roundIndex` may lag until a tx; use
     * `logicalRoundIndex` for rules like collect (builtAtRound vs round, collected this tick).
     */
    clock?: {
      logicalRoundIndex: number;
      nextDeadlineSec: number;
      secondsLeftInTick: number;
      chainRoundIndex: number;
    };
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
    structure: {
      exists: boolean;
      level: number;
      builtAtRound: number;
      collectedThisRound?: boolean;
    };
  }>;
  proposals: Array<{ id: number; title: string; effectKey: string; resolved: boolean }>;
  /** Other roster players (lowercase), for `createTrade` / diplomacy. */
  peerAddresses: string[];
  /** Open offers you may `acceptTrade` (you are taker or offer is open). */
  openTrades: Array<{
    tradeId: number;
    maker: string;
    taker: string;
    offer: ResourcePouch;
    request: ResourcePouch;
    expiresAtRound: number;
  }>;
  /** Present when `trimSnapshotForLlm` dropped tiles so the model does not invent hex ids. */
  snapshotNote?: string;
  /** On-chain costs + booleans so the model does not hallucinate prices. */
  economyHints?: {
    roundIsRunning: boolean;
    victoryGoodsThreshold: number;
    alloyNeededToWin: number;
    craftAlloyCost: ResourcePouch;
    canCraftAlloy: boolean;
    /** True once you have at least one building — smelting before this burns stock without income. */
    hasAnyStructure: boolean;
    /** Affordable alloy craft *and* you already committed to structures (see strategy). */
    craftAlloyReasonable: boolean;
    buildCost: ResourcePouch;
    upgradeCost: ResourcePouch;
    canAffordBuildSomewhere: boolean;
    canAffordUpgradeSomewhere: boolean;
    discoverCostNext: ResourcePouch;
    discoverableHexIds: string[];
    canAffordDiscover: boolean;
    /** From `GameCore.previewCollectionEnergyCost` — must match on-chain `collect`. */
    collectEnergyLevel1: number;
    collectEnergyLevel2: number;
    /** From `GameCore.previewCollectionResourceYield` — biome selects which basic resource. */
    collectResourceYieldLevel1: number;
    collectResourceYieldLevel2: number;
    /** When set, posting `createTrade` with these pouches (open taker) is a strong rebalance move. */
    rebalanceTradeDraft?: {
      surplus: BasicResourceKey;
      shortage: BasicResourceKey;
      offer: ResourcePouch;
      request: ResourcePouch;
      expiryRounds: number;
    } | null;
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

export function canPayResources(player: ResourcePouch, cost: ResourcePouch): boolean {
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
  const meLc = me.toLowerCase();

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
  const roundEndsAt = Number(round[1] ?? 0n);
  const roundStartedAt = Number(round[4] ?? 0n);
  const roundDurationSeconds = Number(round[5] ?? 0n);
  const gameStatus = Number(round[3] ?? 0n);
  const nowSec = Math.floor(Date.now() / 1000);
  const clock =
    gameStatus === 2 && roundDurationSeconds > 0 && roundEndsAt > 0
      ? (() => {
          const p = projectRunningRoundClock({
            chainRoundIndex: roundIndex,
            roundEndsAt,
            durationSeconds: roundDurationSeconds,
            nowSec
          });
          return {
            logicalRoundIndex: p.logicalRoundIndex,
            nextDeadlineSec: p.nextDeadlineSec,
            secondsLeftInTick: Math.max(0, p.nextDeadlineSec - nowSec),
            chainRoundIndex: roundIndex
          };
        })()
      : undefined;
  const roundForTileChecks = clock?.logicalRoundIndex ?? roundIndex;
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
    const structExists = Boolean(t[5]);
    const structLevel = Number(t[6] ?? 0n);
    const builtAtRound = Number(t[7] ?? 0n);
    const collectedAtRound = Number(t[8] ?? 0n);
    tiles.push({
      id,
      q: Number(t[0] ?? 0n),
      r: Number(t[1] ?? 0n),
      biome: biomes[biomeIdx] ?? "Plains",
      owner: owner && owner.toLowerCase() !== zero.toLowerCase() ? owner : null,
      discovered: Boolean(t[4]),
      structure: {
        exists: structExists,
        level: structLevel,
        builtAtRound,
        collectedThisRound: collectedAtRound === roundForTileChecks
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
  const buildCostRaw = (await client.readContract({
    address: gameCore,
    abi: gameCoreAbi,
    functionName: "getBuildCost",
    args: []
  })) as unknown;
  const upgradeCostRaw = (await client.readContract({
    address: gameCore,
    abi: gameCoreAbi,
    functionName: "getUpgradeCost",
    args: []
  })) as unknown;
  const victoryThreshold = Number(
    (await client.readContract({
      address: gameCore,
      abi: gameCoreAbi,
      functionName: "getVictoryGoodsThreshold",
      args: []
    })) as bigint
  );

  const [ceL1, ceL2, cyL1, cyL2] = await Promise.all([
    client.readContract({
      address: gameCore,
      abi: gameCoreAbi,
      functionName: "previewCollectionEnergyCost",
      args: [1]
    }) as Promise<bigint>,
    client.readContract({
      address: gameCore,
      abi: gameCoreAbi,
      functionName: "previewCollectionEnergyCost",
      args: [2]
    }) as Promise<bigint>,
    client.readContract({
      address: gameCore,
      abi: gameCoreAbi,
      functionName: "previewCollectionResourceYield",
      args: [1]
    }) as Promise<bigint>,
    client.readContract({
      address: gameCore,
      abi: gameCoreAbi,
      functionName: "previewCollectionResourceYield",
      args: [2]
    }) as Promise<bigint>
  ]);
  const collectEnergyLevel1 = Number(ceL1);
  const collectEnergyLevel2 = Number(ceL2);
  const collectResourceYieldLevel1 = Number(cyL1);
  const collectResourceYieldLevel2 = Number(cyL2);

  const craftAlloyCost = asResourcePouch(craftCostRaw);
  const discoverCostNext = asResourcePouch(discoverCostRaw);
  const buildCost = asResourcePouch(buildCostRaw);
  const upgradeCost = asResourcePouch(upgradeCostRaw);
  const roundIsRunning = gameStatus === 2;
  const goods = Number(craftedGoods);
  const alloyNeededToWin = Math.max(0, victoryThreshold - goods);
  const discoverableHexIds = listDiscoverableHexIds(tiles, meLc);

  const mine = (t: (typeof tiles)[0]) => Boolean(t.owner && t.owner.toLowerCase() === meLc);
  const hasAnyStructure = tiles.some((t) => mine(t) && t.structure.exists);
  const canAffordBuildSomewhere = roundIsRunning && tiles.some(
    (t) => mine(t) && t.discovered && !t.structure.exists && canPayResources(resources, buildCost)
  );
  const canAffordUpgradeSomewhere = roundIsRunning && tiles.some(
    (t) =>
      mine(t) &&
      t.structure.exists &&
      t.structure.level === 1 &&
      canPayResources(resources, upgradeCost)
  );

  const canCraftAlloy =
    roundIsRunning && alloyNeededToWin > 0 && canPayResources(resources, craftAlloyCost);
  const craftAlloyReasonable = canCraftAlloy && hasAnyStructure;

  const economyHints = {
    roundIsRunning,
    victoryGoodsThreshold: victoryThreshold,
    alloyNeededToWin,
    craftAlloyCost,
    canCraftAlloy,
    hasAnyStructure,
    craftAlloyReasonable,
    buildCost,
    upgradeCost,
    canAffordBuildSomewhere,
    canAffordUpgradeSomewhere,
    discoverCostNext,
    discoverableHexIds,
    canAffordDiscover:
      roundIsRunning &&
      discoverableHexIds.length > 0 &&
      canPayResources(resources, discoverCostNext),
    collectEnergyLevel1,
    collectEnergyLevel2,
    collectResourceYieldLevel1,
    collectResourceYieldLevel2
  };

  const zeroAddr = "0x0000000000000000000000000000000000000000";
  const lobbyPlayers = (await client.readContract({
    address: gameCore,
    abi: gameCoreAbi,
    functionName: "getLobbyPlayers",
    args: [lobbyId]
  })) as `0x${string}`[];
  const peerAddresses = lobbyPlayers.map((a) => a.toLowerCase()).filter((a) => a !== meLc);

  const lr = clock?.logicalRoundIndex ?? roundIndex;
  const openTrades: GameSnapshot["openTrades"] = [];
  if (roundIsRunning) {
    for (let tid = 0; tid < 128; tid += 1) {
      let tr: unknown;
      try {
        tr = await client.readContract({
          address: gameCore,
          abi: gameCoreAbi,
          functionName: "getTrade",
          args: [lobbyId, BigInt(tid)]
        });
      } catch {
        break;
      }
      const o = tr as Record<string, unknown>;
      const accepted = Array.isArray(tr) ? Boolean(tr[2]) : Boolean(o.accepted);
      if (accepted) continue;
      const maker = (Array.isArray(tr) ? String(tr[0]) : String(o.maker ?? "")).toLowerCase();
      const taker = (Array.isArray(tr) ? String(tr[1]) : String(o.taker ?? "")).toLowerCase();
      if (!maker || maker === zeroAddr) continue;
      if (maker === meLc) continue;
      const expiresAtRound = Array.isArray(tr) ? Number(tr[4] ?? 0) : Number(o.expiresAtRound ?? 0);
      if (lr > expiresAtRound) continue;
      const takerOk = taker === zeroAddr || taker === meLc;
      if (!takerOk) continue;
      let offer: ResourcePouch;
      let request: ResourcePouch;
      if (Array.isArray(tr)) {
        offer = {
          food: Number(tr[5] ?? 0),
          wood: Number(tr[6] ?? 0),
          stone: Number(tr[7] ?? 0),
          ore: Number(tr[8] ?? 0),
          energy: Number(tr[9] ?? 0)
        };
        request = {
          food: Number(tr[10] ?? 0),
          wood: Number(tr[11] ?? 0),
          stone: Number(tr[12] ?? 0),
          ore: Number(tr[13] ?? 0),
          energy: Number(tr[14] ?? 0)
        };
      } else {
        offer = {
          food: Number(o.offerFood ?? 0),
          wood: Number(o.offerWood ?? 0),
          stone: Number(o.offerStone ?? 0),
          ore: Number(o.offerOre ?? 0),
          energy: Number(o.offerEnergy ?? 0)
        };
        request = {
          food: Number(o.requestFood ?? 0),
          wood: Number(o.requestWood ?? 0),
          stone: Number(o.requestStone ?? 0),
          ore: Number(o.requestOre ?? 0),
          energy: Number(o.requestEnergy ?? 0)
        };
      }
      openTrades.push({
        tradeId: tid,
        maker,
        taker: taker === zeroAddr ? "" : taker,
        offer,
        request,
        expiresAtRound
      });
    }
  }

  return {
    lobbyId: Number(lobbyId),
    playerAddress: meLc,
    round: {
      status: gameStatus,
      roundIndex,
      roundEndsAt,
      zeroRoundEndsAt: Number(round[2] ?? 0n),
      roundStartedAt,
      roundDurationSeconds,
      ...(clock ? { clock } : {})
    },
    resources,
    craftedGoods: goods,
    ownedHexCount: Number(ownedHexCount),
    tiles,
    proposals,
    peerAddresses,
    openTrades,
    economyHints: {
      ...economyHints,
      rebalanceTradeDraft: computeRebalanceTradeDraft(
        resources,
        peerAddresses.length > 0,
        roundIsRunning
      )
    }
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

/** Energy to collect once — prefer `economyHints` from snapshot (read from chain). */
export function collectionEnergyForLevel(level: number, hints?: GameSnapshot["economyHints"]): number {
  if (hints?.collectEnergyLevel1 != null && hints?.collectEnergyLevel2 != null) {
    return level <= 1 ? hints.collectEnergyLevel1 : hints.collectEnergyLevel2;
  }
  return level <= 1 ? 10 : 20;
}
