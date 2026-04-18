import { motion } from "framer-motion";
import { ArrowLeft, Trophy, Wallet, LogOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePublicClient, useAccount, useDisconnect } from "wagmi";

import abi from "../abi/localhost.json";

type ExperienceLeaderboardEntry = {
  player: string;
  experiencePoints: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesLeft: number;
  lastLobbyId: number;
  active: boolean;
};

const FETCH_CHUNK_SIZE = 100;
const TOP_LIMIT = 50;

type GameCompletedEvent = {
  args?: {
    lobbyId?: bigint | number;
    winner?: `0x${string}`;
  } & readonly unknown[];
};

type ContractsMeta = {
  contracts?: {
    LobbyManager?: {
      address: `0x${string}`;
      abi: any[];
    };
    ExperienceStats?: {
      address: `0x${string}`;
      abi: any[];
    };
    GameCore?: {
      address: `0x${string}`;
      abi: any[];
    };
  };
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const EXPERIENCE_STATS_MIN_ABI = [
  {
    inputs: [],
    name: "getPlayerCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "uint256", name: "offset", type: "uint256" },
      { internalType: "uint256", name: "max", type: "uint256" }
    ],
    name: "listPlayers",
    outputs: [
      {
        components: [
          { internalType: "address", name: "player", type: "address" },
          { internalType: "uint256", name: "experiencePoints", type: "uint256" },
          { internalType: "uint256", name: "gamesPlayed", type: "uint256" },
          { internalType: "uint256", name: "gamesWon", type: "uint256" },
          { internalType: "uint256", name: "gamesLeft", type: "uint256" },
          { internalType: "uint256", name: "lastLobbyId", type: "uint256" },
          { internalType: "uint256", name: "firstSeenAt", type: "uint256" },
          { internalType: "bool", name: "active", type: "bool" }
        ],
        internalType: "struct ExperienceStats.ListedPlayerStats[]",
        name: "",
        type: "tuple[]"
      }
    ],
    stateMutability: "view",
    type: "function"
  }
] as const;

const LOBBY_MANAGER_MIN_ABI = [
  {
    inputs: [],
    name: "experienceStatsRegistry",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "_lobbyId", type: "uint256" }],
    name: "getLobbyPlayers",
    outputs: [{ internalType: "address[]", name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

const LOBBY_MANAGER_EVENTS_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "lobbyId", type: "uint256" },
      { indexed: true, internalType: "address", name: "winner", type: "address" },
      { indexed: false, internalType: "uint256", name: "prizeAmount", type: "uint256" }
    ],
    name: "GameCompleted",
    type: "event"
  }
] as const;

function summarizeCompletedGames(events: GameCompletedEvent[]): ExperienceLeaderboardEntry[] {
  const aggregated = new Map<string, ExperienceLeaderboardEntry>();

  for (const event of events) {
    const winner = event.args?.winner;
    if (!winner || winner.toLowerCase() === ZERO_ADDRESS) {
      continue;
    }

    const lobbyId = Number(event.args?.lobbyId ?? 0);
    const existing = aggregated.get(winner) ?? {
      player: winner,
      experiencePoints: 0,
      gamesPlayed: 0,
      gamesWon: 0,
      gamesLeft: 0,
      lastLobbyId: 0,
      active: true
    };

    existing.gamesPlayed += 1;
    existing.gamesWon += 1;
    existing.experiencePoints += 10;
    existing.lastLobbyId = lobbyId;
    aggregated.set(winner, existing);
  }

  return Array.from(aggregated.values())
    .sort((a, b) => b.experiencePoints - a.experiencePoints || b.gamesWon - a.gamesWon)
    .slice(0, TOP_LIMIT);
}

function mapContractReadError(error: unknown): string {
  const fallback = "Could not load leaderboard data from chain.";
  if (!error) return fallback;
  const text = String(error).toLowerCase();

  if (text.includes("wallet rpc client unavailable")) {
    return "Wallet RPC client unavailable.";
  }
  if (text.includes("missing") && text.includes("experience")) {
    return "ExperienceStats contract is not configured for this network.";
  }
  if (text.includes("no bytecode") || text.includes("execution reverted") || text.includes("contractfunctionexecutionerror")) {
    return "Contract is not deployed on the connected network. Redeploy and sync ABI.";
  }
  if (text.includes("network") || text.includes("chain") || text.includes("transport") || text.includes("fetch")) {
    return "Network/RPC connection issue while loading leaderboard.";
  }
  if (text.includes("winner must be in players")) {
    return "On-chain data validation failed: winner must be part of lobby players.";
  }
  if (text.includes("lobby result already recorded")) {
    return "Lobby result for this match was already recorded.";
  }
  if (text.includes("only stats updater")) {
    return "Experience stats updater permissions are not configured correctly.";
  }
  if (text.includes("updater address required") || text.includes("registry address required")) {
    return "Experience stats registry/updater address is not configured.";
  }

  return error instanceof Error && error.message ? error.message : fallback;
}

async function summarizeCompletedGamesWithPlayers(args: {
  events: GameCompletedEvent[];
  publicClient: any;
  lobbyManagerAddress: `0x${string}`;
  lobbyManagerAbi?: any[];
  gameCoreAddress?: `0x${string}`;
  gameCoreAbi?: any[];
}): Promise<ExperienceLeaderboardEntry[]> {
  const { events, publicClient, lobbyManagerAddress, lobbyManagerAbi, gameCoreAddress, gameCoreAbi } = args;
  const aggregated = new Map<string, ExperienceLeaderboardEntry>();

  for (const event of events) {
    const lobbyId = Number(event.args?.lobbyId ?? 0);
    if (!Number.isFinite(lobbyId) || lobbyId <= 0) {
      continue;
    }

    const winner = event.args?.winner?.toLowerCase() ?? ZERO_ADDRESS;
    let roster: string[] = [];

    try {
      const rawRoster = (await publicClient.readContract({
        address: lobbyManagerAddress,
        abi:
          lobbyManagerAbi && lobbyManagerAbi.length > 0
            ? lobbyManagerAbi
            : LOBBY_MANAGER_MIN_ABI,
        functionName: "getLobbyPlayers",
        args: [BigInt(lobbyId)]
      } as any)) as string[];
      roster = Array.isArray(rawRoster) ? rawRoster : [];
    } catch {
      roster = [];
    }

    const uniquePlayers = new Set(
      roster
        .filter((player) => /^0x[a-fA-F0-9]{40}$/.test(player))
        .map((player) => player.toLowerCase())
    );

    if (uniquePlayers.size === 0) {
      if (winner === ZERO_ADDRESS) {
        continue;
      }
      uniquePlayers.add(winner);
    }

    for (const player of uniquePlayers) {
      const existing = aggregated.get(player) ?? {
        player,
        experiencePoints: 0,
        gamesPlayed: 0,
        gamesWon: 0,
        gamesLeft: 0,
        lastLobbyId: 0,
        active: true
      };

      existing.lastLobbyId = lobbyId;

      if (winner !== ZERO_ADDRESS && player === winner) {
        existing.gamesPlayed += 1;
        existing.gamesWon += 1;
        existing.experiencePoints += 10;
      } else {
        let finished = true;
        if (gameCoreAddress) {
          try {
            const alive = (await publicClient.readContract({
              address: gameCoreAddress,
              abi:
                gameCoreAbi && gameCoreAbi.length > 0
                  ? gameCoreAbi
                  : [
                      {
                        inputs: [
                          { internalType: "uint256", name: "lobbyId", type: "uint256" },
                          { internalType: "address", name: "player", type: "address" }
                        ],
                        name: "isPlayerAlive",
                        outputs: [{ internalType: "bool", name: "", type: "bool" }],
                        stateMutability: "view",
                        type: "function"
                      }
                    ],
              functionName: "isPlayerAlive",
              args: [BigInt(lobbyId), player as `0x${string}`]
            } as any)) as boolean;
            finished = Boolean(alive);
          } catch {
            finished = true;
          }
        }
        if (finished) {
          existing.gamesPlayed += 1;
          existing.experiencePoints += 1;
        }
      }

      aggregated.set(player, existing);
    }
  }

  return Array.from(aggregated.values()).sort(
    (a, b) => b.experiencePoints - a.experiencePoints || b.gamesWon - a.gamesWon
  ).slice(0, TOP_LIMIT);
}

function parseExperienceRows(raw: unknown): ExperienceLeaderboardEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ExperienceLeaderboardEntry[] = [];
  const asAddr = (value: unknown) => (typeof value === "string" ? value : String(value ?? ""));

  for (const row of raw) {
    try {
      if (Array.isArray(row) && row.length >= 8) {
        const player = asAddr(row[0]);
        if (!/^0x[a-fA-F0-9]{40}$/.test(player)) continue;
        out.push({
          player,
          experiencePoints: Number(row[1] ?? 0),
          gamesPlayed: Number(row[2] ?? 0),
          gamesWon: Number(row[3] ?? 0),
          gamesLeft: Number(row[4] ?? 0),
          lastLobbyId: Number(row[5] ?? 0),
          active: Boolean(row[7])
        });
        continue;
      }
      if (row && typeof row === "object") {
        const entry = row as Record<string, unknown>;
        const player = asAddr(entry.player);
        if (!/^0x[a-fA-F0-9]{40}$/.test(player)) continue;
        out.push({
          player,
          experiencePoints: Number(entry.experiencePoints ?? 0),
          gamesPlayed: Number(entry.gamesPlayed ?? 0),
          gamesWon: Number(entry.gamesWon ?? 0),
          gamesLeft: Number(entry.gamesLeft ?? 0),
          lastLobbyId: Number(entry.lastLobbyId ?? 0),
          active: Boolean(entry.active)
        });
      }
    } catch (e) {
      // Skip malformed entries
      console.warn("Failed to parse leaderboard entry:", row, e);
      continue;
    }
  }

  return out;
}

export function LeaderboardPage() {
  const navigate = useNavigate();
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const contracts = abi as ContractsMeta;
  const lobbyManagerAddress = contracts.contracts?.LobbyManager?.address;
  const lobbyManagerAbi = contracts.contracts?.LobbyManager?.abi;
  const deployedExperienceStatsAddress = contracts.contracts?.ExperienceStats?.address;
  const deployedExperienceStatsAbi = contracts.contracts?.ExperienceStats?.abi;
  const gameCoreAddress = contracts.contracts?.GameCore?.address;
  const gameCoreAbi = contracts.contracts?.GameCore?.abi;

  const [entries, setEntries] = useState<ExperienceLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadLeaderboard = async () => {
      if (!publicClient) {
        setEntries([]);
        setError("Wallet RPC client unavailable.");
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        let resolvedExperienceStatsAddress = deployedExperienceStatsAddress;
        const resolvedExperienceStatsAbi =
          deployedExperienceStatsAbi && deployedExperienceStatsAbi.length > 0
            ? deployedExperienceStatsAbi
            : EXPERIENCE_STATS_MIN_ABI;

        if (lobbyManagerAddress) {
          try {
            const fromLobbyManager = (await publicClient.readContract({
              address: lobbyManagerAddress,
              abi:
                lobbyManagerAbi && lobbyManagerAbi.length > 0
                  ? lobbyManagerAbi
                  : LOBBY_MANAGER_MIN_ABI,
              functionName: "experienceStatsRegistry"
            } as any)) as `0x${string}`;
            if (fromLobbyManager && fromLobbyManager.toLowerCase() !== ZERO_ADDRESS) {
              resolvedExperienceStatsAddress = fromLobbyManager;
            }
          } catch {
            // Ignore lookup issues and fall back to deployment metadata.
          }
        }

        let parsed: ExperienceLeaderboardEntry[] = [];

        if (resolvedExperienceStatsAddress && resolvedExperienceStatsAddress.toLowerCase() !== ZERO_ADDRESS) {
          const countResult = await publicClient.readContract({
            address: resolvedExperienceStatsAddress,
            abi: resolvedExperienceStatsAbi,
            functionName: "getPlayerCount"
          } as any);

          const count = Number(countResult || 0n);

          if (count > 0) {
            const rows: ExperienceLeaderboardEntry[] = [];
            let offset = 0;
            while (offset < count) {
              const chunkSize = Math.min(FETCH_CHUNK_SIZE, count - offset);
              const raw = await publicClient.readContract({
                address: resolvedExperienceStatsAddress,
                abi: resolvedExperienceStatsAbi,
                functionName: "listPlayers",
                args: [BigInt(offset), BigInt(chunkSize)]
              } as any);
              rows.push(...parseExperienceRows(raw));
              offset += chunkSize;
            }
            parsed = rows
              .sort((a, b) => b.experiencePoints - a.experiencePoints || b.gamesWon - a.gamesWon)
              .slice(0, TOP_LIMIT);
          }
        }

        if (parsed.length === 0 && lobbyManagerAddress) {
          const completedGames = (await publicClient.getContractEvents({
            address: lobbyManagerAddress,
            abi: LOBBY_MANAGER_EVENTS_ABI,
            eventName: "GameCompleted",
            fromBlock: 0n,
            toBlock: "latest"
          } as any)) as GameCompletedEvent[];

          parsed = await summarizeCompletedGamesWithPlayers({
            events: completedGames,
            publicClient,
            lobbyManagerAddress,
            lobbyManagerAbi,
            gameCoreAddress,
            gameCoreAbi
          });

          if (parsed.length === 0) {
            parsed = summarizeCompletedGames(completedGames);
          }
        }

        if (!cancelled) {
          setEntries(parsed);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setEntries([]);
          setError(mapContractReadError(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadLeaderboard();
    const timer = window.setInterval(() => void loadLeaderboard(), 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [deployedExperienceStatsAddress, deployedExperienceStatsAbi, lobbyManagerAddress, lobbyManagerAbi, gameCoreAddress, gameCoreAbi, publicClient]);

  const entryCountLabel = useMemo(
    () => `Top ${Math.min(TOP_LIMIT, entries.length)}${entries.length >= TOP_LIMIT ? ` of ${TOP_LIMIT}` : ""}`,
    [entries.length]
  );

  return (
    <div className="lobby-shell">
      <header className="lobby-header">
        <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", marginBottom: "0.75rem" }}>
          <motion.button type="button" whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.04 }} onClick={() => navigate("/")}>
            <ArrowLeft size={16} /> Back to lobby
          </motion.button>
        </div>
        <h1>Equilibrium</h1>
        <p>Player Experience Leaderboard</p>
      </header>

      <div className="wallet-strip">
        <Wallet size={18} />
        <span>{address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "No wallet connected"}</span>
        <button onClick={() => disconnect()}>
          <LogOut size={16} /> Disconnect
        </button>
      </div>

      <section className="lobby-actions leaderboard-actions">
        <div className="selected-text leaderboard-note">
          <Trophy size={18} /> XP ranking is based on lobby results and leave penalties.
        </div>
      </section>

      <section className="lobby-list">
        <div className="leaderboard-toolbar">
          <h2>Leaderboard</h2>
          {!loading && !error && entries.length > 0 ? (
            <span className="selected-text leaderboard-count">{entryCountLabel}</span>
          ) : null}
        </div>
        {loading ? <p>Loading leaderboard...</p> : null}
        {error ? <p className="error-banner">{error}</p> : null}
        {!loading && !error && entries.length === 0 ? (
          <div className="leaderboard-empty">
            <div className="leaderboard-empty-title">
              <Trophy size={17} />
              <strong>Leaderboard is waiting for first results</strong>
            </div>
            <p className="selected-text">
              Play and finish a match to populate the ranking. Winners get +10 XP, finishing non-winners get +1 XP.
            </p>
          </div>
        ) : null}
        {!loading && !error && entries.length > 0 ? (
            <div className="leaderboard-table-wrap">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Address</th>
                    <th>XP</th>
                    <th>Games Played</th>
                    <th>Games Won</th>
                    <th>Games Abandoned</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, index) => (
                    <motion.tr key={entry.player} whileHover={{ y: -1 }}>
                      <td>{index + 1}</td>
                      <td title={entry.player}>
                        {entry.player.slice(0, 6)}...{entry.player.slice(-4)}
                      </td>
                      <td>{entry.experiencePoints}</td>
                      <td>{entry.gamesPlayed}</td>
                      <td>{entry.gamesWon}</td>
                      <td>{entry.gamesLeft}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
        ) : null}
      </section>
    </div>
  );
}
