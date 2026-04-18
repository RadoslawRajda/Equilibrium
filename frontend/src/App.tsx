import { mapGameError } from './lib/errorMapper';
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import {
  ArrowRightLeft,
  ArrowRight,
  BatteryCharging,
  Check,
  CheckCircle2,
  ChevronDown,
  Gem,
  Factory,
  Flag,
  Hammer,
  Landmark,
  Leaf,
  Pickaxe,
  Settings,
  Sparkles,
  TreePine,
  Vote,
  Wheat,
  Navigation
} from "lucide-react";
import { PkoLogoIcon } from "./utils/helpers/customIcons";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useAccount, useConnect, useDisconnect, usePublicClient, useWalletClient } from "wagmi";
import { createPublicClient, encodeFunctionData, formatEther, http, parseEther } from "viem";
import { entryPoint08Address } from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import abi from "./abi/localhost.json";
import { HexMap } from "./components/HexMap";
import { HexMap2D } from "./components/HexMap2D";
import { Lobby } from "./components/Lobby";
import { LobbyRoom } from "./components/LobbyRoom";
import { SpectatorPlayersPanel } from "./components/SpectatorPlayersPanel";
import { SpectatorTradeFeed } from "./components/SpectatorTradeFeed";
import { SpectatorOnChainTrades } from "./components/SpectatorOnChainTrades";
import { TradeOffersModal } from "./components/TradeOffersModal";
import { localGanache } from "./lib/wallet";
import {
  ActionCosts,
  formatCost,
  generateMapSeed,
  isAdjacentToOwnedHex,
  normalizeContractResources,
  readDefaultLobbyPhaseDurations,
  short,
  type HexTile,
  type LobbyState,
  type ResourceKey
} from "./lib/gameUtils";
import { LobbyRepository, type LobbySummary } from "./lib/lobbyRepository";
import { projectRunningRoundClock } from "./lib/roundClock";
import {
  FALLBACK_ENERGY_REGEN_PER_ROUND,
  FALLBACK_LOBBY_RUNNING_ROUND_SECONDS,
  FALLBACK_MAX_ENERGY,
  FALLBACK_LOBBY_ZERO_ROUND_SECONDS
} from "./lib/chainGameDefaults";
import { fetchLobbyTradeActivityLog, type TradeFeedItem } from "./lib/tradeActivityFeed";
import { colorFromAddress } from "./utils/helpers/converters";
import * as Select from '@radix-ui/react-select';
import * as Accordion from '@radix-ui/react-accordion';
import { IkoPhone } from "./components/IkoPhone";
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
    ERC8004PlayerAgentRegistry?: {
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
type AssistantChatMessage = {
  role: "user" | "assistant";
  content: string;
};
const resourceKeys: ResourceKey[] = ["food", "wood", "stone", "ore", "energy"];
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Fallback if TICKET_PRICE cannot be read from chain (must match LobbyManager.TICKET_PRICE) */
const FALLBACK_TICKET_PRICE_WEI = parseEther("1");
/** Matches GameConfig.craftAlloyCost — used if previewCraftAlloyCost read fails */
const FALLBACK_CRAFT_ALLOY_COST = { food: 3, wood: 3, stone: 3, ore: 3, energy: 0 };
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
type MapRendererMode = "3d" | "2d";
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
    id: "alloyRush",
    label: "Alloy rush",
    title: "Alloy rush",
    effect: { multipliers: { ore: 1.15, energy: 1.15 } }
  }
] as const;

const LIMITED_VOTING_UI = true;

/** GameCore `Resources` tuple — all five keys required for ABI encoding (sparse objects cause BigInt(undefined)). */
function tradeResourcesTuple(value: Record<string, unknown> | null | undefined): {
  food: bigint;
  wood: bigint;
  stone: bigint;
  ore: bigint;
  energy: bigint;
} {
  const n = (key: ResourceKey) =>
    BigInt(Math.max(0, Math.floor(Number((value ?? {})[key] ?? 0))));
  return {
    food: n("food"),
    wood: n("wood"),
    stone: n("stone"),
    ore: n("ore"),
    energy: n("energy")
  };
}

/** `listAgents` return: viem often decodes Solidity structs as `[agent, controller, name]` tuples. */
function parseListAgentsRows(raw: unknown): { agent: string; controller: string; name: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { agent: string; controller: string; name: string }[] = [];
  const asAddr = (v: unknown) => (typeof v === "string" ? v : String(v ?? ""));
  for (const row of raw) {
    if (Array.isArray(row) && row.length >= 3) {
      const agent = asAddr(row[0]);
      const controller = asAddr(row[1]);
      const name = asAddr(row[2]);
      if (/^0x[a-fA-F0-9]{40}$/.test(controller)) {
        out.push({ agent, controller, name });
      }
      continue;
    }
    if (row && typeof row === "object") {
      const o = row as Record<string, unknown>;
      const agent = asAddr(o.agent);
      const controller = asAddr(o.controller);
      const name = asAddr(o.name);
      if (/^0x[a-fA-F0-9]{40}$/.test(controller)) {
        out.push({ agent, controller, name });
      }
    }
  }
  return out;
}

/** LobbyManager.COMPLETED / CANCELLED — matches `_splitSessionSponsorToPlayerBalances` per-player wei. */
const LM_STATUS_COMPLETED = 2;
const LM_STATUS_CANCELLED = 3;

function pendingSponsorShareForRosterWei(args: {
  lobbyStatus: number;
  sessionPoolWei: bigint;
  roster: readonly string[];
  viewer: string;
}): bigint {
  const { lobbyStatus, sessionPoolWei, roster, viewer } = args;
  if (lobbyStatus !== LM_STATUS_COMPLETED && lobbyStatus !== LM_STATUS_CANCELLED) return 0n;
  if (sessionPoolWei === 0n || roster.length === 0) return 0n;
  const v = viewer.toLowerCase();
  const idx = roster.findIndex((p) => p.toLowerCase() === v);
  if (idx < 0) return 0n;
  const n = BigInt(roster.length);
  const per = sessionPoolWei / n;
  const rem = sessionPoolWei % n;
  return per + (BigInt(idx) < rem ? 1n : 0n);
}

function AppPage() {
  const navigate = useNavigate();
  const { lobbyId } = useParams<{ lobbyId: string }>();
  const [lobbies, setLobbies] = useState<LobbySummary[]>([]);
  const [chainDeployHint, setChainDeployHint] = useState<string | null>(null);
  const [activeLobby, setActiveLobby] = useState<LobbyState | null>(null);
  const [activeMapConfig, setActiveMapConfig] = useState<{ seed: string; radius: number } | null>(null);
  const [activeActionCosts, setActiveActionCosts] = useState<ActionCosts | null>(null);
  const [selectedHex, setSelectedHex] = useState<string | undefined>();
  const [selectionClearedByUser, setSelectionClearedByUser] = useState(false);
  const [mapRenderer, setMapRenderer] = useState<MapRendererMode>(() => {
    const fromEnv = String(import.meta.env.VITE_MAP_RENDERER || "").toLowerCase();
    const envDefault: MapRendererMode = fromEnv === "2d" ? "2d" : "3d";
    if (typeof window === "undefined") return envDefault;
    const saved = window.localStorage.getItem("cryptocatan:map-renderer");
    return saved === "2d" || saved === "3d" ? saved : envDefault;
  });
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const [mapErrorMessage, setMapErrorMessage] = useState("");
  const [mapErrorPhase, setMapErrorPhase] = useState<"hidden" | "visible" | "fading">("hidden");
  const [isCreatingLobby, setIsCreatingLobby] = useState(false);
  const [startingLobby, setStartingLobby] = useState(false);
  const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));
  const [isIkoOpen, setIsIkoOpen] = useState(false);

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
  const RESOURCE_MAP = [
  { label: "food", icon: Wheat, color: "#ffd369" },
  { label: "wood", icon: TreePine, color: "#5bff9d" },
  { label: "stone", icon: Pickaxe, color: "#96b7ff" },
  { label: "ore", icon: Gem, color: "#ff9f6e" },
  { label: "energy", icon: BatteryCharging, color: "#56f0ff" }
];
  const [bankSellKind, setBankSellKind] = useState<string>("food");
  const [bankBuyKind, setBankBuyKind] = useState<string>("wood");
  const [bankBulkLots, setBankBulkLots] = useState(1);
  const [bankTradeBulkMaxLots, setBankTradeBulkMaxLots] = useState(48);
  const [craftCostHint, setCraftCostHint] = useState<string | null>(null);
  const [victoryAlloyTarget, setVictoryAlloyTarget] = useState<number | null>(null);
  /** From `GameCore.getDefaultLobbyPhaseDurations` (GameConfig); used for `startGame` / advance fallback. */
  const [chainLobbyPhaseDefaults, setChainLobbyPhaseDefaults] = useState<{
    zeroRoundSeconds: number;
    runningRoundSeconds: number;
  } | null>(null);
  const [ticketPriceWei, setTicketPriceWei] = useState<bigint | null>(null);
  /**
   * Estimated ETH this wallet can pull via LobbyManager after a claim on the **current** `/game/:lobbyId` route:
   * `playerBalance(address)` plus, when the lobby is COMPLETED/CANCELLED, this wallet's share of any unsplit
   * `sessionSponsorPool` (same math as on-chain split — enables the Claim button before `distribute` runs).
   */
  const [lmWithdrawableWei, setLmWithdrawableWei] = useState<bigint | null>(null);
  const [registryAgents, setRegistryAgents] = useState<
    { address: string; name: string; identity?: string }[]
  >([]);
  const [chainRegistryAgentsError, setChainRegistryAgentsError] = useState<string | null>(null);
  const [spectatorTradeFeed, setSpectatorTradeFeed] = useState<TradeFeedItem[]>([]);
  const [spectatorTradeFeedLoading, setSpectatorTradeFeedLoading] = useState(false);
  const [tradeOffersModalOpen, setTradeOffersModalOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantChatMessage[]>([]);
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [assistantSending, setAssistantSending] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const lobbySnapshotRef = useRef<LobbyState | null>(null);
  const localHexOverridesRef = useRef(
    new Map<string, { owner: string; discoveredBy: string[]; structure?: LobbyState["mapHexes"][number]["structure"] }>()
  );
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("cryptocatan:map-renderer", mapRenderer);
  }, [mapRenderer]);

  const lobbyManagerAddress = contracts?.contracts?.LobbyManager?.address as `0x${string}` | undefined;
  const lobbyManagerAbi = contracts?.contracts?.LobbyManager?.abi;
  const gameCoreAddress = contracts?.contracts?.GameCore?.address as `0x${string}` | undefined;
  const gameCoreAbi = contracts?.contracts?.GameCore?.abi;
  const erc8004RegistryAddress = contracts?.contracts?.ERC8004PlayerAgentRegistry?.address as
    | `0x${string}`
    | undefined;
  const erc8004RegistryAbi = contracts?.contracts?.ERC8004PlayerAgentRegistry?.abi;
  const rpcDisplay = import.meta.env.VITE_RPC_URL || "http://localhost:8545";
  const assistantApiUrl = (import.meta.env.VITE_ASSISTANT_API_URL || "http://localhost:4060").trim();

  useEffect(() => {
    setAssistantMessages([]);
    setAssistantPrompt("");
    setAssistantError(null);
  }, [activeLobby?.id]);

  useEffect(() => {
    if (!publicClient || !lobbyManagerAddress || !lobbyManagerAbi) {
      setTicketPriceWei(null);
      return;
    }
    let cancelled = false;
    publicClient
      .readContract({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "TICKET_PRICE"
      } as any)
      .then((v) => {
        if (!cancelled) setTicketPriceWei(v as bigint);
      })
      .catch(() => {
        if (!cancelled) setTicketPriceWei(null);
      });
    return () => {
      cancelled = true;
    };
  }, [publicClient, lobbyManagerAddress, lobbyManagerAbi]);

  useEffect(() => {
    if (!publicClient || !gameCoreAddress || !gameCoreAbi) {
      setCraftCostHint(null);
      setVictoryAlloyTarget(null);
      setChainLobbyPhaseDefaults(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [costRaw, threshold, phaseDefaults] = await Promise.all([
          publicClient.readContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "previewCraftAlloyCost",
            args: []
          } as any),
          publicClient.readContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "getVictoryGoodsThreshold",
            args: []
          } as any),
          readDefaultLobbyPhaseDurations(publicClient, gameCoreAddress, gameCoreAbi)
        ]);
        if (cancelled) return;
        // viem returns Solidity struct Resources as { food, wood, ... }, not a tuple array
        setCraftCostHint(formatCost(normalizeContractResources(costRaw ?? FALLBACK_CRAFT_ALLOY_COST)));
        setVictoryAlloyTarget(threshold != null ? Number(threshold as bigint) : 5);
        setChainLobbyPhaseDefaults(phaseDefaults);
      } catch {
        if (!cancelled) {
          setCraftCostHint(formatCost(FALLBACK_CRAFT_ALLOY_COST));
          setVictoryAlloyTarget(5);
          setChainLobbyPhaseDefaults(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicClient, gameCoreAddress, gameCoreAbi, activeLobby?.id]);

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

  const effectiveTicketWei = ticketPriceWei ?? FALLBACK_TICKET_PRICE_WEI;
  const ticketPriceLabel = formatEther(effectiveTicketWei);

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

  /** When set, bootstrap/join/start after ticket use session UserOps (bundler + paymaster) instead of EOA MetaMask txs. */
  const useAaForLobbyFollowups = Boolean(aaConfig.bundlerUrl?.trim());

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
    const result = await lobbyRepository.loadSummaries();
    setLobbies(result.lobbies);
    if (result.lobbyManagerMissing) {
      const lm = lobbyManagerAddress ?? "(unknown)";
      setChainDeployHint(
        `No bytecode at LobbyManager ${lm} on ${rpcDisplay}. Usually: Anvil was reset but abi/localhost.json still has old addresses, or the file was never synced from contracts/deployments. Fix: (1) cd contracts && npm run deploy:local (same RPC as VITE_RPC_URL; Hardhat uses GANACHE_RPC_URL or http://127.0.0.1:8545), (2) from repo root: node frontend/scripts/sync-abi.mjs, (3) restart the dev server.`
      );
    } else if (result.readFailed) {
      setChainDeployHint(
        `getLobbyCount failed on ${rpcDisplay} — ABI may not match this chain. Redeploy: cd contracts && npm run deploy:local, then node frontend/scripts/sync-abi.mjs`
      );
    } else {
      setChainDeployHint(null);
    }
    return result.lobbies;
  };

  const syncActiveLobbyFromChain = async (lobbyId: string) => {
    const hydrated = await lobbyRepository.loadLobbyState(lobbyId);

    if (!hydrated) {
      const deployed = await lobbyRepository.isLobbyManagerDeployed();
      if (!deployed) {
        const lm = lobbyManagerAddress ?? "(unknown)";
        setChainDeployHint(
          `No contract at ${lm} on ${rpcDisplay}. Run cd contracts && npm run deploy:local, then node frontend/scripts/sync-abi.mjs`
        );
      }
      return null;
    }

    setChainDeployHint(null);
    setActiveMapConfig(hydrated.mapConfig);
    setActiveActionCosts(hydrated.actionCosts);
    setBankTradeBulkMaxLots(hydrated.bankTradeBulkMaxLots);
    setActiveLobby(hydrated.lobby);
    return hydrated.lobby;
  };

  useEffect(() => {
    if (!lobbyId) {
      setActiveLobby(null);
      setActiveMapConfig(null);
      setActiveActionCosts(null);
      setBankTradeBulkMaxLots(48);
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
  const hasLobbyTicket = Boolean(
    activeLobby?.viewerLobbyManagerTicket ||
      activeLobby?.me?.hasTicket ||
      activeLobby?.players?.some((player) => player.address.toLowerCase() === address?.toLowerCase())
  );
  const canStartLobby = Boolean(activeLobby && activeLobby.status === "waiting" && isLobbyHost && activeLobby.players.length >= 1);

  /** Wallet not in GameCore roster (no ticket / not joined) — read-only map + player sidebar. */
  const isSpectator = useMemo(
    () =>
      Boolean(
        activeLobby &&
          (activeLobby.status === "zero-round" || activeLobby.status === "running") &&
          activeLobby.me === null
      ),
    [activeLobby]
  );

  useEffect(() => {
    if (!isSpectator || !activeLobby || !publicClient || !gameCoreAddress || !gameCoreAbi) {
      setSpectatorTradeFeed([]);
      return;
    }
    if (activeLobby.status !== "running" && activeLobby.status !== "zero-round" && activeLobby.status !== "ended") {
      setSpectatorTradeFeed([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setSpectatorTradeFeedLoading(true);
      try {
        const items = await fetchLobbyTradeActivityLog(
          publicClient,
          gameCoreAddress,
          gameCoreAbi,
          BigInt(activeLobby.id),
          0n
        );
        if (!cancelled) setSpectatorTradeFeed(items);
      } catch {
        if (!cancelled) setSpectatorTradeFeed([]);
      } finally {
        if (!cancelled) setSpectatorTradeFeedLoading(false);
      }
    };
    void run();
    const iv = setInterval(run, 10_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [isSpectator, activeLobby?.id, activeLobby?.status, publicClient, gameCoreAddress, gameCoreAbi]);

  /**
   * Running: wall-clock projection matches `GameCore._syncRoundFromTimestamp` (chain round + duration + `roundEndsAt`).
   * Countdown ticks down locally to `nextDeadlineSec`; when past `roundEndsAt`, logical round jumps like the contract will on next tx.
   */
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

    const R = activeLobby.rounds.index;
    const E = activeLobby.rounds.nextRoundAt ?? 0;
    const D = activeLobby.rounds.durationSeconds ?? 0;
    if (D <= 0 || E <= 0) {
      return { index: R, deadlineSec: E > 0 ? E : null };
    }
    const { logicalRoundIndex, nextDeadlineSec } = projectRunningRoundClock({
      chainRoundIndex: R,
      roundEndsAt: E,
      durationSeconds: D,
      nowSec
    });
    return {
      index: logicalRoundIndex,
      deadlineSec: nextDeadlineSec
    };
  }, [activeLobby, nowSec]);

  const roundCountdown = projectedRound.deadlineSec
    ? Math.max(0, projectedRound.deadlineSec - nowSec)
    : null;

  const isRoundTimerDanger =
    projectedRound.deadlineSec !== null &&
    roundCountdown !== null &&
    roundCountdown > 0 &&
    roundCountdown <= 30;

  const projectedPlayers = useMemo(() => {
    if (!activeLobby) return [];
    if (activeLobby.status !== "running") return activeLobby.players;
    const roundsElapsed = Math.max(0, projectedRound.index - activeLobby.rounds.index);
    if (roundsElapsed === 0) return activeLobby.players;
    const energyMax = activeActionCosts?.energyMax ?? FALLBACK_MAX_ENERGY;
    const regenPerRound = activeActionCosts?.energyRegenPerRound ?? FALLBACK_ENERGY_REGEN_PER_ROUND;
    const energyGain = roundsElapsed * regenPerRound;
    return activeLobby.players.map((player) => {
      const currentEnergy = Number(player.resources.energy ?? 0);
      const nextEnergy = Math.min(energyMax, Math.max(0, Math.floor(currentEnergy + energyGain)));
      return {
        ...player,
        resources: {
          ...player.resources,
          energy: nextEnergy
        }
      };
    });
  }, [activeActionCosts?.energyMax, activeActionCosts?.energyRegenPerRound, activeLobby, projectedRound.index]);

  const projectedMe = useMemo(() => {
    if (!activeLobby?.me || !address) return activeLobby?.me ?? null;
    const byAddress = projectedPlayers.find(
      (player) => player.address.toLowerCase() === address.toLowerCase()
    );
    return byAddress ?? activeLobby.me;
  }, [activeLobby?.me, address, projectedPlayers]);

  /**
   * Round used for barter expiry / open count: same wall-clock projection as the header countdown
   * (`projectRunningRoundClock`), so offers flip to expired when time passes even before the next hydrate.
   */
  const tradeRoundIndex = projectedRound.index;
  const openTradeOffersCount = useMemo(() => {
    const list = activeLobby?.barterOffers;
    if (!list?.length) return 0;
    return list.filter((o) => !o.accepted && tradeRoundIndex <= o.expiresAtRound).length;
  }, [activeLobby?.barterOffers, tradeRoundIndex]);

  const agentAddressSet = useMemo(
    () => new Set(registryAgents.map((a) => a.address.toLowerCase())),
    [registryAgents]
  );

  useEffect(() => {
    if (!publicClient) {
      setRegistryAgents([]);
      setChainRegistryAgentsError(null);
      return;
    }
    if (!erc8004RegistryAddress || !erc8004RegistryAbi) {
      setRegistryAgents([]);
      setChainRegistryAgentsError(
        "ERC8004PlayerAgentRegistry is missing from deployments (run contract deploy and sync frontend ABI)."
      );
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const raw = await publicClient.readContract({
          address: erc8004RegistryAddress,
          abi: erc8004RegistryAbi,
          functionName: "listAgents",
          args: [0n, 64n]
        } as any);
        if (cancelled) return;
        const parsed = parseListAgentsRows(raw);
        setChainRegistryAgentsError(null);
        setRegistryAgents(
          parsed.map((r) => ({
            address: r.controller,
            name: r.name.trim() ? r.name : "Agent",
            identity: r.agent.startsWith("0x") ? r.agent : undefined
          }))
        );
      } catch (e) {
        if (!cancelled) {
          setRegistryAgents([]);
          setChainRegistryAgentsError(mapGameError(e));
        }
      }
    };
    void load();
    const interval = setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [publicClient, erc8004RegistryAddress, erc8004RegistryAbi]);

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
    const interval = setInterval(sync, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, gameCoreAbi, gameCoreAddress, lobbyId, lobbyManagerAbi, lobbyManagerAddress, publicClient, lobbyRepository]);

  useEffect(() => {
    if (!publicClient || !lobbyManagerAddress || !lobbyManagerAbi || !address) {
      setLmWithdrawableWei(null);
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      try {
        const base = (await publicClient.readContract({
          address: lobbyManagerAddress,
          abi: lobbyManagerAbi,
          functionName: "getPlayerBalance",
          args: [address]
        } as any)) as bigint;

        let pendingFromLobby = 0n;
        if (lobbyId) {
          const lid = BigInt(lobbyId);
          const [lobbyRow, poolRaw, playersRaw] = await Promise.all([
            publicClient.readContract({
              address: lobbyManagerAddress,
              abi: lobbyManagerAbi,
              functionName: "getLobby",
              args: [lid]
            } as any),
            publicClient.readContract({
              address: lobbyManagerAddress,
              abi: lobbyManagerAbi,
              functionName: "sessionSponsorPool",
              args: [lid]
            } as any),
            publicClient.readContract({
              address: lobbyManagerAddress,
              abi: lobbyManagerAbi,
              functionName: "getLobbyPlayers",
              args: [lid]
            } as any)
          ]);
          const lr = lobbyRow as readonly unknown[] | Record<string, unknown>;
          const lmStatus = Array.isArray(lr)
            ? Number(lr[3] as bigint)
            : Number((lr as Record<string, unknown>).status ?? 0);
          const poolWei = poolRaw as bigint;
          const roster = Array.isArray(playersRaw) ? (playersRaw as string[]) : [];
          pendingFromLobby = pendingSponsorShareForRosterWei({
            lobbyStatus: lmStatus,
            sessionPoolWei: poolWei,
            roster,
            viewer: address
          });
        }

        if (!cancelled) setLmWithdrawableWei(base + pendingFromLobby);
      } catch {
        if (!cancelled) setLmWithdrawableWei(null);
      }
    };

    void refresh();
    const interval = setInterval(() => void refresh(), 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, lobbyId, lobbyManagerAbi, lobbyManagerAddress, publicClient]);

  useEffect(() => {
    if (!activeLobby || !address) return;

    const ownedHexId = activeLobby.mapHexes.find((hex) => hex.owner?.toLowerCase() === address.toLowerCase())?.id;
    if (!ownedHexId) return;

    setSelectedHex((current) => {
      if (current && activeLobby.mapHexes.some((hex) => hex.id === current)) {
        return current;
      }
      if (selectionClearedByUser) {
        return undefined;
      }
      return ownedHexId;
    });
  }, [activeLobby, address, selectionClearedByUser]);

  useEffect(() => {
    const isGameView = Boolean(activeLobby && activeLobby.status !== "waiting");
    if (!isGameView || !error) {
      setMapErrorPhase("hidden");
      setMapErrorMessage("");
      return;
    }

    setMapErrorMessage(error);
    setMapErrorPhase("visible");
    const fadeTimeout = window.setTimeout(() => setMapErrorPhase("fading"), 2000);
    const hideTimeout = window.setTimeout(() => {
      setMapErrorPhase("hidden");
      setMapErrorMessage("");
      setError("");
    }, 5000);

    return () => {
      window.clearTimeout(fadeTimeout);
      window.clearTimeout(hideTimeout);
    };
  }, [activeLobby?.status, error]);

  const formatCountdown = (secondsLeft: number | null) => {
    if (secondsLeft === null) return "--:--";
    const totalSeconds = Math.max(0, Math.floor(secondsLeft));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  const dismissMapError = () => {
    setMapErrorPhase("hidden");
    setMapErrorMessage("");
    setError("");
  };

  // Lobby creation uses LobbyManager + GameCore.bootstrap
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
        args: [lobbyName, sessionKey, 0n, BigInt(SESSION_TTL_SECONDS)],
        value: effectiveTicketWei
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

      const bootstrapHash = useAaForLobbyFollowups
        ? await sendSessionTransaction({
            lobbyId: String(createdLobbyId),
            contractAddress: gameCoreAddress,
            contractAbi: gameCoreAbi,
            functionName: "bootstrapLobby",
            args: [BigInt(createdLobbyId), address, mapSeed, BigInt(radius)]
          })
        : await walletClient.writeContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "bootstrapLobby",
            account: address,
            args: [BigInt(createdLobbyId), address, mapSeed, BigInt(radius)]
          } as any);

      const bootstrapReceipt = await publicClient.waitForTransactionReceipt({
        hash: bootstrapHash as `0x${string}`
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
      setError(mapGameError(e));
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
      setError(mapGameError(e));
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
      const buyTx = await walletClient.writeContract({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "buyTicketWithSession",
        account: address,
        args: [BigInt(activeLobby.id), sessionKey, 0n, BigInt(SESSION_TTL_SECONDS)],
        value: effectiveTicketWei
      } as any);
      await publicClient.waitForTransactionReceipt({ hash: buyTx as `0x${string}` });

      const joinHash = useAaForLobbyFollowups
        ? await sendSessionTransaction({
            lobbyId: activeLobby.id,
            contractAddress: gameCoreAddress,
            contractAbi: gameCoreAbi,
            functionName: "joinLobby",
            args: [BigInt(activeLobby.id)]
          })
        : await walletClient.writeContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "joinLobby",
            account: address,
            args: [BigInt(activeLobby.id)]
          } as any);
      await publicClient.waitForTransactionReceipt({ hash: joinHash as `0x${string}` });
      confetti({ particleCount: 100, spread: 75, origin: { y: 0.75 } });
      await syncActiveLobbyFromChain(activeLobby.id);
      await syncLobbiesFromChain();
    } catch (e: any) {
      setError(mapGameError(e));
      console.error("Failed to buy ticket", e);
    }
  };

  const onStartLobby = async () => {
    if (!address || !lobbyManagerAddress || !lobbyManagerAbi || !gameCoreAddress || !gameCoreAbi || !activeLobby) return;
    setError("");
    setStartingLobby(true);
    try {
      if (!publicClient || !walletClient) {
        throw new Error("Wallet or RPC client unavailable");
      }

      const lobbyStartHash = useAaForLobbyFollowups
        ? await sendSessionTransaction({
            lobbyId: activeLobby.id,
            contractAddress: lobbyManagerAddress,
            contractAbi: lobbyManagerAbi,
            functionName: "startGame",
            args: [BigInt(activeLobby.id)]
          })
        : await walletClient.writeContract({
            address: lobbyManagerAddress,
            abi: lobbyManagerAbi,
            functionName: "startGame",
            account: address,
            args: [BigInt(activeLobby.id)]
          } as any);
      const lobbyStartReceipt = await publicClient.waitForTransactionReceipt({ hash: lobbyStartHash as `0x${string}` });
      if (lobbyStartReceipt.status !== "success") {
        throw new Error("LobbyManager.startGame transaction reverted");
      }

      if (!lobbyManagerAddress) {
        throw new Error("LobbyManager address missing");
      }
      const gameStartHash = useAaForLobbyFollowups
        ? await sendSessionTransaction({
            lobbyId: activeLobby.id,
            contractAddress: gameCoreAddress,
            contractAbi: gameCoreAbi,
            functionName: "startGame",
            args: [
              BigInt(activeLobby.id),
              BigInt(chainLobbyPhaseDefaults?.zeroRoundSeconds ?? FALLBACK_LOBBY_ZERO_ROUND_SECONDS),
              BigInt(chainLobbyPhaseDefaults?.runningRoundSeconds ?? FALLBACK_LOBBY_RUNNING_ROUND_SECONDS),
              lobbyManagerAddress
            ]
          })
        : await walletClient.writeContract({
            address: gameCoreAddress,
            abi: gameCoreAbi,
            functionName: "startGame",
            account: address,
            args: [
              BigInt(activeLobby.id),
              BigInt(chainLobbyPhaseDefaults?.zeroRoundSeconds ?? FALLBACK_LOBBY_ZERO_ROUND_SECONDS),
              BigInt(chainLobbyPhaseDefaults?.runningRoundSeconds ?? FALLBACK_LOBBY_RUNNING_ROUND_SECONDS),
              lobbyManagerAddress
            ]
          } as any);
      const gameStartReceipt = await publicClient.waitForTransactionReceipt({ hash: gameStartHash as `0x${string}` });
      if (gameStartReceipt.status !== "success") {
        throw new Error("GameCore.startGame transaction reverted");
      }

      const id = activeLobby.id;
      let loaded: LobbyState | null = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        loaded = await syncActiveLobbyFromChain(id);
        if (loaded && loaded.status !== "waiting") {
          break;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      if (!loaded || loaded.status === "waiting") {
        throw new Error("Game did not appear on-chain yet — try refresh in a moment");
      }
      await syncLobbiesFromChain();
    } catch (e: any) {
      setError(mapGameError(e));
    } finally {
      setStartingLobby(false);
    }
  };

  const onCancelLobby = async () => {
    if (!address || !lobbyManagerAddress || !lobbyManagerAbi || !activeLobby || !walletClient || !publicClient) return;
    setError("");
    try {
      const hash = await walletClient.writeContract({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "cancelLobby",
        account: address,
        args: [BigInt(activeLobby.id)]
      } as any);
      await publicClient.waitForTransactionReceipt({ hash });
      navigate("/");
      setActiveLobby(null);
      setSelectedHex(undefined);
      await syncLobbiesFromChain();
    } catch (e: any) {
      setError(mapGameError(e));
    }
  };

  const onLeaveLobby = async () => {
    if (!address || !lobbyManagerAddress || !lobbyManagerAbi || !activeLobby || !publicClient || !walletClient) return;
    setError("");
    setPendingAction("lobby:leave");
    try {
      const txHash = await walletClient.writeContract({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "leaveOpenLobby",
        account: address,
        args: [BigInt(activeLobby.id)]
      } as any);
      await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      navigate("/");
      setActiveLobby(null);
      setSelectedHex(undefined);
      await syncLobbiesFromChain();
    } catch (e: any) {
      setError(mapGameError(e));
      console.error("leaveOpenLobby failed", e);
    } finally {
      setPendingAction(null);
    }
  };

  const onKickHostOpenLobby = async (kickedAddress: string) => {
    if (!activeLobby || !address || !walletClient || !publicClient || !lobbyManagerAddress || !lobbyManagerAbi) return;
    if (kickedAddress.toLowerCase() === address.toLowerCase()) return;
    setError("");
    const pendingKey = `lobby:kick:${kickedAddress.toLowerCase()}`;
    setPendingAction(pendingKey);
    try {
      let txHash: `0x${string}`;
      if (useAaForLobbyFollowups) {
        await ensureLobbySession(activeLobby.id, address);
        txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: lobbyManagerAddress,
          contractAbi: lobbyManagerAbi,
          functionName: "hostKickOpenLobbyPlayer",
          args: [BigInt(activeLobby.id), kickedAddress as `0x${string}`]
        });
      } else {
        txHash = await walletClient.writeContract({
          address: lobbyManagerAddress,
          abi: lobbyManagerAbi,
          functionName: "hostKickOpenLobbyPlayer",
          account: address,
          args: [BigInt(activeLobby.id), kickedAddress as `0x${string}`]
        } as any);
      }
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      await syncActiveLobbyFromChain(activeLobby.id);
      await syncLobbiesFromChain();
    } catch (e: any) {
      setError(mapGameError(e));
      console.error("hostKickOpenLobbyPlayer failed", e);
    } finally {
      setPendingAction(null);
    }
  };

  const onInviteAgent = async (controllerAddress: string) => {
    if (!activeLobby || !address || !walletClient || !publicClient || !lobbyManagerAddress || !lobbyManagerAbi) return;
    setError("");
    setPendingAction("lobby:invite-agent");
    try {
      let txHash: `0x${string}`;
      if (useAaForLobbyFollowups) {
        await ensureLobbySession(activeLobby.id, address);
        txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: lobbyManagerAddress,
          contractAbi: lobbyManagerAbi,
          functionName: "inviteAgentToLobby",
          args: [BigInt(activeLobby.id), controllerAddress as `0x${string}`]
        });
      } else {
        txHash = await walletClient.writeContract({
          address: lobbyManagerAddress,
          abi: lobbyManagerAbi,
          functionName: "inviteAgentToLobby",
          account: address,
          args: [BigInt(activeLobby.id), controllerAddress as `0x${string}`]
        } as any);
      }
      await publicClient.waitForTransactionReceipt({ hash: txHash });
    } catch (e: any) {
      setError(mapGameError(e));
    } finally {
      setPendingAction(null);
    }
  };

  const onWithdrawLobbyBalance = async () => {
    if (!address || !lobbyManagerAddress || !lobbyManagerAbi) return;
    setError("");
    setPendingAction("lobby:withdraw");
    try {
      if (!walletClient) {
        throw new Error("Wallet client unavailable");
      }
      if (!publicClient) {
        throw new Error("RPC client unavailable");
      }

      const targetLobbyId = activeLobby?.id ?? lobbyId;
      if (targetLobbyId) {
        const lid = BigInt(targetLobbyId);
        const lobbyRow = (await publicClient.readContract({
          address: lobbyManagerAddress,
          abi: lobbyManagerAbi,
          functionName: "getLobby",
          args: [lid]
        } as any)) as readonly unknown[] | Record<string, unknown>;
        const lmStatus = Array.isArray(lobbyRow)
          ? Number(lobbyRow[3] as bigint)
          : Number((lobbyRow as Record<string, unknown>).status ?? 0);
        const pool = (await publicClient.readContract({
          address: lobbyManagerAddress,
          abi: lobbyManagerAbi,
          functionName: "sessionSponsorPool",
          args: [lid]
        } as any)) as bigint;
        if ((lmStatus === 2 || lmStatus === 3) && pool > 0n) {
          let distHash: `0x${string}`;
          if (useAaForLobbyFollowups) {
            await ensureLobbySession(targetLobbyId, address);
            distHash = await sendSessionTransaction({
              lobbyId: targetLobbyId,
              contractAddress: lobbyManagerAddress,
              contractAbi: lobbyManagerAbi,
              functionName: "distributeSessionSponsorRemainder",
              args: [lid]
            });
          } else {
            distHash = await walletClient.writeContract({
              address: lobbyManagerAddress,
              abi: lobbyManagerAbi,
              functionName: "distributeSessionSponsorRemainder",
              account: address,
              args: [lid]
            } as any);
          }
          await publicClient.waitForTransactionReceipt({ hash: distHash });
        }
      }

      const hash = await walletClient.writeContract({
        address: lobbyManagerAddress,
        abi: lobbyManagerAbi,
        functionName: "withdraw",
        account: address,
        args: []
      } as any);
      await publicClient.waitForTransactionReceipt({ hash });
      setLmWithdrawableWei(0n);
    } catch (e: any) {
      setError(mapGameError(e));
      console.error("withdraw failed", e);
    } finally {
      setPendingAction(null);
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
          discoveredBy: [address]
        });
        setActiveLobby((current) => {
          if (!current) return current;
          return {
            ...current,
            mapHexes: current.mapHexes.map((tile) =>
              tile.id === hex.id ? { ...tile, owner: address, discoveredBy: [address] } : tile
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
        const hex = activeLobby.mapHexes.find((tile) => tile.id === payload.hexId);
        if (!hex) throw new Error("Hex not found");
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "discoverHex",
          args: [lobbyId, hex.id, BigInt(hex.q), BigInt(hex.r)]
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
          args: [lobbyId, payload.hexId ?? selectedForDetails?.id]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:craft") {
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "craftAlloy",
          args: [lobbyId]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:concede") {
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "concede",
          args: [lobbyId]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "barter:create") {
        setPendingAction("barter:create");
        const taker = (payload.to as `0x${string}` | undefined) ?? ZERO_ADDRESS;
        const expiry = BigInt(Math.max(1, Math.floor(Number(payload.expiryRounds ?? 2))));
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "createTrade",
          args: [
            lobbyId,
            taker,
            tradeResourcesTuple(payload.offer as Record<string, unknown>),
            tradeResourcesTuple(payload.request as Record<string, unknown>),
            expiry
          ]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "barter:accept") {
        setPendingAction("barter:accept");
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "acceptTrade",
          args: [lobbyId, BigInt(payload.barterId ?? payload.tradeId ?? 0)]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "vote:create") {
        const effectKey =
          payload.effect?.special === "__END_ROUND__"
            ? "__END_ROUND__"
            : payload.effect?.special === "__END_GAME__"
              ? "__END_GAME__"
              : JSON.stringify(payload.effect || {});
        const closeRound =
          effectKey === "__END_GAME__" && activeLobby.status === "zero-round"
            ? 0
            : effectKey === "__END_ROUND__"
              ? 999
              : activeLobby.rounds.index + 3;
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "createProposal",
          args: [lobbyId, payload.title, effectKey, BigInt(closeRound)]
        });
        await publicClient?.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      } else if (event === "game:bank-trade") {
        const times = Math.max(
          1,
          Math.min(Number(payload.times ?? 1) || 1, bankTradeBulkMaxLots)
        );
        const fn = times === 1 ? "tradeWithBank" : "tradeWithBankBulk";
        const args =
          times === 1
            ? [lobbyId, BigInt(payload.sellKind), BigInt(payload.buyKind)]
            : [lobbyId, BigInt(payload.sellKind), BigInt(payload.buyKind), BigInt(times)];
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: fn,
          args
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
        const roundSecs =
          activeLobby.rounds.durationSeconds && activeLobby.rounds.durationSeconds > 0
            ? activeLobby.rounds.durationSeconds
            : chainLobbyPhaseDefaults?.runningRoundSeconds ?? FALLBACK_LOBBY_RUNNING_ROUND_SECONDS;
        const txHash = await sendSessionTransaction({
          lobbyId: activeLobby.id,
          contractAddress: gameCoreAddress,
          contractAbi: gameCoreAbi,
          functionName: "advanceRound",
          args: [lobbyId, BigInt(roundSecs)]
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
      setError(mapGameError(e));
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
  const selectedOwner = selectedForDetails?.owner
    ? projectedPlayers.find((player) => player.address.toLowerCase() === selectedForDetails.owner?.toLowerCase())
    : null;
  const isSelectedMine = Boolean(selectedForDetails?.owner && address && selectedForDetails.owner.toLowerCase() === address.toLowerCase());
  const hasStructure = Boolean(selectedForDetails?.structure);
  const ownedHexCount = activeLobby?.mapHexes.filter((hex) => hex.owner?.toLowerCase() === address?.toLowerCase()).length ?? 0;
  const discoverCost = activeActionCosts?.discover ?? null;
  const buildCost = activeActionCosts?.build ?? null;
  const upgradeCost = activeActionCosts?.upgrade ?? null;
  const craftCost = activeActionCosts?.craft ?? null;
  const tradeEnergyCost = activeActionCosts?.tradingEnergyCost ?? 0;
  const collectEnergyForStructure =
    selectedForDetails?.structure?.level === 2
      ? activeActionCosts?.collectEnergyLevel2
      : activeActionCosts?.collectEnergyLevel1;
  const collectResourceYieldForStructure =
    selectedForDetails?.structure?.level === 2
      ? activeActionCosts?.collectResourceYieldLevel2
      : activeActionCosts?.collectResourceYieldLevel1;
  const collectEnergyKnown =
    typeof collectEnergyForStructure === "number" && Number.isFinite(collectEnergyForStructure);
  const collectYieldKnown =
    typeof collectResourceYieldForStructure === "number" && Number.isFinite(collectResourceYieldForStructure);
  const collectEnergyLabel = collectEnergyKnown
    ? `energy ${collectEnergyForStructure}`
    : activeActionCosts
      ? "—"
      : "loading...";
  const collectGainLabel = collectYieldKnown ? `+${collectResourceYieldForStructure} basic (biome)` : "";
  const canDiscoverHere = Boolean(selectedForDetails && activeLobby?.status === "running" && !selectedForDetails.owner && isAdjacentToOwnedHex(activeLobby?.mapHexes ?? [], selectedForDetails, address));
  const canBuildHere = Boolean(selectedForDetails && isSelectedMine && !hasStructure);
  const canUpgradeHere = Boolean(selectedForDetails && isSelectedMine && selectedForDetails.structure?.level === 1);
  const canDestroyHere = Boolean(selectedForDetails && isSelectedMine && selectedForDetails.structure);
  const canCollectHere = Boolean(selectedForDetails && isSelectedMine && selectedForDetails.structure);
  const ActiveMapComponent = mapRenderer === "3d" ? HexMap : HexMap2D;
  let selectedActionCost: string | null = canDiscoverHere
    ? discoverCost && formatCost(discoverCost)
    : canBuildHere
      ? buildCost && formatCost(buildCost)
      : canUpgradeHere
        ? upgradeCost && formatCost(upgradeCost)
        : null;
  if (canCollectHere && collectEnergyKnown) {
    const collectHint =
      collectYieldKnown && collectResourceYieldForStructure != null
        ? `collect energy ${collectEnergyForStructure} · +${collectResourceYieldForStructure} basic (biome)`
        : `collect energy ${collectEnergyForStructure}`;
    selectedActionCost = selectedActionCost ? `${selectedActionCost} · ${collectHint}` : collectHint;
  }

  const costChip = (kind: ResourceKey, value: number) => {
    const accents: Record<ResourceKey, string> = {
      food: "#ffd369",
      wood: "#5bff9d",
      stone: "#96b7ff",
      ore: "#ff9f6e",
      energy: "#56f0ff"
    };
    const iconByKind: Record<ResourceKey, typeof Wheat> = {
      food: Wheat,
      wood: TreePine,
      stone: Pickaxe,
      ore: Gem,
      energy: BatteryCharging
    };
    const Icon = iconByKind[kind];
    return (
      <span key={`${kind}:${value}`} className="spectator-res-chip" style={{ borderColor: `${accents[kind]}55` }} title={`${kind} ${value}`}>
        <Icon size={12} color={accents[kind]} aria-hidden />
        <strong>{value}</strong>
      </span>
    );
  };

  const costStrip = (cost: { food?: number; wood?: number; stone?: number; ore?: number; energy?: number }) => {
    const entries = [
      ["food", Number(cost.food ?? 0)] as const,
      ["wood", Number(cost.wood ?? 0)] as const,
      ["stone", Number(cost.stone ?? 0)] as const,
      ["ore", Number(cost.ore ?? 0)] as const,
      ["energy", Number(cost.energy ?? 0)] as const
    ].filter(([, amount]) => Number.isFinite(amount) && amount > 0);
    if (!entries.length) return <span className="selected-text">free</span>;
    return entries.map(([kind, amount]) => costChip(kind, amount));
  };

  const hexById = (hexId: string) => activeLobby?.mapHexes.find((hex) => hex.id === hexId);
  const isMineHex = (hexId: string) => {
    const hex = hexById(hexId);
    return Boolean(hex?.owner && address && hex.owner.toLowerCase() === address.toLowerCase());
  };
  const canDiscoverHex = (hexId: string) => {
    const hex = hexById(hexId);
    return Boolean(
      hex &&
      activeLobby?.status === "running" &&
      !hex.owner &&
      isAdjacentToOwnedHex(activeLobby?.mapHexes ?? [], hex, address)
    );
  };
  const canUpgradeHex = (hexId: string) => {
    const hex = hexById(hexId);
    return Boolean(hex && isMineHex(hexId) && hex.structure?.level === 1);
  };
  const canBuildHex = (hexId: string) => {
    const hex = hexById(hexId);
    return Boolean(hex && isMineHex(hexId) && !hex.structure);
  };
  const collectInfoForHex = (hexId: string) => {
    const hex = hexById(hexId);
    const level = hex?.structure?.level === 2 ? 2 : 1;
    const energy = level === 2 ? activeActionCosts?.collectEnergyLevel2 : activeActionCosts?.collectEnergyLevel1;
    const yieldValue = level === 2 ? activeActionCosts?.collectResourceYieldLevel2 : activeActionCosts?.collectResourceYieldLevel1;
    const energyKnownForHex = typeof energy === "number" && Number.isFinite(energy);
    const yieldKnownForHex = typeof yieldValue === "number" && Number.isFinite(yieldValue);
    const energyLabelForHex = energyKnownForHex ? `energy ${energy}` : activeActionCosts ? "—" : "loading...";
    const gainLabelForHex = yieldKnownForHex ? `+${yieldValue} basic (biome)` : "";
    return {
      canCollect: Boolean(hex && isMineHex(hexId) && hex.structure),
      energyLabel: energyLabelForHex,
      gainLabel: gainLabelForHex,
      yieldValue,
      yieldKnown: yieldKnownForHex
    };
  };

  const hexContextMenuActions = {
    discover: {
      visible: (hexId: string) => canDiscoverHex(hexId),
      enabled: () => !pendingAction,
      label: "Discover / Claim",
      details: discoverCost ? costStrip(discoverCost) : <span className="selected-text">loading...</span>,
      hint: "",
      onClick: (hexId: string) => {
        if (pendingAction) return;
        void action("game:discover", { hexId });
      }
    },
    build: {
      visible: (hexId: string) => canBuildHex(hexId),
      enabled: () => !pendingAction,
      label: "Build lvl1",
      details: buildCost ? costStrip(buildCost) : <span className="selected-text">loading...</span>,
      hint: "",
      onClick: (hexId: string) => {
        if (pendingAction) return;
        void action("game:build", { hexId });
      }
    },
    upgrade: {
      visible: (hexId: string) => canUpgradeHex(hexId),
      enabled: () => !pendingAction,
      label: "Upgrade lvl2",
      details: upgradeCost ? costStrip(upgradeCost) : <span className="selected-text">loading...</span>,
      hint: "",
      onClick: (hexId: string) => {
        if (pendingAction) return;
        void action("game:upgrade", { hexId });
      }
    },
    collect: {
      visible: (hexId: string) => collectInfoForHex(hexId).canCollect,
      enabled: () => !pendingAction,
      label: "Collect resources",
      details: (hexId: string) => {
        const collectInfo = collectInfoForHex(hexId);
        const level = hexById(hexId)?.structure?.level === 2 ? 2 : 1;
        const energyCost = level === 2 ? activeActionCosts?.collectEnergyLevel2 : activeActionCosts?.collectEnergyLevel1;
        if (typeof energyCost !== "number" || !Number.isFinite(energyCost)) {
          return <span className="selected-text">loading...</span>;
        }
        return (
          <>
            {costChip("energy", energyCost)}
            {collectInfo.gainLabel ? <span className="selected-text">{collectInfo.gainLabel}</span> : null}
          </>
        );
      },
      hint: "",
      onClick: (hexId: string) => {
        if (pendingAction) return;
        void action("game:collect", { hexId }, true);
      }
    }
  };

  const activeLobbyIdForAssistant = activeLobby?.id || lobbyId || "";
  const hasAssistantInputs =
    Boolean(activeLobbyIdForAssistant) &&
    Boolean(address) &&
    /^0x[a-fA-F0-9]{40}$/.test(address || "");

  const onSendAssistantPrompt = async () => {
    if (assistantSending) return;
    const prompt = assistantPrompt.trim();
    if (!prompt) return;
    if (!hasAssistantInputs || !address) {
      setAssistantError("Missing lobbyId or player address for assistant request.");
      return;
    }

    setAssistantError(null);
    setAssistantPrompt("");
    setAssistantMessages((prev) => [...prev, { role: "user", content: prompt }]);
    setAssistantSending(true);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort("assistant-timeout"), 20_000);

    try {
      const response = await fetch(`${assistantApiUrl}/api/assistant/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lobbyId: activeLobbyIdForAssistant,
          playerAddress: address,
          prompt
        }),
        signal: controller.signal
      });

      const data = (await response.json().catch(() => ({}))) as {
        answer?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || `Assistant API error (${response.status})`);
      }

      const answer = typeof data.answer === "string" && data.answer.trim() ? data.answer : "Brak odpowiedzi od asystenta.";
      setAssistantMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch (err) {
      const isAbort = controller.signal.aborted;
      const message = isAbort
        ? "Assistant request timed out. Please try again."
        : err instanceof Error
          ? err.message
          : "Failed to send request to assistant.";
      setAssistantError(message);
      setAssistantMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I cannot answer right now. Please try again in a moment."
        }
      ]);
    } finally {
      window.clearTimeout(timeoutId);
      setAssistantSending(false);
    }
  };

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
        {chainDeployHint ? <p className="error-banner">{chainDeployHint}</p> : null}
        <button type="button" onClick={() => navigate("/")}>
          Back to lobbies
        </button>
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
        deployHint={chainDeployHint}
        ticketPriceLabel={ticketPriceLabel}
        claimableWei={lmWithdrawableWei}
        onClaimLobbyBalance={() => void onWithdrawLobbyBalance()}
        claimPending={pendingAction === "lobby:withdraw"}
      />
    );
  }

  if (activeLobby.status === "cancelled") {
    const claimable = lmWithdrawableWei != null && lmWithdrawableWei > 0n;
    return (
      <div className="connect-screen">
        <h1>Lobby cancelled</h1>
        <p>
          This lobby was cancelled. Claim first splits any remaining sponsor pool into per-player balances on the lobby
          contract, then withdraws to your wallet.
        </p>
        {lmWithdrawableWei != null ? (
          <p>
            <strong>Claimable on contract</strong>: {formatEther(lmWithdrawableWei)} ETH
          </p>
        ) : (
          <p>Reading your balance…</p>
        )}
        {claimable ? (
          <button
            type="button"
            onClick={() => void onWithdrawLobbyBalance()}
            disabled={pendingAction === "lobby:withdraw"}
          >
            {pendingAction === "lobby:withdraw" ? "Confirming…" : "Claim ETH to wallet"}
          </button>
        ) : lmWithdrawableWei != null && lmWithdrawableWei === 0n ? (
          <p className="selected-text">No balance left to claim for this wallet.</p>
        ) : null}
        {error ? <p className="error-banner">{error}</p> : null}
        <button type="button" onClick={() => navigate("/")}>
          Back to lobbies
        </button>
      </div>
    );
  }

  if (activeLobby.status === "ended") {
    const winnerAddr = activeLobby.declaredWinnerAddress || activeLobby.inferredWinnerAddress || null;
    const declared = Boolean(activeLobby.declaredWinnerAddress);
    const lmActive = activeLobby.lobbyManagerStatus === 1;
    return (
      <div className="connect-screen">
        <h1>Match over</h1>
        <p className="selected-text" style={{ maxWidth: "36rem" }}>
          Entry fees fund account-abstraction gas (paymaster / EntryPoint). When the match settles, leftover sponsor
          funds stay on the lobby until you claim; the claim step splits the pool into balances and then transfers yours
          to your wallet.
        </p>
        {winnerAddr ? (
          <>
            <p>
              <strong>On-chain result</strong>: {short(winnerAddr)}
            </p>
            <p className="selected-text" style={{ wordBreak: "break-all" }}>
              {winnerAddr}
            </p>
            {declared ? (
              <p>The lobby contract recorded this outcome.</p>
            ) : lmActive ? (
              <p>
                GameCore has finished, but the lobby is still <strong>ACTIVE</strong>. The host can call{" "}
                <code>completeGame</code> on the lobby contract to record the winner and release remaining sponsor funds
                for withdrawal.
              </p>
            ) : (
              <p>The lobby is closed on-chain.</p>
            )}
          </>
        ) : (
          <p>
            The match ended without a single declared winner (e.g. abandon or vote). If the lobby is still active, the
            host may call <code>completeGame</code> when appropriate.
          </p>
        )}
        {address && winnerAddr && address.toLowerCase() === winnerAddr.toLowerCase() ? (
          <p>
            <strong>You are recorded as the winner on-chain.</strong>
          </p>
        ) : null}
        {lmWithdrawableWei != null ? (
          <p>
            <strong>Your claimable balance on the lobby contract</strong>: {formatEther(lmWithdrawableWei)} ETH
          </p>
        ) : (
          <p>Reading your balance…</p>
        )}
        {lmWithdrawableWei != null && lmWithdrawableWei > 0n ? (
          <button
            type="button"
            onClick={() => void onWithdrawLobbyBalance()}
            disabled={pendingAction === "lobby:withdraw"}
          >
            {pendingAction === "lobby:withdraw" ? "Confirming…" : "Withdraw to wallet"}
          </button>
        ) : lmWithdrawableWei != null && lmWithdrawableWei === 0n ? (
          <p className="selected-text">
            Nothing to withdraw for this wallet. If the lobby is still active, wait for settlement or for the host to
            call <code>completeGame</code>.
          </p>
        ) : null}
        {error ? <p className="error-banner">{error}</p> : null}
        <button type="button" onClick={() => navigate("/")}>
          Back to lobbies
        </button>
      </div>
    );
  }

  if (activeLobby.status === "waiting") {
    return (
      <LobbyRoom
        address={address}
        lobby={activeLobby}
        isHost={isLobbyHost}
        hasTicket={hasLobbyTicket}
        canLeaveLobby={Boolean(!isLobbyHost && hasLobbyTicket)}
        onLeaveLobby={() => void onLeaveLobby()}
        leaveLobbyPending={pendingAction === "lobby:leave"}
        canStart={canStartLobby}
        starting={startingLobby}
        ticketPriceLabel={ticketPriceLabel}
        onBuyTicket={onBuyTicket}
        onStart={onStartLobby}
        onCancel={onCancelLobby}
        onBack={() => navigate("/")}
        onDisconnect={() => disconnect()}
        actionError={error}
        agentAddresses={agentAddressSet}
        registeredAgents={registryAgents}
        chainRegistryAgentsError={chainRegistryAgentsError}
        inviteUses4337={useAaForLobbyFollowups}
        onInviteAgent={onInviteAgent}
        inviteAgentPending={pendingAction === "lobby:invite-agent"}
        onKickPlayer={isLobbyHost ? (addr) => void onKickHostOpenLobby(addr) : undefined}
        kickPlayerPendingAddress={
          pendingAction?.startsWith("lobby:kick:") ? pendingAction.slice("lobby:kick:".length) : null
        }
      />
    );
  }

  return (
    <div className={`game-shell${isSpectator ? " game-shell--spectator" : ""}`}>
      {isSpectator ? (
        <aside className="panel spectator-sidebar">
          <SpectatorPlayersPanel
            players={projectedPlayers}
            host={activeLobby.host}
            round={projectedRound.index}
            statusLabel={activeLobby.status === "zero-round" ? "Starting positions" : "Live match"}
            victoryAlloyTarget={victoryAlloyTarget}
            viewerNeedsGameCoreJoin={Boolean(activeLobby.viewerNeedsGameCoreJoin && address)}
            onBack={() => navigate("/")}
          />
          <SpectatorOnChainTrades offers={activeLobby.barterOffers} effectiveRoundIndex={tradeRoundIndex} shortAddr={short} />
          <SpectatorTradeFeed items={spectatorTradeFeed} loading={spectatorTradeFeedLoading} />
        </aside>
      ) : null}

      <main className={`map-main${isSpectator ? " map-main--spectator" : ""}`}>
        <div className="top-hud">
          <div className="top-hud-brand">Equilibrium</div>
          <div className="top-hud-primary">
            <h2>{activeLobby.name}</h2>
            <div className="top-hud-subline">
              {isSpectator ? (
                <span className="top-hud-chip top-hud-chip--spectator">
                  Spectator
                </span>
              ) : null}
              <span className="top-hud-round-label">
                {activeLobby.status === "zero-round" ? "Round 0: choose your starting hex" : `Round ${projectedRound.index}`}
              </span>
            </div>
          </div>
          <div className="top-hud-meta">
            <span className={`round-timer${isRoundTimerDanger ? " round-timer--danger" : ""}`}>
              {projectedRound.deadlineSec ? `Time left ${formatCountdown(roundCountdown)}` : "Waiting for round"}
            </span>
          </div>
        </div>

        <div className="map-stage">
          {!isSpectator ? (
            <div className="map-resource-strip" aria-label="Your resources">
              {[
                { key: "food", label: "Food", icon: Wheat, color: "#ffd369", value: projectedMe?.resources.food ?? 0 },
                { key: "wood", label: "Wood", icon: TreePine, color: "#5bff9d", value: projectedMe?.resources.wood ?? 0 },
                { key: "stone", label: "Stone", icon: Pickaxe, color: "#96b7ff", value: projectedMe?.resources.stone ?? 0 },
                { key: "ore", label: "Ore", icon: Gem, color: "#ff9f6e", value: projectedMe?.resources.ore ?? 0 },
                { key: "energy", label: "Energy", icon: BatteryCharging, color: "#56f0ff", value: projectedMe?.resources.energy ?? 0 },
                { key: "alloy", label: "Alloy", icon: Factory, color: "#e0b0ff", value: projectedMe?.craftedGoods ?? 0 }
              ].map((resource) => (
                <div key={resource.key} className="map-resource-item">
                  <resource.icon size={18} color={resource.color} aria-hidden />
                  <span className="map-resource-item-label">{resource.label}:</span>
                  <strong className="map-resource-item-value">{resource.value}</strong>
                </div>
              ))}
            </div>
          ) : null}

          <ActiveMapComponent
            hexes={activeLobby.mapHexes}
            myAddress={isSpectator ? undefined : address}
            selectedHex={selectedHex}
            earthquakeTargets={activeLobby.pendingEarthquake?.targets || []}
            contextMenuActions={isSpectator ? undefined : hexContextMenuActions}
            onBackgroundClick={() => {
              setSelectionClearedByUser(true);
              setSelectedHex(undefined);
            }}
            onHexClick={(id) => {
              if (pendingAction) return;
              setSelectionClearedByUser(false);
              setSelectedHex(id);
            }}
          />

          {mapErrorMessage ? (
            <div className={`map-error-overlay map-error-overlay--${mapErrorPhase}`}>
              <p className="map-error-banner">
                <span>{mapErrorMessage}</span>
                <button
                  type="button"
                  className="error-close-btn"
                  onClick={dismissMapError}
                  aria-label="Close error"
                >
                  &times;
                </button>
              </p>
            </div>
          ) : null}
        </div>

        {isSpectator && selectedForDetails ? (
          <div className="spectator-map-footer">
            Hex <strong>{selectedForDetails.id}</strong> · {selectedForDetails.biome} · owner{" "}
            <strong>{selectedOwner?.nickname ?? short(selectedForDetails.owner ?? undefined) ?? "none"}</strong>
            {selectedForDetails.structure ? ` · structure L${selectedForDetails.structure.level}` : ""}
          </div>
        ) : null}

        {!isSpectator && address && activeLobby.me === null && (activeLobby.status === "running" || activeLobby.status === "zero-round") ? (
          <p className="error-banner">
            This wallet is not a player in this lobby. Connect a wallet that holds a ticket for this match.
          </p>
        ) : null}
      </main>

      {!isSpectator ? (
      <aside className="panel right-panel">
        {activeLobby.status === "zero-round" && myTurnInZeroRound ? (
          <div className="action-group">
            <h4>Round 0 — start</h4>
            <p className="selected-text">
              Click a free hex on the map, then confirm here. The pick is sent only after you press the button.
            </p>
            <button
              type="button"
              onClick={() => {
                if (!selectedHex) return;
                action("game:pick-start", { hexId: selectedHex }, true);
              }}
              disabled={
                Boolean(pendingAction) ||
                !selectedHex ||
                Boolean(activeLobby.mapHexes.find((h) => h.id === selectedHex)?.owner)
              }
            >
              Confirm starting hex {selectedHex ? `(${selectedHex})` : ""}
            </button>
          </div>
        ) : null}

        {activeLobby.status === "zero-round" && !myTurnInZeroRound ? (
          <div className="action-group">
            <h4>Round 0</h4>
            <p className="selected-text">You already chose a starting hex. Waiting for other players…</p>
          </div>
        ) : null}

      <div className="action-group">
        <h4>Players</h4>
        {activeLobby.players.map((player) => (
          <div 
            key={player.address} 
            className="player-row"
            style={{ 
              borderLeft: `1px solid ${colorFromAddress(player.address)}`, // Dodaje kolorowy pasek z boku
              borderRight: `1px solid ${colorFromAddress(player.address)}`, // Opcjonalnie delikatna ramka z prawej
              paddingLeft: '16px' // Mały odstęp, żeby tekst nie dotykał paska
            }}
          >
            <div>
              <strong style={{ color: colorFromAddress(player.address) }}>
                {player.nickname}
              </strong>
              <p>
                {short(player.address)} {player.address.toLowerCase() === activeLobby.host.toLowerCase() ? "• host" : ""}{" "}
                {player.alive === false ? "• out" : ""}
              </p>
            </div>
            <span 
              className="player-tag"
              style={{ color: player.alive === false ? '#666' : colorFromAddress(player.address),
                       paddingRight: '16px'
               }}
            >
              {player.alive === false ? "eliminated" : "active"}
            </span>
          </div>
        ))}
      </div>

      <div 
        className="iko-launcher-tile action-group" 
        onClick={() => setIsIkoOpen(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          paddingLeft: '24px',
          borderRadius: '12px',
          cursor: 'pointer',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
        }}
      >
        <PkoLogoIcon size={22} />
        <h4>Open IKO</h4>
      </div>
          
        <Accordion.Root type="single" collapsible className="AccordionRoot">
          <Accordion.Item value="crafting" className="action-group" style={{ paddingTop: '0px'}}>
            
          <Accordion.Trigger className="AccordionTrigger">
            <div className="TriggerLabel">
              <Factory size={18} color="#e0b0ff" />
              <h4>Crafting</h4>
            </div>
            <ChevronDown size={16} className="AccordionChevron" />
          </Accordion.Trigger>

            <Accordion.Content className="AccordionContent " >
                <p className="selected-text">
                  Smelt <strong>alloy</strong> from basics — costs scale with how much you already forged.
                  {victoryAlloyTarget != null && (
                    <>
                      {" "}
                      First to <strong>{victoryAlloyTarget}</strong> alloy wins.
                    </>
                  )}
                </p>

                <div className="selected-text">
                  {craftCost
                    ? `Next craft cost: ${formatCost(craftCost)}`
                    : craftCostHint
                      ? `Next craft cost: ${craftCostHint}`
                      : "Loading craft preview…"}
                </div>

                <button
                  type="button"
                  onClick={() => action("game:craft", {})}
                  disabled={activeLobby.status !== "running" || Boolean(pendingAction)}
                >
                  <Factory size={16} /> Craft alloy
                </button>
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>

        <Accordion.Root type="single" collapsible className="AccordionRoot">
          <Accordion.Item value="votes" className="action-group" style={{ paddingTop: '0px' }}>
            <Accordion.Trigger className="AccordionTrigger">
              <div className="TriggerLabel">
                <Vote size={18} color="#525252" />
                <h4>{LIMITED_VOTING_UI ? "Round vote" : "Votes"}</h4>
              </div>
              <ChevronDown size={16} className="AccordionChevron" />
            </Accordion.Trigger>

            <Accordion.Content className="AccordionContent">
              {LIMITED_VOTING_UI ? (
                <>
                  <p className="selected-text">
                    Propose a vote to end the current round early.
                  </p>
                  <button 
                    type="button"
                    style={{ width: '100%' }}
                    onClick={() => action("vote:create", { title: "End round early", effect: { special: "__END_ROUND__" } })}
                    disabled={activeLobby.status !== "running"}
                  >
                    Propose end round
                  </button>
                </>
              ) : (
                <>
                  <p className="selected-text">
                    Stuck in round 0? Propose <strong>end game</strong> — if everyone votes yes, the lobby ends. 
                    While running, the same vote closes after the deadline or when all players have cast.
                  </p>

                  <button
                    type="button"
                    onClick={() =>
                      action("vote:create", {
                        title: "End game",
                        effect: { special: "__END_GAME__" }
                      })
                    }
                    disabled={Boolean(pendingAction) || (activeLobby.status !== "zero-round" && activeLobby.status !== "running")}
                  >
                    Propose end game
                  </button>

                  <div className="vote-preset-grid" style={{ marginTop: '10px' }}>
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
                            setError(mapGameError(e));
                          }
                        }}
                      >
                        <Vote size={16} /> {preset.label}
                      </button>
                    ))}
                  </div>

                  {activeLobby.globalVotes && activeLobby.globalVotes.length > 0 && (
                    <div className="active-votes-section" style={{ marginTop: '15px' }}>
                      {activeLobby.globalVotes
                        .filter((vote: { resolved?: boolean }) => !vote.resolved)
                        .slice(0, 8)
                        .map((vote: any) => (
                          <div key={vote.id} className="vote-item" style={{ borderTop: '1px solid #333', padding: '10px 0' }}>
                            <p><strong>{vote.title}</strong></p>
                            <p className="selected-text">
                              {vote.effectKey === "__END_ROUND__"
                                ? "End current round (unanimous yes, no “no” votes)"
                                : vote.effectKey === "__END_GAME__"
                                  ? "End the match"
                                  : vote.effectKey}
                            </p>
                            <p className="selected-text">Closes after round {vote.closesAtRound}</p>
                            <p className="selected-text">
                              Votes: yes {vote.yesVotes} / no {vote.noVotes}
                            </p>
                            <div className="vote-buttons">
                              <button
                                type="button"
                                onClick={() => action("vote:cast", { lobbyId: activeLobby.id, voteId: vote.id, by: address, support: true })}
                                disabled={Boolean(pendingAction)}
                              >
                                Yes
                              </button>
                              <button
                                type="button"
                                onClick={() => action("vote:cast", { lobbyId: activeLobby.id, voteId: vote.id, by: address, support: false })}
                                disabled={Boolean(pendingAction)}
                              >
                                No
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </>
              )}
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>

        <Accordion.Root type="single" collapsible className="AccordionRoot">
                <Accordion.Item value="options" className="action-group" style={{ paddingTop: '0px' }}>
        <Accordion.Trigger className="AccordionTrigger">
          <div className="TriggerLabel">
            <Settings size={18} color="#e0b0ff" />
            <h4>Game options</h4>
          </div>
          <ChevronDown size={16} className="AccordionChevron" />
        </Accordion.Trigger>

        <Accordion.Content className="AccordionContent">
          <div className="game-options" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              style={{ width: '100%' }}
              onClick={() => setMapRenderer((current) => (current === "3d" ? "2d" : "3d"))}
              title="Switch map renderer"
            >
              Map view: {mapRenderer.toUpperCase()}
            </button>
            
            {/* Przycisk poddania się - wyświetlany tylko gdy gracz żyje i gra trwa */}
            {address && activeLobby.me?.alive !== false && activeLobby.status === "running" ? (
              <button
                type="button"
                className="danger"
                style={{ width: '100%' }}
                onClick={() => {
                  if (!window.confirm("Concede this match? Others may win if you are not the last player standing.")) return;
                  void action("game:concede", {});
                }}
                disabled={Boolean(pendingAction)}
              >
                <Flag size={16} /> Concede match
              </button>
            ) : null}

            {/* Temporarily hidden while LIMITED_VOTING_UI is enabled */}
            {!LIMITED_VOTING_UI && (
              <button 
                type="button"
                style={{ width: '100%' }}
                onClick={() => action("vote:create", { title: "End round early", effect: { special: "__END_ROUND__" } })} 
                disabled={activeLobby.status !== "running"}
              >
                Propose end round
              </button>
            )}

            {/* Przycisk rozłączenia portfela */}
            <button 
              type="button"
              style={{ width: '100%', opacity: 0.8 }}
              onClick={() => navigate("/")}
            >
              Return to lobby
            </button>

            <button 
              type="button"
              style={{ width: '100%', opacity: 0.8 }}
              onClick={() => disconnect()}
            >
              Disconnect wallet
            </button>

            {activeMapConfig ? (
              <div className="game-options-map-meta">
                <span>{`Map radius = ${activeMapConfig.radius}`}</span>
                <span>{`Seed: ${activeMapConfig.seed.slice(0, 10)}...`}</span>
              </div>
            ) : null}

          </div>
        </Accordion.Content>
      </Accordion.Item>
          </Accordion.Root>

        <div className="log-list">
          <div className="action-group assistant-chat-panel">
            <h4>Assistant (placeholder)</h4>
            <div className="assistant-chat-messages">
              {assistantMessages.length === 0 ? (
                <p className="selected-text">Ask about rules or strategy for the current lobby situation.</p>
              ) : (
                assistantMessages.map((m, idx) => (
                  <div key={`${m.role}-${idx}`} className={`assistant-chat-message assistant-chat-message--${m.role}`}>
                    <strong>{m.role === "user" ? "You" : "Assistant"}</strong>
                    <p>{m.content}</p>
                  </div>
                ))
              )}
            </div>

            <textarea
              className="assistant-chat-input"
              value={assistantPrompt}
              onChange={(e) => setAssistantPrompt(e.target.value)}
              placeholder="Type your question for the assistant..."
              rows={3}
              disabled={assistantSending || !hasAssistantInputs}
            />

            <button
              type="button"
              onClick={() => void onSendAssistantPrompt()}
              disabled={assistantSending || !assistantPrompt.trim() || !hasAssistantInputs}
            >
              {assistantSending ? "Sending..." : "Send"}
            </button>

            {assistantError ? <p className="selected-text assistant-chat-error">{assistantError}</p> : null}
          </div>

          {activeLobby.logs.slice(0, 8).map((log) => (
            <p key={log.id}>{new Date(log.timestamp).toLocaleTimeString()} • {log.text}</p>
          ))}
        </div>
      </aside>
      ) : null}
      {
<IkoPhone 
      isOpen={isIkoOpen}
      onClose={() => setIsIkoOpen(false)}
      bankSellKind={bankSellKind}
      setBankSellKind={setBankSellKind}
      bankBuyKind={bankBuyKind}
      setBankBuyKind={setBankBuyKind}
      bankBulkLots={bankBulkLots}
      setBankBulkLots={setBankBulkLots}
      bankTradeBulkMaxLots={bankTradeBulkMaxLots}
      tradeEnergyCost={tradeEnergyCost}
      openTradeOffersCount={openTradeOffersCount}
      tradeOfferDraft={tradeOfferDraft}
      setTradeOfferDraft={setTradeOfferDraft}
      tradeRequestDraft={tradeRequestDraft}
      setTradeRequestDraft={setTradeRequestDraft}
      onTradeExecute={() => action("game:bank-trade", { sellKind: bankSellKind, buyKind: bankBuyKind, times: bankBulkLots })}
      onBarterCreate={() => action("barter:create", { to: ZERO_ADDRESS, offer: { ...tradeOfferDraft }, request: { ...tradeRequestDraft } })}
      onOpenOffersList={() => setTradeOffersModalOpen(true)}
    />}
      {!isSpectator ? (
        <TradeOffersModal
          open={tradeOffersModalOpen}
          onClose={() => setTradeOffersModalOpen(false)}
          offers={activeLobby.barterOffers}
          currentRoundIndex={tradeRoundIndex}
          viewerAddress={address}
          shortAddr={short}
          acceptPending={pendingAction === "barter:accept"}
          onAccept={async (tradeId) => {
            try {
              await action("barter:accept", { barterId: tradeId });
              setTradeOffersModalOpen(false);
            } catch (e: any) {
              setError(mapGameError(e));
            }
          }}
        />
      ) : null}
      
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
