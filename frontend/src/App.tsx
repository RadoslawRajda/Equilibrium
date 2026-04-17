import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import { ArrowRightLeft, CheckCircle2, Hammer, Leaf, Sparkles, Vote } from "lucide-react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useAccount, useConnect, useDisconnect, usePublicClient, useWriteContract } from "wagmi";
import { encodePacked, formatEther, keccak256, parseEther } from "viem";
import deployments from "./deployments/localhost.json";
import { HexMap } from "./components/HexMap";
import { Lobby } from "./components/Lobby";
import { LobbyRoom } from "./components/LobbyRoom";
import { ResourcePanel } from "./components/ResourcePanel";
import type { HexTile, LobbyState, ResourceKey } from "./types";

type LobbySummary = {
  id: string;
  name: string;
  status: string;
  playerCount: number;
  host: string;
  prizePool: string;
};

type ContractMeta = {
  contracts: {
    LobbyManager: {
      address: `0x${string}`;
      abi: any[];
    };
    GameCore: {
      address: `0x${string}`;
      abi: any[];
    };
    AIGameMaster: {
      address: `0x${string}`;
      abi: any[];
    };
  };
};

const short = (address?: string) => (address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "?");
const BIOME_NAMES = ["Plains", "Forest", "Mountains", "Desert"] as const;
const resourceKeys: ResourceKey[] = ["food", "wood", "stone", "ore", "energy"];
const generateMapSeed = () => {
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  const entropy = values.reduce((accumulator, value) => (accumulator << 32n) | BigInt(value), 0n);
  return BigInt(keccak256(encodePacked(["uint256", "uint256"], [entropy, BigInt(Date.now())])));
};
const hexId = (q: number, r: number) => `${q},${r}`;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const hexDirections = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1]
] as const;
const biomeForCoord = (seed: bigint, q: number, r: number): HexTile["biome"] => {
  const hash = keccak256(encodePacked(["uint256", "int256", "int256"], [seed, BigInt(q), BigInt(r)]));
  const biomeIndex = Number(BigInt(hash) % 4n);
  return BIOME_NAMES[biomeIndex];
};
const generateLocalMap = (seed: bigint, radius: number): HexTile[] => {
  const hexes: HexTile[] = [];
  for (let q = -radius; q <= radius; q += 1) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r += 1) {
      hexes.push({
        id: hexId(q, r),
        q,
        r,
        biome: biomeForCoord(seed, q, r),
        owner: null,
        discoveredBy: [],
        structure: null
      });
    }
  }
  return hexes;
};
const isAdjacent = (a: HexTile, b: HexTile) => hexDirections.some(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
const isAdjacentToOwnedHex = (hexes: HexTile[], target: HexTile, owner?: string) => {
  if (!owner) return false;
  return hexes.some((hex) => hex.owner?.toLowerCase() === owner.toLowerCase() && isAdjacent(hex, target));
};
const getExploreCost = (ownedCount: number) => {
  let resourceCost = 40;
  for (let index = 1; index < ownedCount; index += 1) {
    resourceCost = Math.round(resourceCost * 1.5);
  }

  return { food: resourceCost, wood: resourceCost, stone: resourceCost, ore: resourceCost };
};
const formatCost = (cost: { food: number; wood?: number; stone?: number; ore?: number }) => {
  const parts = [
    `food ${cost.food}`,
    cost.wood !== undefined ? `wood ${cost.wood}` : null,
    cost.stone !== undefined ? `stone ${cost.stone}` : null,
    cost.ore !== undefined ? `ore ${cost.ore}` : null
  ].filter(Boolean);

  return parts.join(" / ");
};
const BUILD_COST = { food: 10, wood: 10, stone: 10 };
const UPGRADE_COST = { food: 30, stone: 30, ore: 30 };

const managerStatusToLabel = (status: number) => {
  switch (status) {
    case 0:
      return "open";
    case 1:
      return "active";
    case 2:
      return "completed";
    case 3:
      return "cancelled";
    default:
      return "open";
  }
};

const gameStatusToLabel = (status: number) => {
  switch (status) {
    case 1:
      return "zero-round";
    case 2:
      return "running";
    default:
      return "waiting";
  }
};

const normalizeOwner = (value?: string | null) => (value && value !== zeroAddress ? value : null);

const emptyResources = () => ({ food: 0, wood: 0, stone: 0, ore: 0, energy: 0 });

const buildPlayerState = (address: string, resources = emptyResources()) => ({
  address,
  nickname: short(address),
  hasTicket: true,
  bankruptRounds: 0,
  alive: true,
  resources
});

const VOTE_PRESETS = [
  {
    id: "foodBoost",
    label: "Food subsidies",
    title: "Food subsidies",
    effect: { multipliers: { food: 1.2 } }
  },
  {
    id: "woodBoost",
    label: "Wood recovery",
    title: "Wood recovery",
    effect: { multipliers: { wood: 1.2 } }
  },
  {
    id: "energyBoost",
    label: "Energy support",
    title: "Energy support",
    effect: { multipliers: { energy: 1.2 } }
  },
  {
    id: "cleanup",
    label: "Pollution cleanup",
    title: "Pollution cleanup",
    effect: { multipliers: { food: 1.1, wood: 1.1, stone: 1.1, ore: 1.1 } }
  }
] as const;

type ChainReadContext = {
  publicClient: any;
  lobbyManagerAddress?: `0x${string}`;
  lobbyManagerAbi?: any[];
  gameCoreAddress?: `0x${string}`;
  gameCoreAbi?: any[];
  viewerAddress?: string;
  localHexOverrides?: Map<string, { owner: string; discoveredBy: string[]; structure: LobbyState["mapHexes"][number]["structure"] }>;
};

async function loadLobbySummariesFromChain({ publicClient, lobbyManagerAddress, lobbyManagerAbi }: ChainReadContext): Promise<LobbySummary[]> {
  if (!publicClient || !lobbyManagerAddress || !lobbyManagerAbi) return [];

  const lobbyCount = Number(await publicClient.readContract({
    address: lobbyManagerAddress,
    abi: lobbyManagerAbi,
    functionName: "getLobbyCount"
  } as any));

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

async function loadLobbyStateFromChain(
  lobbyId: string,
  context: ChainReadContext
): Promise<{ lobby: LobbyState; mapConfig: { seed: string; radius: number } | null } | null> {
  const { publicClient, lobbyManagerAddress, lobbyManagerAbi, gameCoreAddress, gameCoreAbi, viewerAddress, localHexOverrides } = context;

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

    const [host, name, , managerStatus, prizePool] = lobbyData as [string, string, bigint, bigint, bigint, bigint, string];
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

    const players = playerAddressList.map((playerAddress) => {
      const isViewer = viewerAddress?.toLowerCase() === playerAddress.toLowerCase();
      return buildPlayerState(playerAddress, isViewer && playerResources
        ? {
            food: Number((playerResources as any)[0]),
            wood: Number((playerResources as any)[1]),
            stone: Number((playerResources as any)[2]),
            ore: Number((playerResources as any)[3]),
            energy: Number((playerResources as any)[4])
          }
        : emptyResources());
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
      mapConfig: mapConfigState
    };
  } catch (error) {
    console.error(`Failed to load lobby ${lobbyId} from chain`, error);
    return null;
  }
}

function AppPage() {
  const navigate = useNavigate();
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const [lobbies, setLobbies] = useState<LobbySummary[]>([]);
  const [activeLobby, setActiveLobby] = useState<LobbyState | null>(null);
  const [activeMapConfig, setActiveMapConfig] = useState<{ seed: string; radius: number } | null>(null);
  const [selectedHex, setSelectedHex] = useState<string | undefined>();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const [isCreatingLobby, setIsCreatingLobby] = useState(false);
  const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));

  const [tradeOfferDraft, setTradeOfferDraft] = useState<Record<ResourceKey, number>>({
    food: 0,
    wood: 0,
    stone: 0,
    ore: 0,
    energy: 0
  });
  const [tradeRequestDraft, setTradeRequestDraft] = useState<Record<ResourceKey, number>>({
    food: 0,
    wood: 0,
    stone: 0,
    ore: 0,
    energy: 0
  });
  const lobbySnapshotRef = useRef<LobbyState | null>(null);
  const localHexOverridesRef = useRef(new Map<string, { owner: string; discoveredBy: string[]; structure: LobbyState["mapHexes"][number]["structure"] }>());
  const mapLayoutCache = useRef(new Map<string, HexTile[]>());

  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const contracts = deployments as ContractMeta;

  useEffect(() => {
    const tick = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(tick);
  }, []);

  const lobbyManagerAddress = contracts?.contracts?.LobbyManager?.address as `0x${string}` | undefined;
  const lobbyManagerAbi = contracts?.contracts?.LobbyManager?.abi;
  const gameCoreAddress = contracts?.contracts?.GameCore?.address as `0x${string}` | undefined;
  const gameCoreAbi = contracts?.contracts?.GameCore?.abi;

  const syncLobbiesFromChain = async () => {
    const nextLobbies = await loadLobbySummariesFromChain({
      publicClient,
      lobbyManagerAddress,
      lobbyManagerAbi
    });
    setLobbies(nextLobbies);
    return nextLobbies;
  };

  const syncActiveLobbyFromChain = async (lobbyId: string) => {
    const hydrated = await loadLobbyStateFromChain(lobbyId, {
      publicClient,
      lobbyManagerAddress,
      lobbyManagerAbi,
      gameCoreAddress,
      gameCoreAbi,
      viewerAddress: address,
      localHexOverrides: localHexOverridesRef.current
    });

    if (!hydrated) return null;

    setActiveMapConfig(hydrated.mapConfig);
    setActiveLobby(hydrated.lobby);
    return hydrated.lobby;
  };

  useEffect(() => {
    if (!lobbyId) {
      setActiveLobby(null);
      setActiveMapConfig(null);
      setSelectedHex(undefined);
      return;
    }

    syncActiveLobbyFromChain(lobbyId).catch((error) => {
      console.error(`Failed to open lobby ${lobbyId}`, error);
    });
  }, [address, gameCoreAbi, gameCoreAddress, lobbyId, lobbyManagerAbi, lobbyManagerAddress, publicClient]);

  const myTurnInZeroRound = useMemo(() => {
    if (!activeLobby || activeLobby.status !== "zero-round" || !address) return false;
    const picked = activeLobby.mapHexes.some((h) => h.owner?.toLowerCase() === address.toLowerCase());
    return !picked;
  }, [activeLobby, address]);

  const isLobbyHost = Boolean(activeLobby && address && activeLobby.host.toLowerCase() === address.toLowerCase());
  const hasLobbyTicket = Boolean(activeLobby?.me?.hasTicket || activeLobby?.players?.some((player) => player.address.toLowerCase() === address?.toLowerCase()));
  const canStartLobby = Boolean(activeLobby && activeLobby.status === "waiting" && isLobbyHost && activeLobby.players.length >= 1);

  const projectedRound = useMemo(() => {
    if (!activeLobby) {
      return { index: 0, deadlineSec: null as number | null };
    }

    if (activeLobby.status === "zero-round") {
      return {
        index: 0,
        deadlineSec: activeLobby.rounds.zeroRoundEndsAt
      };
    }

    if (activeLobby.status !== "running") {
      return {
        index: activeLobby.rounds.index,
        deadlineSec: null as number | null
      };
    }

    const startedAt = activeLobby.rounds.startedAt;
    const duration = activeLobby.rounds.durationSeconds;
    if (!startedAt || !duration || duration <= 0) {
      return {
        index: activeLobby.rounds.index,
        deadlineSec: activeLobby.rounds.nextRoundAt
      };
    }

    const elapsed = Math.max(0, nowSec - startedAt);
    const extraRounds = Math.floor(elapsed / duration);
    const projectedIndex = activeLobby.rounds.index + extraRounds;
    const projectedDeadline = startedAt + (extraRounds + 1) * duration;

    return {
      index: projectedIndex,
      deadlineSec: projectedDeadline
    };
  }, [activeLobby, nowSec]);

  const roundCountdown = projectedRound.deadlineSec
    ? Math.max(0, projectedRound.deadlineSec - nowSec)
    : null;

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      if (!publicClient || !lobbyManagerAddress || !lobbyManagerAbi) return;
      try {
        if (cancelled) return;
        await syncLobbiesFromChain();
      } catch (e) {
        console.error("Failed to load lobbies from chain", e);
      }
    };

    sync();
    const interval = setInterval(sync, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, gameCoreAbi, gameCoreAddress, lobbyManagerAbi, lobbyManagerAddress, publicClient]);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      if (!lobbyId || !publicClient || !lobbyManagerAddress || !lobbyManagerAbi || !gameCoreAddress || !gameCoreAbi) return;
      try {
        const hydrated = await syncActiveLobbyFromChain(lobbyId);
        if (cancelled || !hydrated) return;
      } catch (e) {
        console.error(`Failed to load lobby ${lobbyId} from chain`, e);
      }
    };

    sync();
    const interval = setInterval(sync, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, gameCoreAbi, gameCoreAddress, lobbyId, lobbyManagerAbi, lobbyManagerAddress, publicClient]);

  useEffect(() => {
    if (!activeLobby || !address) return;

    const ownedHexId = activeLobby.mapHexes.find((hex) => hex.owner?.toLowerCase() === address.toLowerCase())?.id;
    if (!ownedHexId) return;

    setSelectedHex((current) => {
      if (current && activeLobby.mapHexes.some((hex) => hex.id === current)) {
        return current;
      }
      return ownedHexId;
    });
  }, [activeLobby, address]);

  const formatCountdown = (secondsLeft: number | null) => {
    if (secondsLeft === null) return "--:--";
    const totalSeconds = Math.max(0, Math.floor(secondsLeft));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  // Tworzenie lobbies: kontrakt LobbyManager
  const onCreateLobby = async (radius: number) => {
    if (!address || !lobbyManagerAddress || !lobbyManagerAbi || !gameCoreAddress || !gameCoreAbi) return;
    setError("");
    setIsCreatingLobby(true);
    try {
      if (!publicClient) {
        throw new Error("Wallet client unavailable");
      }

      const mapSeed = generateMapSeed();
      const lobbyName = `Season ${Date.now().toString().slice(-4)}`;
      const lobbyCountBefore = await publicClient.readContract({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "getLobbyCount"
      } as any);
      const createTx = await writeContractAsync({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "createLobby",
        account: address,
        args: [lobbyName],
        value: parseEther("0.05") // TICKET_PRICE
      } as any);

      const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTx as `0x${string}` });
      if (createReceipt.status !== "success") {
        throw new Error("createLobby transaction reverted");
      }

      const lobbyCountAfter = await publicClient.readContract({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "getLobbyCount"
      } as any);
      const createdLobbyId = Number(lobbyCountAfter);

      if (BigInt(lobbyCountAfter as bigint) <= BigInt(lobbyCountBefore as bigint)) {
        throw new Error("Unable to determine created lobby id");
      }

      const bootstrapTx = await writeContractAsync({
        address: gameCoreAddress,
        abi: gameCoreAbi,
        functionName: "bootstrapLobby",
        account: address,
        args: [BigInt(createdLobbyId), address, mapSeed, BigInt(radius)]
      } as any);

      const bootstrapReceipt = await publicClient.waitForTransactionReceipt({
        hash: bootstrapTx as `0x${string}`
      });
      if (bootstrapReceipt.status !== "success") {
        throw new Error("bootstrapLobby transaction reverted");
      }

      const mapConfigAfterBootstrap = await publicClient.readContract({
        address: gameCoreAddress,
        abi: gameCoreAbi,
        functionName: "getMapConfig",
        args: [BigInt(createdLobbyId)]
      } as any);
      const seedAfterBootstrap = BigInt((mapConfigAfterBootstrap as any)[0]);
      const radiusAfterBootstrap = Number((mapConfigAfterBootstrap as any)[1]);
      setActiveMapConfig({ seed: seedAfterBootstrap.toString(), radius: radiusAfterBootstrap });
      if (radiusAfterBootstrap < 1) {
        throw new Error("bootstrapLobby applied but map radius is still 0 on-chain");
      }

      await syncLobbiesFromChain();
      navigate(`/game/${createdLobbyId}`);
      await syncActiveLobbyFromChain(String(createdLobbyId));
      confetti({ particleCount: 100, spread: 75, origin: { y: 0.75 } });
    } catch (e: any) {
      setError(e.message);
      console.error("Failed to create lobby", e);
    } finally {
      setIsCreatingLobby(false);
    }
  };

  // Ticket purchase and lobby access are handled through the LobbyManager contract
  const onOpenLobby = async (lobbyId: string) => {
    if (!address) return;
    setError("");
    try {
      navigate(`/game/${lobbyId}`);
      const loaded = await syncActiveLobbyFromChain(lobbyId);
      if (!loaded) {
        throw new Error("Unable to load lobby from chain");
      }
    } catch (e: any) {
      setError(e.message);
      console.error("Failed to open lobby", e);
    }
  };

  const onBuyTicket = async () => {
    if (!address || !lobbyManagerAddress || !lobbyManagerAbi || !gameCoreAddress || !gameCoreAbi || !activeLobby) return;
    setError("");
    try {
      await writeContractAsync({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "buyTicket",
        account: address,
        args: [activeLobby.id],
        value: parseEther("0.05")
      } as any);
      await writeContractAsync({
        address: gameCoreAddress,
        abi: gameCoreAbi,
        functionName: "joinLobby",
        account: address,
        args: [BigInt(activeLobby.id)]
      } as any);
      confetti({ particleCount: 100, spread: 75, origin: { y: 0.75 } });
      await syncActiveLobbyFromChain(activeLobby.id);
      await syncLobbiesFromChain();
    } catch (e: any) {
      setError(e.message);
      console.error("Failed to buy ticket", e);
    }
  };

  const onStartLobby = async () => {
    if (!address || !lobbyManagerAddress || !lobbyManagerAbi || !gameCoreAddress || !gameCoreAbi || !activeLobby) return;
    setError("");
    try {
      await writeContractAsync({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "startGame",
        account: address,
        args: [activeLobby.id]
      } as any);
      await writeContractAsync({
        address: gameCoreAddress,
        abi: gameCoreAbi,
        functionName: "startGame",
        account: address,
        args: [BigInt(activeLobby.id), BigInt(300), BigInt(300)]
      } as any);
      const loaded = await syncActiveLobbyFromChain(activeLobby.id);
      if (!loaded) {
        throw new Error("Unable to refresh lobby from chain after start");
      }
      await syncLobbiesFromChain();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const onCancelLobby = async () => {
    if (!address || !lobbyManagerAddress || !lobbyManagerAbi || !activeLobby) return;
    setError("");
    try {
      await writeContractAsync({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "cancelLobby",
        account: address,
        args: [activeLobby.id]
      } as any);
      navigate("/");
      setActiveLobby(null);
      setSelectedHex(undefined);
      await syncLobbiesFromChain();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const action = async (event: string, payload: any, confettiOnSuccess = false) => {
    if (!activeLobby || !address || !gameCoreAddress || !gameCoreAbi) return;
    if (pendingAction) return;
    setError("");
    try {
      const lobbyId = BigInt(activeLobby.id);
      if (event === "game:pick-start") {
        const hex = activeLobby.mapHexes.find((tile) => tile.id === payload.hexId);
        if (!hex) throw new Error("Hex not found");
        setPendingAction(event);
        lobbySnapshotRef.current = activeLobby;
        localHexOverridesRef.current.set(`${activeLobby.id}:${hex.id}`, {
          owner: address,
          discoveredBy: [address],
          structure: hex.structure
        });
        setActiveLobby((current) => {
          if (!current) return current;
          const nextStatus = current.players.length <= 1 ? "running" : current.status;
          return {
            ...current,
            status: nextStatus,
            rounds: current.players.length <= 1
              ? { ...current.rounds, index: Math.max(1, current.rounds.index), startedAt: Math.floor(Date.now() / 1000) }
              : current.rounds,
            mapHexes: current.mapHexes.map((tile) =>
              tile.id === hex.id
                ? { ...tile, owner: address, discovered: true }
                : tile
            )
          };
        });

        const txHash = await writeContractAsync({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "pickStartingHex",
          account: address,
          args: [lobbyId, hex.id, BigInt(hex.q), BigInt(hex.r)]
        } as any);
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:discover") {
        const txHash = await writeContractAsync({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "discoverHex",
          account: address,
          args: [lobbyId, payload.hexId]
        } as any);
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:build") {
        const txHash = await writeContractAsync({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "buildStructure",
          account: address,
          args: [lobbyId, payload.hexId ?? selectedForDetails?.id]
        } as any);
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:upgrade") {
        const txHash = await writeContractAsync({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "upgradeStructure",
          account: address,
          args: [lobbyId, payload.hexId ?? selectedForDetails?.id]
        } as any);
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:destroy") {
        const txHash = await writeContractAsync({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "destroyStructure",
          account: address,
          args: [lobbyId, payload.hexId ?? selectedForDetails?.id]
        } as any);
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:collect") {
        const txHash = await writeContractAsync({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "collect",
          account: address,
          args: [lobbyId, payload.hexId ?? selectedForDetails?.id, BigInt(payload.amount || 10)]
        } as any);
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "barter:create") {
        const txHash = await writeContractAsync({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "createTrade",
          account: address,
          args: [lobbyId, payload.to || "0x0000000000000000000000000000000000000000", payload.offer, payload.request, BigInt(2)]
        } as any);
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "barter:accept") {
        const txHash = await writeContractAsync({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "acceptTrade",
          account: address,
          args: [lobbyId, BigInt(payload.barterId)]
        } as any);
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "vote:create") {
        const effectKey = payload.effect?.special === "__END_ROUND__"
          ? "__END_ROUND__"
          : JSON.stringify(payload.effect || {});
        const txHash = await writeContractAsync({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "createProposal",
          account: address,
          args: [lobbyId, payload.title, effectKey, BigInt(activeLobby.rounds.index + 3)]
        } as any);
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "vote:cast") {
        const txHash = await writeContractAsync({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "vote",
          account: address,
          args: [lobbyId, BigInt(payload.voteId), Boolean(payload.support)]
        } as any);
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:end-round") {
        const txHash = await writeContractAsync({
          address: gameCoreAddress,
          abi: gameCoreAbi,
          functionName: "advanceRound",
          account: address,
          args: [lobbyId, BigInt(300)]
        } as any);
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      }

      const refreshed = await syncActiveLobbyFromChain(activeLobby.id);
      if (!refreshed) {
        throw new Error("Unable to refresh lobby from chain");
      }
      await syncLobbiesFromChain();

      if (confettiOnSuccess) {
        confetti({ particleCount: 70, spread: 45, origin: { y: 0.7 } });
      }
    } catch (e: any) {
      if (event === "game:pick-start" && lobbySnapshotRef.current) {
        setActiveLobby(lobbySnapshotRef.current);
        localHexOverridesRef.current.delete(`${lobbySnapshotRef.current.id}:${payload.hexId}`);
      }
      setError(e.message);
    } finally {
      lobbySnapshotRef.current = null;
      setPendingAction(null);
    }
  };

  const selected = activeLobby?.mapHexes.find((h) => h.id === selectedHex);
  const ownedHexId = activeLobby?.mapHexes.find((hex) => hex.owner?.toLowerCase() === address?.toLowerCase())?.id;
  const highlightedHex = selectedHex ?? ownedHexId;
  const highlighted = activeLobby?.mapHexes.find((h) => h.id === highlightedHex);
  const selectedForDetails = highlighted ?? selected;
  const activeActionHexId = selectedForDetails?.id ?? highlightedHex;
  const selectedOwner = selectedForDetails?.owner ? activeLobby?.players.find((player) => player.address.toLowerCase() === selectedForDetails.owner?.toLowerCase()) : null;
  const isSelectedMine = Boolean(selectedForDetails?.owner && address && selectedForDetails.owner.toLowerCase() === address.toLowerCase());
  const hasStructure = Boolean(selectedForDetails?.structure);
  const ownedHexCount = activeLobby?.mapHexes.filter((hex) => hex.owner?.toLowerCase() === address?.toLowerCase()).length ?? 0;
  const exploreCost = getExploreCost(ownedHexCount || 1);
  const canDiscoverHere = Boolean(selectedForDetails && activeLobby?.status === "running" && !selectedForDetails.owner && isAdjacentToOwnedHex(activeLobby?.mapHexes ?? [], selectedForDetails, address));
  const canBuildHere = Boolean(selectedForDetails && isSelectedMine && !hasStructure);
  const canUpgradeHere = Boolean(selectedForDetails && isSelectedMine && selectedForDetails.structure?.level === 1);
  const canDestroyHere = Boolean(selectedForDetails && isSelectedMine && selectedForDetails.structure);
  const canCollectHere = Boolean(selectedForDetails && isSelectedMine && selectedForDetails.structure);
  const selectedActionCost = canDiscoverHere
    ? formatCost(exploreCost)
    : canBuildHere
      ? formatCost(BUILD_COST)
      : canUpgradeHere
        ? formatCost(UPGRADE_COST)
        : null;

  const walletConnectConnector = connectors.find((c) => c.id === "injected") || connectors[0];

  if (!isConnected) {
    return (
      <div className="connect-screen">
        <h1>Equilibrium PoC</h1>
        <p>Connect your wallet to enter the lobby flow.</p>
        <div className="connect-buttons">
          <button onClick={() => walletConnectConnector && connect({ connector: walletConnectConnector })}>
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  if (lobbyId && !activeLobby) {
    return (
      <div className="connect-screen">
        <h1>Loading game...</h1>
        <p>Reading lobby state from blockchain.</p>
      </div>
    );
  }

  if (!activeLobby) {
    return (
      <Lobby
        address={address}
        lobbies={lobbies}
        creating={isCreatingLobby}
        onCreate={onCreateLobby}
        onOpen={onOpenLobby}
        onDisconnect={() => disconnect()}
      />
    );
  }

  if (activeLobby.status === "waiting") {
    return (
      <LobbyRoom
        address={address}
        lobby={activeLobby}
        isHost={isLobbyHost}
        hasTicket={hasLobbyTicket}
        canStart={canStartLobby}
        onBuyTicket={onBuyTicket}
        onStart={onStartLobby}
        onCancel={onCancelLobby}
        onBack={() => navigate("/")}
        onDisconnect={() => disconnect()}
      />
    );
  }

  return (
    <div className="game-shell">
      <ResourcePanel me={activeLobby.me} pollution={activeLobby.pollution} round={activeLobby.rounds.index} effects={activeLobby.activeEffects} />

      <main className="map-main">
        <div className="top-hud">
          <div>
            <h2>{activeLobby.name}</h2>
            <p>{activeLobby.status === "zero-round" ? "Round 0: choose your starting hex" : `Round ${projectedRound.index}`}</p>
          </div>
          <div className="top-hud-meta">
            <span className="round-timer">{projectedRound.deadlineSec ? `Time left ${formatCountdown(roundCountdown)}` : "Waiting for round"}</span>
            {activeMapConfig && <span className="round-timer">Map r={activeMapConfig.radius} seed={activeMapConfig.seed.slice(0, 10)}...</span>}
          </div>
          <button onClick={() => disconnect()}>Disconnect wallet</button>
        </div>

        <HexMap
          hexes={activeLobby.mapHexes}
          myAddress={address}
          selectedHex={highlightedHex}
          earthquakeTargets={activeLobby.pendingEarthquake?.targets || []}
          onHexClick={(id) => {
            if (pendingAction) return;
            if (activeLobby.status === "zero-round") {
              const alreadyPicked = activeLobby.mapHexes.some((tile) => tile.owner?.toLowerCase() === address?.toLowerCase());
              if (alreadyPicked) {
                setSelectedHex(id);
                return;
              }
            }
            setSelectedHex(id);
            if (activeLobby.status === "zero-round" && myTurnInZeroRound) {
              action("game:pick-start", { hexId: id }, true);
            }
          }}
        />

        {error && <p className="error-banner">{error}</p>}
      </main>

      <aside className="panel right-panel">
        <h3>Selected Hex</h3>
        <p className="selected-text">Selected: {selectedForDetails?.id ?? "none"}</p>

        {selectedForDetails ? (
          <div className="action-group hex-details">
            <p>Biome: <strong>{selectedForDetails.biome}</strong></p>
            <p>Owner: <strong>{selectedOwner?.nickname ?? short(selectedForDetails.owner ?? undefined) ?? "none"}</strong></p>
            <p>Structure: <strong>{selectedForDetails.structure ? `L${selectedForDetails.structure.level}` : "none"}</strong></p>
          </div>
        ) : null}

        <div className="action-group">
          <h4>Players</h4>
          {activeLobby.players.map((player) => (
            <div key={player.address} className="player-row">
              <div>
                <strong>{player.nickname}</strong>
                <p>{short(player.address)} {player.address.toLowerCase() === activeLobby.host.toLowerCase() ? "• host" : ""}</p>
              </div>
              <span className="player-tag">member</span>
            </div>
          ))}
        </div>

        <div className="action-group">
          <h4>Hex Actions</h4>
          <p className="selected-text">
            {selectedActionCost ? `Cost: ${selectedActionCost}` : "Select a hex to see costs and actions."}
          </p>
          {selectedForDetails && !selectedForDetails.owner && (
            <button onClick={() => action("game:discover", { hexId: activeActionHexId })} disabled={!canDiscoverHere || !activeActionHexId}>
              <Sparkles size={16} /> Discover / Claim ({formatCost(exploreCost)})
            </button>
          )}
          {canBuildHere && (
            <button onClick={() => action("game:build", { hexId: activeActionHexId })} disabled={!activeActionHexId}>
              <Hammer size={16} /> Build lvl1 ({formatCost(BUILD_COST)})
            </button>
          )}
          {canUpgradeHere && (
            <button onClick={() => action("game:upgrade", { hexId: activeActionHexId })} disabled={!activeActionHexId}>
              <Leaf size={16} /> Upgrade lvl2 ({formatCost(UPGRADE_COST)})
            </button>
          )}
          {canDestroyHere && (
            <button onClick={() => action("game:destroy", { hexId: activeActionHexId }, true)} disabled={!activeActionHexId}>
              <CheckCircle2 size={16} /> Destroy structure
            </button>
          )}
          {canCollectHere && (
            <button onClick={() => action("game:collect", { hexId: activeActionHexId }, true)} disabled={!activeActionHexId}>
              <CheckCircle2 size={16} /> Collect resources
            </button>
          )}
          {!selectedForDetails && <p className="selected-text">Select a hex to see actions.</p>}
        </div>

        <div className="action-group">
          <h4>Trade</h4>
          <p className="selected-text">Broadcast a trade offer. Anyone can accept if they can pay the request.</p>
          <div className="trade-grid">
            <div>
              <strong>You offer</strong>
              {resourceKeys.map((key) => (
                <div key={`offer-${key}`} className="trade-line">
                  <label>{key}</label>
                  <input type="number" min={0} value={tradeOfferDraft[key]} onChange={(e) => setTradeOfferDraft((draft) => ({ ...draft, [key]: Number(e.target.value) }))} />
                </div>
              ))}
            </div>
            <div>
              <strong>You want</strong>
              {resourceKeys.map((key) => (
                <div key={`request-${key}`} className="trade-line">
                  <label>{key}</label>
                  <input type="number" min={0} value={tradeRequestDraft[key]} onChange={(e) => setTradeRequestDraft((draft) => ({ ...draft, [key]: Number(e.target.value) }))} />
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={async () => {
              try {
                await action("barter:create", {
                  from: address,
                  offer: Object.fromEntries(Object.entries(tradeOfferDraft).filter(([, value]) => value > 0)),
                  request: Object.fromEntries(Object.entries(tradeRequestDraft).filter(([, value]) => value > 0))
                });
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            <ArrowRightLeft size={16} /> Send trade
          </button>

          {activeLobby.barterOffers
            .filter((b: any) => b.status === "pending")
            .slice(0, 4)
            .map((barter: any) => (
              <motion.button
                key={barter.id}
                whileHover={{ scale: 1.03 }}
                onClick={async () => {
                  try {
                    await action("barter:accept", {
                      lobbyId: activeLobby.id,
                      barterId: barter.id,
                      by: address
                    });
                  } catch (e: any) {
                    setError(e.message);
                  }
                }}
              >
                Accept trade from {short(barter.from)}
              </motion.button>
            ))}
        </div>

        <div className="action-group">
          <h4>Votes</h4>
          <div className="vote-preset-grid">
            {VOTE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={async () => {
                  try {
                    await action("vote:create", {
                      lobbyId: activeLobby.id,
                      by: address,
                      title: preset.title,
                      effect: preset.effect
                    });
                  } catch (e: any) {
                    setError(e.message);
                  }
                }}
              >
                <Vote size={16} /> {preset.label}
              </button>
            ))}
          </div>

          {activeLobby.globalVotes.slice(0, 3).map((vote: any) => (
            <div key={vote.id} className="vote-item">
              <p>{vote.title}</p>
              <p className="selected-text">Closes after round {vote.closesAtRound}</p>
              <div className="vote-buttons">
                <button onClick={() => action("vote:cast", { lobbyId: activeLobby.id, voteId: vote.id, by: address, support: true })}>Yes</button>
                <button onClick={() => action("vote:cast", { lobbyId: activeLobby.id, voteId: vote.id, by: address, support: false })}>No</button>
              </div>
            </div>
          ))}
        </div>

        <div className="action-group">
          <h4>Lobby</h4>
          <button onClick={() => action("vote:create", { title: "End round early", effect: { special: "__END_ROUND__" } })} disabled={activeLobby.status !== "running"}>
            Propose end round
          </button>
          <p>Status: {activeLobby.status}</p>
        </div>

        <div className="log-list">
          {activeLobby.logs.slice(0, 8).map((log) => (
            <p key={log.id}>{new Date(log.timestamp).toLocaleTimeString()} • {log.text}</p>
          ))}
        </div>
      </aside>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppPage />} />
      <Route path="/game/:lobbyId" element={<AppPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
