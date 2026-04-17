import { formatEther } from "viem";

import type { HexTile, LobbyState } from "../types";
import {
  buildPlayerState,
  emptyResources,
  gameStatusToLabel,
  generateLocalMap,
  managerStatusToLabel,
  normalizeOwner,
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

type HexOverride = {
  owner: string;
  discoveredBy: string[];
  structure: LobbyState["mapHexes"][number]["structure"];
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

  async loadSummaries(): Promise<LobbySummary[]> {
    const { publicClient, lobbyManagerAddress, lobbyManagerAbi } = this.context;
    if (!publicClient || !lobbyManagerAddress || !lobbyManagerAbi) return [];

    let lobbyCount = 0;
    try {
      lobbyCount = Number(await publicClient.readContract({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "getLobbyCount"
      } as any));
    } catch (error) {
      console.error("Failed to load lobbies from chain. ABI/address might be out of sync.", error);
      return [];
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

    return summaries.filter((summary): summary is LobbySummary => summary !== null);
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
      const gameStatus = roundData ? Number((roundData as any)[3]) : null;
      const rounds = roundData
        ? {
            index: Number((roundData as any)[0]),
            startedAt: Number((roundData as any)[4] ?? 0) || null,
            durationSeconds: Number((roundData as any)[5] ?? 0) || null,
            nextRoundAt: Number((roundData as any)[1] ?? 0) || null,
            zeroRoundEndsAt: Number((roundData as any)[2] ?? 0) || null
          }
        : {
            index: 0,
            startedAt: null,
            durationSeconds: null,
            nextRoundAt: null,
            zeroRoundEndsAt: null
          };

      const status = gameStatus !== null ? gameStatusToLabel(gameStatus) : "waiting";

      const playerResources = viewerAddress
        ? await publicClient.readContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "getPlayerResources",
            args: [BigInt(lobbyId), viewerAddress]
          } as any).catch(() => null)
        : null;
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

      const actionCosts: ActionCosts | null = buildCostRaw && upgradeCostRaw && discoverCostRaw
        ? {
            build: {
              food: Number((buildCostRaw as any)[0]),
              wood: Number((buildCostRaw as any)[1]),
              stone: Number((buildCostRaw as any)[2]),
              ore: Number((buildCostRaw as any)[3]),
              energy: Number((buildCostRaw as any)[4])
            },
            upgrade: {
              food: Number((upgradeCostRaw as any)[0]),
              wood: Number((upgradeCostRaw as any)[1]),
              stone: Number((upgradeCostRaw as any)[2]),
              ore: Number((upgradeCostRaw as any)[3]),
              energy: Number((upgradeCostRaw as any)[4])
            },
            discover: {
              food: Number((discoverCostRaw as any)[0]),
              wood: Number((discoverCostRaw as any)[1]),
              stone: Number((discoverCostRaw as any)[2]),
              ore: Number((discoverCostRaw as any)[3]),
              energy: Number((discoverCostRaw as any)[4])
            }
          }
        : null;

      const players = playerAddressList.map((playerAddress) => {
        const isViewer = viewerAddress?.toLowerCase() === playerAddress.toLowerCase();
        return buildPlayerState(
          playerAddress,
          isViewer && playerResources
            ? {
                food: Number((playerResources as any)[0]),
                wood: Number((playerResources as any)[1]),
                stone: Number((playerResources as any)[2]),
                ore: Number((playerResources as any)[3]),
                energy: Number((playerResources as any)[4])
              }
            : emptyResources()
        );
      });

      let mapConfigState: { seed: string; radius: number } | null = null;
      const mapHexes: HexTile[] = [];
      if (mapConfig) {
        const seed = BigInt((mapConfig as any)[0]);
        const radius = Number((mapConfig as any)[1]);
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
          const override = localHexOverrides?.get(`${lobbyId}:${tile.id}`);
          const owner = override?.owner ?? normalizeOwner(tileState?.[3] ?? tile.owner);
          const discoveredBy = override?.discoveredBy ?? (tileState?.[4] || owner ? [owner ?? viewerAddress ?? ""] : []);
          const structureExists = override?.structure !== undefined ? override.structure !== null : Boolean(tileState?.[5]);
          const structure = override?.structure !== undefined
            ? override.structure
            : structureExists
              ? {
                  level: Number(tileState?.[6]) as 1 | 2,
                  collectedAtRound: Number(tileState?.[8]) === 0 ? null : Number(tileState?.[8]),
                  builtAtRound: Number(tileState?.[7])
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

      return {
        lobby: {
          id: lobbyId,
          name,
          host,
          status,
          rounds,
          pollution: 0,
          players,
          me,
          mapHexes,
          activeEffects: [],
          globalVotes: [],
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
