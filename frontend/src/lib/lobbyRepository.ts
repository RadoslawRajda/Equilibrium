import { formatEther } from "viem";

import type { HexTile, LobbyState, TradeOfferView } from "../types";
import {
  buildPlayerState,
  emptyResources,
  gameStatusToLabel,
  generateLocalMap,
  managerStatusToLabel,
  normalizeContractResources,
  normalizeOwner,
  parseHexTileContractResult,
  readLobbyRoundTuple,
  readMapConfigTuple,
  type ActionCosts
} from "./gameUtils";

function parseGetTradeTuple(raw: unknown, id: number): TradeOfferView | null {
  if (!Array.isArray(raw) || raw.length < 15) return null;
  const n = (i: number) => Math.max(0, Math.floor(Number(raw[i] ?? 0)));
  return {
    id,
    maker: String(raw[0]),
    taker: String(raw[1]),
    accepted: Boolean(raw[2]),
    createdAtRound: n(3),
    expiresAtRound: n(4),
    offer: { food: n(5), wood: n(6), stone: n(7), ore: n(8), energy: n(9) },
    request: { food: n(10), wood: n(11), stone: n(12), ore: n(13), energy: n(14) }
  };
}

export type LobbySummary = {
  id: string;
  name: string;
  status: string;
  playerCount: number;
  host: string;
  prizePool: string;
  /** True when GameCore reports Ended (LobbyManager may still be "active" until completeGame). */
  matchEndedOnChain?: boolean;
};

export type LoadSummariesResult = {
  lobbies: LobbySummary[];
  /** LobbyManager bytecode missing at configured address (wrong chain / not deployed). */
  lobbyManagerMissing?: boolean;
  /** Contract present but getLobbyCount or follow-up reads failed (stale ABI, etc.). */
  readFailed?: boolean;
};

type HexOverride = {
  owner: string;
  discoveredBy: string[];
  /** If set, overrides chain; omit so builds/upgrades read from chain after sync */
  structure?: LobbyState["mapHexes"][number]["structure"];
};

export type ChainReadContext = {
  publicClient: any;
  lobbyManagerAddress?: `0x${string}`;
  lobbyManagerAbi?: any[];
  gameCoreAddress?: `0x${string}`;
  gameCoreAbi?: any[];
  viewerAddress?: string;
  localHexOverrides?: Map<string, HexOverride>;
};

export class LobbyRepository {
  constructor(private readonly context: ChainReadContext) {}

  /** True if bytecode exists at the configured LobbyManager address (same RPC as the app). */
  async isLobbyManagerDeployed(): Promise<boolean> {
    const { publicClient, lobbyManagerAddress } = this.context;
    if (!publicClient || !lobbyManagerAddress) return false;
    const code = await publicClient.getBytecode({ address: lobbyManagerAddress }).catch(() => undefined);
    return Boolean(code && code !== "0x");
  }

  async loadSummaries(): Promise<LoadSummariesResult> {
    const { publicClient, lobbyManagerAddress, lobbyManagerAbi, gameCoreAddress, gameCoreAbi } = this.context;
    if (!publicClient || !lobbyManagerAddress || !lobbyManagerAbi) {
      return { lobbies: [] };
    }

    const code = await publicClient.getBytecode({ address: lobbyManagerAddress }).catch(() => undefined);
    if (!code || code === "0x") {
      return { lobbies: [], lobbyManagerMissing: true };
    }

    let lobbyCount = 0;
    try {
      lobbyCount = Number(await publicClient.readContract({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "getLobbyCount"
      } as any));
    } catch (error) {
      console.error("Failed to load lobbies from chain. ABI/address might be out of sync.", error);
      return { lobbies: [], readFailed: true };
    }

    const summaries = await Promise.all(
      Array.from({ length: lobbyCount }, async (_, index) => {
        const lobbyId = index + 1;
        try {
          const lobby = await publicClient.readContract({
            address: lobbyManagerAddress,
            abi: lobbyManagerAbi,
            functionName: "getLobby",
            args: [BigInt(lobbyId)]
          } as any);

          const [host, name, , lmStatus, prizePool, playerCount] = lobby as [
            string,
            string,
            bigint,
            bigint,
            bigint,
            bigint,
            string
          ];
          let matchEndedOnChain = false;
          if (gameCoreAddress && gameCoreAbi) {
            try {
              const roundRaw = await publicClient.readContract({
                address: gameCoreAddress,
                abi: gameCoreAbi,
                functionName: "getLobbyRound",
                args: [BigInt(lobbyId)]
              } as any);
              const rp = readLobbyRoundTuple(roundRaw);
              matchEndedOnChain = rp !== null && rp.status === 3;
            } catch {
              matchEndedOnChain = false;
            }
          }
          const lmLabel = managerStatusToLabel(Number(lmStatus));
          const displayStatus =
            matchEndedOnChain && lmLabel === "active" ? "finished (on-chain)" : lmLabel;
          return {
            id: String(lobbyId),
            name,
            status: displayStatus,
            playerCount: Number(playerCount),
            host,
            prizePool: formatEther(prizePool),
            matchEndedOnChain
          } satisfies LobbySummary;
        } catch {
          return null;
        }
      })
    );

    return { lobbies: summaries.filter((summary): summary is LobbySummary => summary !== null) };
  }

  async loadLobbyState(
    lobbyId: string
  ): Promise<{
    lobby: LobbyState;
    mapConfig: { seed: string; radius: number } | null;
    actionCosts: ActionCosts | null;
    bankTradeBulkMaxLots: number;
  } | null> {
    const {
      publicClient,
      lobbyManagerAddress,
      lobbyManagerAbi,
      gameCoreAddress,
      gameCoreAbi,
      viewerAddress,
      localHexOverrides
    } = this.context;

    if (!publicClient || !lobbyManagerAddress || !lobbyManagerAbi || !gameCoreAddress || !gameCoreAbi) {
      return null;
    }

    const [lmCode, gcCode] = await Promise.all([
      publicClient.getBytecode({ address: lobbyManagerAddress }).catch(() => undefined as string | undefined),
      publicClient.getBytecode({ address: gameCoreAddress }).catch(() => undefined as string | undefined)
    ]);
    if (!lmCode || lmCode === "0x" || !gcCode || gcCode === "0x") {
      return null;
    }

    try {
      const [lobbyData, playerAddresses, roundData, mapConfig] = await Promise.all([
        publicClient.readContract({
          address: lobbyManagerAddress,
          abi: lobbyManagerAbi,
          functionName: "getLobby",
          args: [BigInt(lobbyId)]
        } as any),
        publicClient.readContract({
          address: lobbyManagerAddress,
          abi: lobbyManagerAbi,
          functionName: "getLobbyPlayers",
          args: [BigInt(lobbyId)]
        } as any),
        publicClient.readContract({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "getLobbyRound",
          args: [BigInt(lobbyId)]
        } as any).catch(() => null),
        publicClient.readContract({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "getMapConfig",
          args: [BigInt(lobbyId)]
        } as any).catch(() => null)
      ]);

      const [host, name, , lmStatusRaw, prizePool, , winnerRaw] = lobbyData as [
        string,
        string,
        bigint,
        bigint,
        bigint,
        bigint,
        string
      ];
      const lmStatus = Number(lmStatusRaw);
      const lmPlayers = playerAddresses as string[];
      let gcPlayers: string[] = [];
      try {
        const raw = await publicClient.readContract({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "getLobbyPlayers",
          args: [BigInt(lobbyId)]
        } as any);
        gcPlayers = (raw as string[]).filter(Boolean);
      } catch {
        gcPlayers = [];
      }

      let viewerLobbyManagerTicket = false;
      if (viewerAddress) {
        try {
          viewerLobbyManagerTicket = Boolean(
            await publicClient.readContract({
              address: lobbyManagerAddress,
              abi: lobbyManagerAbi,
              functionName: "hasTicket",
              args: [BigInt(lobbyId), viewerAddress as `0x${string}`]
            } as any)
          );
        } catch {
          viewerLobbyManagerTicket = false;
        }
      }

      const viewerInGameCore = Boolean(
        viewerAddress &&
          gcPlayers.some((a) => a.toLowerCase() === viewerAddress.toLowerCase())
      );
      const viewerNeedsGameCoreJoin = Boolean(viewerAddress && viewerLobbyManagerTicket && !viewerInGameCore);

      const roundParsed = readLobbyRoundTuple(roundData);
      const gcStatusNum = roundParsed !== null ? roundParsed.status : null;
      const gcEnded = gcStatusNum === 3;
      const rounds = roundParsed
        ? {
            index: roundParsed.roundIndex,
            startedAt: roundParsed.roundStartedAt || null,
            durationSeconds: roundParsed.roundDurationSeconds || null,
            nextRoundAt: roundParsed.roundEndsAt || null,
            zeroRoundEndsAt: roundParsed.zeroRoundEndsAt || null
          }
        : {
            index: 0,
            startedAt: null,
            durationSeconds: null,
            nextRoundAt: null,
            zeroRoundEndsAt: null
          };

      const zeroAddr = "0x0000000000000000000000000000000000000000";
      const declaredWinnerAddress =
        winnerRaw && typeof winnerRaw === "string" && winnerRaw.toLowerCase() !== zeroAddr.toLowerCase()
          ? winnerRaw
          : null;

      let status: LobbyState["status"];
      if (lmStatus === 3) {
        status = "cancelled";
      } else if (gcEnded || lmStatus === 2) {
        status = "ended";
      } else if (gcStatusNum !== null && gcStatusNum !== undefined) {
        status = gameStatusToLabel(gcStatusNum) as LobbyState["status"];
      } else {
        status = "waiting";
      }

      /** After bootstrap, GameCore.players is canonical; LobbyManager can list ticket-holders who never `joinLobby` — that showed as “eliminated” with 0 res. */
      const playerAddressList =
        status !== "waiting" && status !== "cancelled" && gcPlayers.length > 0 ? gcPlayers : lmPlayers;

      /** Spectator / sidebar: load every roster player's economy from GameCore (not only the connected wallet). */
      const fetchAllPlayersEconomy =
        playerAddressList.length > 0 &&
        gcPlayers.length > 0 &&
        (status === "zero-round" || status === "running" || status === "ended");

      let playerResources: unknown = null;
      let viewerCraftedGoods = 0n;
      const resourcesByAddr: Record<string, ReturnType<typeof normalizeContractResources>> = {};
      const craftedByAddr: Record<string, number> = {};

      if (fetchAllPlayersEconomy) {
        const [resBatch, goodsBatch] = await Promise.all([
          Promise.all(
            playerAddressList.map((addr) =>
              publicClient
                .readContract({
                  address: gameCoreAddress,
                  abi: gameCoreAbi,
                  functionName: "getPlayerResources",
                  args: [BigInt(lobbyId), addr as `0x${string}`]
                } as any)
                .catch(() => null)
            )
          ),
          Promise.all(
            playerAddressList.map((addr) =>
              publicClient
                .readContract({
                  address: gameCoreAddress,
                  abi: gameCoreAbi,
                  functionName: "getPlayerCraftedGoods",
                  args: [BigInt(lobbyId), addr as `0x${string}`]
                } as any)
                .then((g: unknown) => Number(g ?? 0))
                .catch(() => 0)
            )
          )
        ]);
        playerAddressList.forEach((addr, i) => {
          const k = addr.toLowerCase();
          const raw = resBatch[i];
          resourcesByAddr[k] = raw ? normalizeContractResources(raw) : emptyResources();
          craftedByAddr[k] = goodsBatch[i] ?? 0;
        });
        if (viewerAddress) {
          const vk = viewerAddress.toLowerCase();
          const vi = playerAddressList.findIndex((a) => a.toLowerCase() === vk);
          playerResources = vi >= 0 ? resBatch[vi] : null;
          viewerCraftedGoods = BigInt(Math.floor(craftedByAddr[vk] ?? 0));
        }
      } else {
        const [pr, vcg] = await Promise.all([
          viewerAddress
            ? publicClient
                .readContract({
                  address: gameCoreAddress,
                  abi: gameCoreAbi,
                  functionName: "getPlayerResources",
                  args: [BigInt(lobbyId), viewerAddress]
                } as any)
                .catch(() => null)
            : Promise.resolve(null),
          viewerAddress
            ? publicClient
                .readContract({
                  address: gameCoreAddress,
                  abi: gameCoreAbi,
                  functionName: "getPlayerCraftedGoods",
                  args: [BigInt(lobbyId), viewerAddress]
                } as any)
                .catch(() => 0n)
            : Promise.resolve(0n)
        ]);
        playerResources = pr;
        viewerCraftedGoods = vcg as bigint;
      }
      const [buildCostRaw, upgradeCostRaw, discoverCostRaw, bankBulkMaxRaw, collectE1Raw, collectE2Raw, collectY1Raw, collectY2Raw] =
        await Promise.all([
          publicClient.readContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "getBuildCost"
          } as any).catch(() => null),
          publicClient.readContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "getUpgradeCost"
          } as any).catch(() => null),
          viewerAddress
            ? publicClient.readContract({
                address: gameCoreAddress,
                abi: gameCoreAbi,
                functionName: "previewDiscoverCost",
                args: [BigInt(lobbyId), viewerAddress]
              } as any).catch(() => null)
            : null,
          publicClient.readContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "getBankTradeBulkMaxLots"
          } as any).catch(() => 48n),
          publicClient.readContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "previewCollectionEnergyCost",
            args: [1n]
          } as any).catch(() => null),
          publicClient.readContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "previewCollectionEnergyCost",
            args: [2n]
          } as any).catch(() => null),
          publicClient.readContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "previewCollectionResourceYield",
            args: [1]
          } as any).catch(() => null),
          publicClient.readContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "previewCollectionResourceYield",
            args: [2]
          } as any).catch(() => null)
        ]);
      const bankTradeBulkMaxLots = Math.max(1, Number(bankBulkMaxRaw ?? 48n));

      const emptyCost = () => ({ food: 0, wood: 0, stone: 0, ore: 0, energy: 0 });
      const nCollectEnergy = (raw: unknown, fallback: number) => {
        const n = typeof raw === "bigint" ? Number(raw) : Number(raw);
        return Number.isFinite(n) && n >= 0 ? n : fallback;
      };
      const actionCosts: ActionCosts | null =
        buildCostRaw && upgradeCostRaw
          ? {
              build: normalizeContractResources(buildCostRaw),
              upgrade: normalizeContractResources(upgradeCostRaw),
              discover: discoverCostRaw ? normalizeContractResources(discoverCostRaw) : emptyCost(),
              collectEnergyLevel1: nCollectEnergy(collectE1Raw, 10),
              collectEnergyLevel2: nCollectEnergy(collectE2Raw, 20),
              collectResourceYieldLevel1: nCollectEnergy(collectY1Raw, 30),
              collectResourceYieldLevel2: nCollectEnergy(collectY2Raw, 45)
            }
          : null;

      const craftedNum = Number(viewerCraftedGoods) || 0;

      const craftedGoodsByAddress: Record<string, number> = {};
      if (fetchAllPlayersEconomy) {
        Object.assign(craftedGoodsByAddress, craftedByAddr);
      } else if (status === "ended" && playerAddressList.length > 0) {
        const goodsResults = await Promise.all(
          playerAddressList.map((playerAddress) =>
            publicClient
              .readContract({
                address: gameCoreAddress,
                abi: gameCoreAbi,
                functionName: "getPlayerCraftedGoods",
                args: [BigInt(lobbyId), playerAddress as `0x${string}`]
              } as any)
              .then((g: unknown) => Number(g ?? 0))
              .catch(() => 0)
          )
        );
        playerAddressList.forEach((addr, i) => {
          craftedGoodsByAddress[addr.toLowerCase()] = goodsResults[i] ?? 0;
        });
      }

      const aliveFlags: boolean[] =
        playerAddressList.length > 0
          ? await Promise.all(
              playerAddressList.map((playerAddress) =>
                publicClient
                  .readContract({
                    address: gameCoreAddress,
                    abi: gameCoreAbi,
                    functionName: "isPlayerAlive",
                    args: [BigInt(lobbyId), playerAddress]
                  } as any)
                  .then((x: unknown) => Boolean(x))
                  .catch(() => true)
              )
            )
          : [];
      const players = playerAddressList.map((playerAddress, index) => {
        const isViewer = viewerAddress?.toLowerCase() === playerAddress.toLowerCase();
        const key = playerAddress.toLowerCase();
        const crafted =
          status === "ended"
            ? craftedGoodsByAddress[key] ?? 0
            : fetchAllPlayersEconomy
              ? craftedByAddr[key] ?? 0
              : isViewer
                ? craftedNum
                : 0;
        const resources = fetchAllPlayersEconomy
          ? resourcesByAddr[key] ?? emptyResources()
          : isViewer && playerResources
            ? normalizeContractResources(playerResources)
            : emptyResources();
        return buildPlayerState(playerAddress, resources, crafted, aliveFlags[index] !== false);
      });

      let inferredWinnerAddress: string | null = null;
      if (status === "ended" && !declaredWinnerAddress) {
        const aliveOnes = players.filter((p) => p.alive);
        if (aliveOnes.length === 1) {
          inferredWinnerAddress = aliveOnes[0].address;
        } else if (players.length > 0) {
          let best = players[0];
          for (const p of players) {
            if ((p.craftedGoods ?? 0) > (best.craftedGoods ?? 0)) best = p;
          }
          const maxCG = best?.craftedGoods ?? 0;
          if (maxCG > 0) {
            const top = players.filter((p) => (p.craftedGoods ?? 0) === maxCG);
            if (top.length === 1) inferredWinnerAddress = top[0].address;
          }
        }
      }

      let mapConfigState: { seed: string; radius: number } | null = null;
      const mapHexes: HexTile[] = [];
      const mapParsed = readMapConfigTuple(mapConfig);
      if (mapParsed) {
        const { seed, radius } = mapParsed;
        mapConfigState = { seed: seed.toString(), radius };
        const localLayout = generateLocalMap(seed, radius);
        const tileContracts = localLayout.map((tile) => ({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "getHexTile",
          args: [BigInt(lobbyId), tile.id]
        }));

        let tileStatesRaw: any[] | null = null;
        try {
          tileStatesRaw = await publicClient.multicall({
            contracts: tileContracts as any,
            allowFailure: true
          } as any);
        } catch {
          tileStatesRaw = null;
        }

        const tileStates = tileStatesRaw
          ? await Promise.all(
              tileStatesRaw.map(async (entry: any, index: number) => {
                if (entry?.status === "success") {
                  return entry.result;
                }

                try {
                  return await publicClient.readContract({
                    address: gameCoreAddress,
                    abi: gameCoreAbi,
                    functionName: "getHexTile",
                    args: [BigInt(lobbyId), localLayout[index].id]
                  } as any);
                } catch {
                  return null;
                }
              })
            )
          : await Promise.all(
              localLayout.map((tile) =>
                publicClient.readContract({
                  address: gameCoreAddress,
                  abi: gameCoreAbi,
                  functionName: "getHexTile",
                  args: [BigInt(lobbyId), tile.id]
                } as any).catch(() => null)
              )
            );

        localLayout.forEach((tile, index) => {
          const tileState = tileStates[index] as any;
          const parsed = parseHexTileContractResult(tileState);
          const override = localHexOverrides?.get(`${lobbyId}:${tile.id}`);
          const owner = override?.owner ?? normalizeOwner(parsed?.owner ?? tile.owner);
          const discoveredBy =
            override?.discoveredBy ??
            (parsed?.discovered || owner ? [owner ?? viewerAddress ?? ""] : []);
          const structureExists =
            override?.structure !== undefined ? override.structure !== null : Boolean(parsed?.structureExists);
          const structure = override?.structure !== undefined
            ? override.structure
            : structureExists && parsed
              ? {
                  level: Number(parsed.structureLevel) as 1 | 2,
                  collectedAtRound: parsed.collectedAtRound === 0 ? null : parsed.collectedAtRound,
                  builtAtRound: parsed.builtAtRound
                }
              : null;

          mapHexes.push({
            ...tile,
            owner,
            discoveredBy,
            structure
          });
        });
      }

      const viewerInRoster = Boolean(
        viewerAddress &&
          playerAddressList.some((a) => a.toLowerCase() === viewerAddress.toLowerCase())
      );
      const me =
        viewerInRoster && viewerAddress
          ? players.find((player) => player.address.toLowerCase() === viewerAddress.toLowerCase()) ?? null
          : null;

      let globalVotes: Array<{
        id: string;
        title: string;
        effectKey: string;
        yesVotes: number;
        noVotes: number;
        resolved: boolean;
        passed: boolean;
        closesAtRound: number;
      }> = [];
      try {
        const pCount = Number(
          await publicClient.readContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "getProposalCount",
            args: [BigInt(lobbyId)]
          } as any)
        );
        const maxP = Math.min(Number.isFinite(pCount) ? pCount : 0, 16);
        for (let i = 0; i < maxP; i++) {
          const pr = await publicClient
            .readContract({
              address: gameCoreAddress,
              abi: gameCoreAbi,
              functionName: "getProposal",
              args: [BigInt(lobbyId), BigInt(i)]
            } as any)
            .catch(() => null);
          if (!pr) continue;
          const [title, effectKey, yesVotes, noVotes, resolved, passed, closeRound] = pr as [
            string,
            string,
            bigint,
            bigint,
            boolean,
            boolean,
            bigint
          ];
          globalVotes.push({
            id: String(i),
            title,
            effectKey,
            yesVotes: Number(yesVotes),
            noVotes: Number(noVotes),
            resolved: Boolean(resolved),
            passed: Boolean(passed),
            closesAtRound: Number(closeRound)
          });
        }
      } catch {
        globalVotes = [];
      }

      let barterOffers: TradeOfferView[] = [];
      if (status === "running" || status === "ended" || status === "zero-round") {
        try {
          const countRaw = await publicClient.readContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "getTradeCount",
            args: [BigInt(lobbyId)]
          } as any);
          const count = Math.min(Math.max(0, Number(countRaw ?? 0)), 96);
          if (count > 0) {
            const tradeRows = await Promise.all(
              Array.from({ length: count }, (_, i) =>
                publicClient
                  .readContract({
                    address: gameCoreAddress,
                    abi: gameCoreAbi,
                    functionName: "getTrade",
                    args: [BigInt(lobbyId), BigInt(i)]
                  } as any)
                  .catch(() => null)
              )
            );
            tradeRows.forEach((raw, i) => {
              const row = parseGetTradeTuple(raw, i);
              if (row) barterOffers.push(row);
            });
          }
        } catch {
          barterOffers = [];
        }
      }

      return {
        lobby: {
          id: lobbyId,
          name,
          host,
          status,
          lobbyManagerStatus: lmStatus,
          declaredWinnerAddress,
          inferredWinnerAddress,
          viewerLobbyManagerTicket,
          viewerNeedsGameCoreJoin,
          rounds,
          players,
          me,
          mapHexes,
          activeEffects: [],
          globalVotes,
          barterOffers,
          logs: [],
          pendingEarthquake: null,
          prizePool: formatEther(prizePool)
        },
        mapConfig: mapConfigState,
        actionCosts,
        bankTradeBulkMaxLots
      };
    } catch (error) {
      console.error(`Failed to load lobby ${lobbyId} from chain`, error);
      return null;
    }
  }
}
