import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import { ArrowRightLeft, CheckCircle2, Hammer, Leaf, Sparkles, Vote } from "lucide-react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useAccount, useConnect, useDisconnect, usePublicClient, useWalletClient } from "wagmi";
import { createPublicClient, encodeFunctionData, formatEther, http, parseEther } from "viem";
import { entryPoint08Address } from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import abi from "./abi/localhost.json";
import { HexMap } from "./components/HexMap";
import { Lobby } from "./components/Lobby";
import { LobbyRoom } from "./components/LobbyRoom";
import { ResourcePanel } from "./components/ResourcePanel";
import { localGanache } from "./lib/wallet";
import {
  ActionCosts,
  formatCost,
  generateMapSeed,
  isAdjacentToOwnedHex,
  short,
  type HexTile,
  type LobbyState,
  type ResourceKey
} from "./lib/gameUtils";
import { LobbyRepository, type LobbySummary } from "./lib/lobbyRepository";

type ContractMeta = {
  contracts: {
    EntryPoint?: {
      address: `0x${string}`;
      abi: any[];
    };
    SimpleAccountFactory?: {
      address: `0x${string}`;
      abi: any[];
    };
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
    LobbySessionPaymaster?: {
      address: `0x${string}`;
      abi: any[];
    };
  };
};

const resourceKeys: ResourceKey[] = ["food", "wood", "stone", "ore", "energy"];
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const CREATE_LOBBY_SPONSOR = parseEther("0.01");
const BUY_TICKET_SPONSOR = parseEther("0.005");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
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

function AppPage() {
  const navigate = useNavigate();
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const [lobbies, setLobbies] = useState<LobbySummary[]>([]);
  const [activeLobby, setActiveLobby] = useState<LobbyState | null>(null);
  const [activeMapConfig, setActiveMapConfig] = useState<{ seed: string; radius: number } | null>(null);
  const [activeActionCosts, setActiveActionCosts] = useState<ActionCosts | null>(null);
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
  const { data: walletClient } = useWalletClient();

  const [contractsMeta, setContractsMeta] = useState<ContractMeta>(abi as ContractMeta);
  const contracts = contractsMeta;

  useEffect(() => {
    const tick = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(tick);
  }, []);

  const lobbyManagerAddress = contracts?.contracts?.LobbyManager?.address as `0x${string}` | undefined;
  const lobbyManagerAbi = contracts?.contracts?.LobbyManager?.abi;
  const gameCoreAddress = contracts?.contracts?.GameCore?.address as `0x${string}` | undefined;
  const gameCoreAbi = contracts?.contracts?.GameCore?.abi;

  const lobbyRepository = useMemo(
    () =>
      new LobbyRepository({
        publicClient,
        lobbyManagerAddress,
        lobbyManagerAbi,
        gameCoreAddress,
        gameCoreAbi,
        viewerAddress: address,
        localHexOverrides: localHexOverridesRef.current
      }),
    [address, gameCoreAbi, gameCoreAddress, lobbyManagerAbi, lobbyManagerAddress, publicClient]
  );

  const aaConfig = useMemo(() => {
    const rpcUrl = import.meta.env.VITE_RPC_URL || "http://localhost:8545";
    const bundlerUrl = import.meta.env.VITE_BUNDLER_URL || "";
    const fromDeployments = contracts?.contracts?.EntryPoint?.address as `0x${string}` | undefined;
    const fromEnv = import.meta.env.VITE_ENTRYPOINT_ADDRESS as `0x${string}` | undefined;
    const nz = (a: string | undefined) => Boolean(a && a.toLowerCase() !== ZERO_ADDRESS);
    /** Bundlers (e.g. Alto) detect EP v0.8 by address prefix 0x433708…; fall back to viem canonical. */
    const entryPointAddress =
      (nz(fromDeployments) ? fromDeployments : undefined) ||
      (nz(fromEnv) ? fromEnv : undefined) ||
      entryPoint08Address;

    const lobbySessionPaymasterAddress = contracts?.contracts?.LobbySessionPaymaster?.address as
      | `0x${string}`
      | undefined;

    return {
      rpcUrl,
      bundlerUrl,
      entryPointAddress,
      lobbySessionPaymasterAddress
    };
  }, [contracts]);

  const aaClientRef = useRef<{
    owner?: string;
    lobbyId?: string;
    paymaster?: `0x${string}` | "";
    client?: any;
    sessionAccountAddress?: `0x${string}`;
  }>({});

  const sessionStorageKey = (targetLobbyId: string, actor: string) =>
    `cryptocatan:session:${localGanache.id}:${targetLobbyId}:${actor.toLowerCase()}`;

  const isZeroAddress = (value: string) => value.toLowerCase() === ZERO_ADDRESS;

  const assertSessionAddress = (value: string | undefined | null) => {
    if (!value || isZeroAddress(value)) {
      throw new Error("Unable to derive a valid session key address");
    }
    return value as `0x${string}`;
  };

  const resolveSessionAccount = async (privateKey: `0x${string}`) => {
    const [{ toSimpleSmartAccount }] = await Promise.all([import("permissionless/accounts")]);
    const executionClient = createPublicClient({
      chain: localGanache,
      transport: http(aaConfig.rpcUrl)
    });

    const ownerAccount = privateKeyToAccount(privateKey);
    const factoryAddress = contracts?.contracts?.SimpleAccountFactory?.address as `0x${string}` | undefined;
    if (!factoryAddress || isZeroAddress(factoryAddress)) {
      throw new Error("SimpleAccountFactory address missing from deployments (required for EntryPoint v0.8).");
    }
    const factoryDerivedAddress = await executionClient
      .readContract({
        address: factoryAddress,
        abi: [
          {
            inputs: [
              { internalType: "address", name: "owner", type: "address" },
              { internalType: "uint256", name: "salt", type: "uint256" }
            ],
            name: "getAddress",
            outputs: [{ internalType: "address", name: "", type: "address" }],
            stateMutability: "view",
            type: "function"
          }
        ] as const,
        functionName: "getAddress",
        args: [ownerAccount.address as `0x${string}`, 0n]
      } as any)
      .catch(() => undefined);

    const nz = (a: string | undefined | null) => Boolean(a && a.toLowerCase() !== ZERO_ADDRESS);
    const entryPointAddr =
      (nz(contracts?.contracts?.EntryPoint?.address)
        ? (contracts!.contracts!.EntryPoint!.address as `0x${string}`)
        : undefined) ||
      (nz(import.meta.env.VITE_ENTRYPOINT_ADDRESS)
        ? (import.meta.env.VITE_ENTRYPOINT_ADDRESS as `0x${string}`)
        : undefined) ||
      entryPoint08Address;

    if (!entryPointAddr || !nz(entryPointAddr)) {
      throw new Error("EntryPoint address missing. Sync deployments or set VITE_ENTRYPOINT_ADDRESS.");
    }

    const smartAccount = await toSimpleSmartAccount({
      client: executionClient as any,
      owner: ownerAccount,
      factoryAddress,
      address: factoryDerivedAddress,
      entryPoint: {
        address: entryPointAddr,
        version: "0.8"
      }
    } as any);

    const smartAccountAddress = assertSessionAddress(
      (smartAccount.address as `0x${string}` | undefined) ??
        ((await smartAccount.getAddress()) as `0x${string}` | undefined)
    );

    return { smartAccount, smartAccountAddress };
  };

  const ensureLobbySession = async (targetLobbyId: string, actor: string) => {
    const storageKey = sessionStorageKey(targetLobbyId, actor);
    const existing = localStorage.getItem(storageKey);
    const privateKey = (existing as `0x${string}` | null) ?? (generatePrivateKey() as `0x${string}`);
    const resolved = await resolveSessionAccount(privateKey);
    const smartAccountAddress = resolved.smartAccountAddress;

    if (!existing) {
      localStorage.setItem(storageKey, privateKey);
    }

    return {
      privateKey,
      smartAccountAddress
    };
  };

  const getSmartAccountClient = async (targetLobbyId: string) => {
    if (!address) {
      throw new Error("Wallet not connected");
    }
    if (!aaConfig.bundlerUrl) {
      throw new Error("VITE_BUNDLER_URL is required for ERC-4337 mode");
    }

    const owner = address.toLowerCase();
    const paymasterTag = (aaConfig.lobbySessionPaymasterAddress &&
    !isZeroAddress(aaConfig.lobbySessionPaymasterAddress)
      ? aaConfig.lobbySessionPaymasterAddress
      : "") as `0x${string}` | "";

    if (
      aaClientRef.current.owner === owner &&
      aaClientRef.current.lobbyId === targetLobbyId &&
      aaClientRef.current.paymaster === paymasterTag &&
      aaClientRef.current.client
    ) {
      if (!aaClientRef.current.sessionAccountAddress) {
        const cachedAddress = (aaClientRef.current.client?.account?.address as `0x${string}` | undefined) ??
          ((await aaClientRef.current.client?.account?.getAddress?.()) as `0x${string}` | undefined);
        if (cachedAddress) {
          aaClientRef.current.sessionAccountAddress = assertSessionAddress(cachedAddress);
        }
      }
      return aaClientRef.current.client;
    }

    const [{ createSmartAccountClient }] = await Promise.all([
      import("permissionless"),
    ]);

    const storageKey = sessionStorageKey(targetLobbyId, owner);
    const sessionPrivateKey = localStorage.getItem(storageKey) as `0x${string}` | null;
    if (!sessionPrivateKey) {
      throw new Error("No session key for this lobby. Buy ticket/create lobby first.");
    }

    const executionClient = createPublicClient({
      chain: localGanache,
      transport: http(aaConfig.rpcUrl)
    });

    const { smartAccount: account } = await resolveSessionAccount(sessionPrivateKey);
    const sessionAccountAddress = ((account.address as `0x${string}` | undefined) ??
      ((await account.getAddress()) as `0x${string}` | undefined));

    // EntryPoint v0.8: bundlers expect `paymaster` + `paymasterData` (and gas limits filled during estimation).
    const paymasterMiddleware =
      paymasterTag !== ""
        ? {
            getPaymasterData: async () => ({
              paymaster: paymasterTag,
              paymasterData: "0x" as `0x${string}`
            }),
            getPaymasterStubData: async () => ({
              paymaster: paymasterTag,
              paymasterData: "0x" as `0x${string}`
            })
          }
        : undefined;

    const smartAccountClient = createSmartAccountClient({
      account,
      chain: localGanache,
      client: executionClient as any,
      bundlerTransport: http(aaConfig.bundlerUrl),
      ...(paymasterMiddleware ? { paymaster: paymasterMiddleware } : {}),
      userOperation: {
        estimateFeesPerGas: async () => {
          const fees = await executionClient.estimateFeesPerGas();
          return {
            maxFeePerGas: fees.maxFeePerGas ?? 0n,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n
          };
        }
      }
    } as any);

    aaClientRef.current = {
      owner,
      lobbyId: targetLobbyId,
      paymaster: paymasterTag,
      client: smartAccountClient,
      sessionAccountAddress: sessionAccountAddress ? assertSessionAddress(sessionAccountAddress) : undefined
    };
    return smartAccountClient;
  };

  const sendSessionTransaction = async ({
    lobbyId,
    contractAddress,
    contractAbi,
    functionName,
    args,
    value
  }: {
    lobbyId: string;
    contractAddress: `0x${string}`;
    contractAbi: any[];
    functionName: string;
    args?: any[];
    value?: bigint;
  }) => {
    const smartAccountClient = await getSmartAccountClient(lobbyId);
    const calldata = encodeFunctionData({
      abi: contractAbi as any,
      functionName,
      args: args ?? []
    } as any);

    const txHash = await smartAccountClient.sendTransaction({
      to: contractAddress,
      data: calldata,
      value: value ?? 0n
    });

    return txHash as `0x${string}`;
  };

  const syncLobbiesFromChain = async () => {
    const nextLobbies = await lobbyRepository.loadSummaries();
    setLobbies(nextLobbies);
    return nextLobbies;
  };

  const syncActiveLobbyFromChain = async (lobbyId: string) => {
    const hydrated = await lobbyRepository.loadLobbyState(lobbyId);

    if (!hydrated) return null;

    setActiveMapConfig(hydrated.mapConfig);
    setActiveActionCosts(hydrated.actionCosts);
    setActiveLobby(hydrated.lobby);
    return hydrated.lobby;
  };

  useEffect(() => {
    if (!lobbyId) {
      setActiveLobby(null);
      setActiveMapConfig(null);
      setActiveActionCosts(null);
      setSelectedHex(undefined);
      return;
    }

    syncActiveLobbyFromChain(lobbyId).catch((error) => {
      console.error(`Failed to open lobby ${lobbyId}`, error);
    });
  }, [lobbyId, lobbyRepository]);

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
  }, [address, gameCoreAbi, gameCoreAddress, lobbyManagerAbi, lobbyManagerAddress, publicClient, lobbyRepository]);

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
  }, [address, gameCoreAbi, gameCoreAddress, lobbyId, lobbyManagerAbi, lobbyManagerAddress, publicClient, lobbyRepository]);

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
      if (!publicClient || !walletClient) {
        throw new Error("Wallet client unavailable");
      }

      const mapSeed = generateMapSeed();
      const lobbyName = `Season ${Date.now().toString().slice(-4)}`;
      const lobbyCountBefore = await publicClient.readContract({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "getLobbyCount"
      } as any);

      const createdLobbyIdHint = Number(lobbyCountBefore) + 1;
      const session = await ensureLobbySession(String(createdLobbyIdHint), address);
      const sessionKey = assertSessionAddress(session.smartAccountAddress);

      const createTx = await walletClient.writeContract({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "createLobbyWithSession",
        account: address,
        args: [
          lobbyName,
          sessionKey,
          CREATE_LOBBY_SPONSOR,
          BigInt(SESSION_TTL_SECONDS),
          CREATE_LOBBY_SPONSOR
        ],
        value: parseEther("0.05")
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

      if (createdLobbyId !== createdLobbyIdHint) {
        const actor = address.toLowerCase();
        const fromKey = sessionStorageKey(String(createdLobbyIdHint), actor);
        const toKey = sessionStorageKey(String(createdLobbyId), actor);
        const existingSessionPk = localStorage.getItem(fromKey);
        if (existingSessionPk) {
          localStorage.setItem(toKey, existingSessionPk);
          localStorage.removeItem(fromKey);
        }
      }

      if (BigInt(lobbyCountAfter as bigint) <= BigInt(lobbyCountBefore as bigint)) {
        throw new Error("Unable to determine created lobby id");
      }

      const bootstrapTx = await sendSessionTransaction({
        lobbyId: String(createdLobbyId),
        contractAddress: gameCoreAddress,
        contractAbi: gameCoreAbi,
        functionName: "bootstrapLobby",
        args: [BigInt(createdLobbyId), address, mapSeed, BigInt(radius)]
      });

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
      if (!walletClient) {
        throw new Error("Wallet client unavailable");
      }

      const session = await ensureLobbySession(activeLobby.id, address);
      const sessionKey = assertSessionAddress(session.smartAccountAddress);
      await walletClient.writeContract({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "buyTicketWithSession",
        account: address,
        args: [
          BigInt(activeLobby.id),
          sessionKey,
          BUY_TICKET_SPONSOR,
          BigInt(SESSION_TTL_SECONDS),
          BUY_TICKET_SPONSOR
        ],
        value: parseEther("0.05")
      } as any);

      await sendSessionTransaction({
        lobbyId: activeLobby.id,
        contractAddress: gameCoreAddress,
        contractAbi: gameCoreAbi,
        functionName: "joinLobby",
        args: [BigInt(activeLobby.id)]
      });
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
      if (!publicClient) {
        throw new Error("RPC client unavailable");
      }

      const lobbyStartTx = await sendSessionTransaction({
        lobbyId: activeLobby.id,
        contractAddress: lobbyManagerAddress,
        contractAbi: lobbyManagerAbi,
        functionName: "startGame",
        args: [BigInt(activeLobby.id)]
      });
      const lobbyStartReceipt = await publicClient.waitForTransactionReceipt({ hash: lobbyStartTx as `0x${string}` });
      if (lobbyStartReceipt.status !== "success") {
        throw new Error("LobbyManager.startGame transaction reverted");
      }

      const gameStartTx = await sendSessionTransaction({
        lobbyId: activeLobby.id,
        contractAddress: gameCoreAddress,
        contractAbi: gameCoreAbi,
        functionName: "startGame",
        args: [BigInt(activeLobby.id), BigInt(300), BigInt(300)]
      });
      const gameStartReceipt = await publicClient.waitForTransactionReceipt({ hash: gameStartTx as `0x${string}` });
      if (gameStartReceipt.status !== "success") {
        throw new Error("GameCore.startGame transaction reverted");
      }

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
      await sendSessionTransaction({
        lobbyId: activeLobby.id,
        contractAddress: lobbyManagerAddress,
        contractAbi: lobbyManagerAbi,
        functionName: "cancelLobby",
        args: [activeLobby.id]
      });
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

        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "pickStartingHex",
          args: [lobbyId, hex.id, BigInt(hex.q), BigInt(hex.r)]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:discover") {
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "discoverHex",
          args: [lobbyId, payload.hexId]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:build") {
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "buildStructure",
          args: [lobbyId, payload.hexId ?? selectedForDetails?.id]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:upgrade") {
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "upgradeStructure",
          args: [lobbyId, payload.hexId ?? selectedForDetails?.id]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:destroy") {
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "destroyStructure",
          args: [lobbyId, payload.hexId ?? selectedForDetails?.id]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:collect") {
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "collect",
          args: [lobbyId, payload.hexId ?? selectedForDetails?.id, BigInt(payload.amount || 10)]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "barter:create") {
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "createTrade",
          args: [lobbyId, payload.to || "0x0000000000000000000000000000000000000000", payload.offer, payload.request, BigInt(2)]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "barter:accept") {
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "acceptTrade",
          args: [lobbyId, BigInt(payload.barterId)]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "vote:create") {
        const effectKey = payload.effect?.special === "__END_ROUND__"
          ? "__END_ROUND__"
          : JSON.stringify(payload.effect || {});
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "createProposal",
          args: [lobbyId, payload.title, effectKey, BigInt(activeLobby.rounds.index + 3)]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "vote:cast") {
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "vote",
          args: [lobbyId, BigInt(payload.voteId), Boolean(payload.support)]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:end-round") {
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "advanceRound",
          args: [lobbyId, BigInt(300)]
        });
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
  const discoverCost = activeActionCosts?.discover ?? null;
  const buildCost = activeActionCosts?.build ?? null;
  const upgradeCost = activeActionCosts?.upgrade ?? null;
  const canDiscoverHere = Boolean(selectedForDetails && activeLobby?.status === "running" && !selectedForDetails.owner && isAdjacentToOwnedHex(activeLobby?.mapHexes ?? [], selectedForDetails, address));
  const canBuildHere = Boolean(selectedForDetails && isSelectedMine && !hasStructure);
  const canUpgradeHere = Boolean(selectedForDetails && isSelectedMine && selectedForDetails.structure?.level === 1);
  const canDestroyHere = Boolean(selectedForDetails && isSelectedMine && selectedForDetails.structure);
  const canCollectHere = Boolean(selectedForDetails && isSelectedMine && selectedForDetails.structure);
  const selectedActionCost = canDiscoverHere
    ? discoverCost && formatCost(discoverCost)
    : canBuildHere
      ? buildCost && formatCost(buildCost)
      : canUpgradeHere
      ? upgradeCost && formatCost(upgradeCost)
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
            {selectedActionCost ? `Cost: ${selectedActionCost}` : activeActionCosts ? "Select a hex to see costs and actions." : "Loading costs from chain..."}
          </p>
          {selectedForDetails && !selectedForDetails.owner && (
            <button onClick={() => action("game:discover", { hexId: activeActionHexId })} disabled={!canDiscoverHere || !activeActionHexId}>
              <Sparkles size={16} /> Discover / Claim ({discoverCost ? formatCost(discoverCost) : "loading..."})
            </button>
          )}
          {canBuildHere && (
            <button onClick={() => action("game:build", { hexId: activeActionHexId })} disabled={!activeActionHexId}>
              <Hammer size={16} /> Build lvl1 ({buildCost ? formatCost(buildCost) : "loading..."})
            </button>
          )}
          {canUpgradeHere && (
            <button onClick={() => action("game:upgrade", { hexId: activeActionHexId })} disabled={!activeActionHexId}>
              <Leaf size={16} /> Upgrade lvl2 ({upgradeCost ? formatCost(upgradeCost) : "loading..."})
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
