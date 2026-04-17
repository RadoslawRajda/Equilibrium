import { formatEther } from "viem";

import type { HexTile, LobbyState } from "../types";
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

export type LobbySummary = {
  id: string;
  name: string;
  status: string;
  playerCount: number;
  host: string;
  prizePool: string;
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
    const { publicClient, lobbyManagerAddress, lobbyManagerAbi } = this.context;
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

          const [host, name, , status, prizePool, playerCount] = lobby as [string, string, bigint, bigint, bigint, bigint, string];
          return {
            id: String(lobbyId),
            name,
            status: managerStatusToLabel(Number(status)),
            playerCount: Number(playerCount),
            host,
            prizePool: formatEther(prizePool)
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
  ): Promise<{ lobby: LobbyState; mapConfig: { seed: string; radius: number } | null; actionCosts: ActionCosts | null } | null> {
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

      const [host, name, , , prizePool] = lobbyData as [string, string, bigint, bigint, bigint, bigint, string];
      const playerAddressList = playerAddresses as string[];
      const roundParsed = readLobbyRoundTuple(roundData);
      const gameStatus = roundParsed ? roundParsed.status : null;
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

      const status = gameStatus !== null ? gameStatusToLabel(gameStatus) : "waiting";

      const [playerResources, viewerCraftedGoods] = await Promise.all([
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
      const [buildCostRaw, upgradeCostRaw, discoverCostRaw] = await Promise.all([
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
          : null
      ]);

      const emptyCost = () => ({ food: 0, wood: 0, stone: 0, ore: 0, energy: 0 });
      const actionCosts: ActionCosts | null =
        buildCostRaw && upgradeCostRaw
          ? {
              build: normalizeContractResources(buildCostRaw),
              upgrade: normalizeContractResources(upgradeCostRaw),
              discover: discoverCostRaw ? normalizeContractResources(discoverCostRaw) : emptyCost()
            }
          : null;

      const craftedNum = Number(viewerCraftedGoods) || 0;
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
        return buildPlayerState(
          playerAddress,
          isViewer && playerResources ? normalizeContractResources(playerResources) : emptyResources(),
          isViewer ? craftedNum : 0,
          aliveFlags[index] !== false
        );
      });

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

      const me = players.find((player) => viewerAddress && player.address.toLowerCase() === viewerAddress.toLowerCase()) ?? null;

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

      return {
        lobby: {
          id: lobbyId,
          name,
          host,
          status,
          rounds,
          players,
          me,
          mapHexes,
          activeEffects: [],
          globalVotes,
          barterOffers: [],
          logs: [],
          pendingEarthquake: null,
          prizePool: formatEther(prizePool)
        },
        mapConfig: mapConfigState,
        actionCosts
      };
    } catch (error) {
      console.error(`Failed to load lobby ${lobbyId} from chain`, error);
      return null;
    }
  }
}
