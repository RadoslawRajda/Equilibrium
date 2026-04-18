import type { PublicClient } from "viem";

import { generateTiles } from "./maputil.js";

type ResourcePouch = {
  food: number;
  wood: number;
  stone: number;
  ore: number;
  energy: number;
};

type RoundInfo = {
  status: number;
  statusLabel: "waiting" | "zero-round" | "running" | "ended" | "unknown";
  roundIndex: number;
  roundEndsAt: number;
  zeroRoundEndsAt: number;
  roundStartedAt: number;
  roundDurationSeconds: number;
};

type HexState = {
  id: string;
  q: number;
  r: number;
  biome: string;
  discovered: boolean;
  owner: string | null;
  structure: {
    exists: boolean;
    level: number;
    builtAtRound: number;
  };
};

export type GameContext = {
  rawState: {
    lobbyId: string;
    playerAddress: string;
    players: string[];
    round: RoundInfo;
    resources: ResourcePouch;
    craftedGoods: number;
    ownedHexCount: number;
    costs: {
      build: ResourcePouch;
      upgrade: ResourcePouch;
      craftAlloy: ResourcePouch;
      discoverNext: ResourcePouch;
    };
    tiles: HexState[];
  };
  summaryText: string;
  playerPerspective: {
    roundIsRunning: boolean;
    canBuildNow: boolean;
    canUpgradeNow: boolean;
    canCraftAlloyNow: boolean;
    canDiscoverNow: boolean;
    ownedBiomes: Record<string, number>;
    suggestions: string[];
  };
};

function statusLabelFromCode(status: number): RoundInfo["statusLabel"] {
  if (status === 0) return "waiting";
  if (status === 1) return "zero-round";
  if (status === 2) return "running";
  if (status === 3) return "ended";
  return "unknown";
}

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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timeout while reading ${label} after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function summarizeContext(state: GameContext["rawState"], perspective: GameContext["playerPerspective"]): string {
  const topBiomes = Object.entries(perspective.ownedBiomes)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([biome, count]) => `${biome} (${count})`)
    .join(", ");

  const r = state.resources;
  const lines = [
    `Lobby ${state.lobbyId} is in ${state.round.statusLabel} state, round ${state.round.roundIndex}.`,
    `Your resources are F:${r.food} W:${r.wood} S:${r.stone} O:${r.ore} E:${r.energy}; alloy: ${state.craftedGoods}; owned hexes: ${state.ownedHexCount}.`,
    topBiomes
      ? `Your strongest biome presence: ${topBiomes}.`
      : "You currently do not control discovered biome structures yet."
  ];

  return lines.join(" ");
}

export async function getGameContext(args: {
  client: PublicClient;
  gameCoreAddress: `0x${string}`;
  gameCoreAbi: readonly unknown[];
  lobbyId: string;
  playerAddress: `0x${string}`;
  timeoutMs: number;
}): Promise<GameContext> {
  const { client, gameCoreAddress, gameCoreAbi, lobbyId, playerAddress, timeoutMs } = args;
  const lobbyIdBig = BigInt(lobbyId);
  const me = playerAddress.toLowerCase();

  const [roundRaw, playersRaw, mapConfigRaw, resourcesRaw, craftedGoodsRaw, ownedHexCountRaw, buildCostRaw, upgradeCostRaw, craftCostRaw, discoverCostRaw] =
    await Promise.all([
      withTimeout(
        client.readContract({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "getLobbyRound",
          args: [lobbyIdBig]
        }) as Promise<readonly bigint[]>,
        timeoutMs,
        "getLobbyRound"
      ),
      withTimeout(
        client.readContract({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "getLobbyPlayers",
          args: [lobbyIdBig]
        }) as Promise<`0x${string}`[]>,
        timeoutMs,
        "getLobbyPlayers"
      ),
      withTimeout(
        client.readContract({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "getMapConfig",
          args: [lobbyIdBig]
        }) as Promise<readonly [bigint, bigint]>,
        timeoutMs,
        "getMapConfig"
      ),
      withTimeout(
        client.readContract({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "getPlayerResources",
          args: [lobbyIdBig, playerAddress]
        }) as Promise<unknown>,
        timeoutMs,
        "getPlayerResources"
      ),
      withTimeout(
        client.readContract({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "getPlayerCraftedGoods",
          args: [lobbyIdBig, playerAddress]
        }) as Promise<bigint>,
        timeoutMs,
        "getPlayerCraftedGoods"
      ),
      withTimeout(
        client.readContract({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "getPlayerOwnedHexCount",
          args: [lobbyIdBig, playerAddress]
        }) as Promise<bigint>,
        timeoutMs,
        "getPlayerOwnedHexCount"
      ),
      withTimeout(
        client.readContract({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "getBuildCost",
          args: []
        }) as Promise<unknown>,
        timeoutMs,
        "getBuildCost"
      ),
      withTimeout(
        client.readContract({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "getUpgradeCost",
          args: []
        }) as Promise<unknown>,
        timeoutMs,
        "getUpgradeCost"
      ),
      withTimeout(
        client.readContract({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "previewCraftAlloyCost",
          args: []
        }) as Promise<unknown>,
        timeoutMs,
        "previewCraftAlloyCost"
      ),
      withTimeout(
        client.readContract({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "previewDiscoverCost",
          args: [lobbyIdBig, playerAddress]
        }) as Promise<unknown>,
        timeoutMs,
        "previewDiscoverCost"
      )
    ]);

  const round: RoundInfo = {
    status: Number(roundRaw[3] ?? 0n),
    statusLabel: statusLabelFromCode(Number(roundRaw[3] ?? 0n)),
    roundIndex: Number(roundRaw[0] ?? 0n),
    roundEndsAt: Number(roundRaw[1] ?? 0n),
    zeroRoundEndsAt: Number(roundRaw[2] ?? 0n),
    roundStartedAt: Number(roundRaw[4] ?? 0n),
    roundDurationSeconds: Number(roundRaw[5] ?? 0n)
  };

  const resources = asResourcePouch(resourcesRaw);
  const buildCost = asResourcePouch(buildCostRaw);
  const upgradeCost = asResourcePouch(upgradeCostRaw);
  const craftAlloyCost = asResourcePouch(craftCostRaw);
  const discoverCost = asResourcePouch(discoverCostRaw);

  const [seed, radiusRaw] = mapConfigRaw;
  const radius = Number(radiusRaw);
  const allTiles = generateTiles(seed, radius);
  const MAX_TILES_TO_READ = 28;
  const tilesToRead = allTiles.slice(0, MAX_TILES_TO_READ);
  const tileReadTimeoutMs = Math.max(1_200, Math.floor(timeoutMs / 2));

  const settledTiles = await Promise.allSettled(
    tilesToRead.map(async (tile) => {
      const t = await withTimeout(
        client.readContract({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "getHexTile",
          args: [lobbyIdBig, tile.id]
        }) as Promise<readonly unknown[]>,
        tileReadTimeoutMs,
        `getHexTile(${tile.id})`
      );
      const owner = String(t[3] ?? "");
      const zero = "0x0000000000000000000000000000000000000000";

      return {
        id: tile.id,
        q: Number(t[0] ?? tile.q),
        r: Number(t[1] ?? tile.r),
        biome: tile.biome,
        discovered: Boolean(t[4]),
        owner: owner && owner.toLowerCase() !== zero ? owner.toLowerCase() : null,
        structure: {
          exists: Boolean(t[5]),
          level: Number(t[6] ?? 0n),
          builtAtRound: Number(t[7] ?? 0n)
        }
      } satisfies HexState;
    })
  );

  const tileStates = settledTiles
    .filter((row): row is PromiseFulfilledResult<HexState> => row.status === "fulfilled")
    .map((row) => row.value);

  const mine = tileStates.filter((t) => t.owner === me);
  const roundIsRunning = round.status === 2;

  const ownedBiomes: Record<string, number> = {
    Plains: 0,
    Forest: 0,
    Mountains: 0,
    Desert: 0
  };
  for (const t of mine) {
    ownedBiomes[t.biome] = (ownedBiomes[t.biome] ?? 0) + 1;
  }

  const canBuildNow =
    roundIsRunning &&
    canPayResources(resources, buildCost) &&
    mine.some((t) => t.discovered && !t.structure.exists);

  const canUpgradeNow =
    roundIsRunning &&
    canPayResources(resources, upgradeCost) &&
    mine.some((t) => t.structure.exists && t.structure.level === 1);

  const canCraftAlloyNow = roundIsRunning && canPayResources(resources, craftAlloyCost);

  const canDiscoverNow =
    roundIsRunning &&
    canPayResources(resources, discoverCost) &&
    mine.some((t) => {
      const neighbors = [
        `${t.q + 1},${t.r}`,
        `${t.q - 1},${t.r}`,
        `${t.q},${t.r + 1}`,
        `${t.q},${t.r - 1}`,
        `${t.q + 1},${t.r - 1}`,
        `${t.q - 1},${t.r + 1}`
      ];
      return neighbors.some((id) => {
        const n = tileStates.find((x) => x.id === id);
        return Boolean(n && n.owner === null && !n.discovered);
      });
    });

  const suggestions: string[] = [];
  if (canBuildNow) suggestions.push("You can build a level 1 structure now.");
  if (canUpgradeNow) suggestions.push("You can upgrade at least one structure to level 2.");
  if (canCraftAlloyNow) suggestions.push("You can craft alloy this turn.");
  if (!canDiscoverNow && roundIsRunning) suggestions.push("Consider trading to afford your next discover cost.");

  const rawState: GameContext["rawState"] = {
    lobbyId,
    playerAddress: me,
    players: playersRaw.map((p) => p.toLowerCase()),
    round,
    resources,
    craftedGoods: Number(craftedGoodsRaw),
    ownedHexCount: Number(ownedHexCountRaw),
    costs: {
      build: buildCost,
      upgrade: upgradeCost,
      craftAlloy: craftAlloyCost,
      discoverNext: discoverCost
    },
    tiles: tileStates
  };

  const playerPerspective: GameContext["playerPerspective"] = {
    roundIsRunning,
    canBuildNow,
    canUpgradeNow,
    canCraftAlloyNow,
    canDiscoverNow,
    ownedBiomes,
    suggestions
  };

  return {
    rawState,
    summaryText: summarizeContext(rawState, playerPerspective),
    playerPerspective
  };
}
