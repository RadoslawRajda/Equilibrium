import { readFileSync, existsSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";

import { loadDeployments, envStr, envNum } from "./config.js";
import { resolvePromptPath } from "./promptPaths.js";
import { buildSnapshot, trimSnapshotForLlm } from "./snapshot.js";
import { askOllama, askOllamaStartingHex, summarizeActionsForLog } from "./llm.js";
import { mergePlanWithHeuristic } from "./heuristics.js";
import { claimLobbyRewardsIfWinner } from "./rewards.js";
import { executeRoundBatch, pickStartingHex } from "./executor.js";
import { generateTiles } from "./maputil.js";
import {
  buildStartingCandidates,
  deterministicStartingPick,
  normalizeHexId,
  trimStartingCandidatesForLlm
} from "./zeroRound.js";

const POLL_MS = envNum("POLL_MS", 8000);
const RPC_URL = envStr("RPC_URL", "http://127.0.0.1:8545");
const REGISTRY_URL = envStr("REGISTRY_URL", "http://127.0.0.1:4050");
const OLLAMA_URL = envStr("OLLAMA_URL", "http://127.0.0.1:11434");
const OLLAMA_MODEL = envStr("OLLAMA_MODEL", "llama3.2");
const MNEMONIC = envStr(
  "MNEMONIC",
  "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat"
);
const ACCOUNT_INDEX = envNum("AGENT_ACCOUNT_INDEX", 10);
const AGENT_NAME = envStr("AGENT_NAME", "Equinox");
const SNAPSHOT_MAX_TILES = (() => {
  const p = process.env.PLAYER_SNAPSHOT_MAX_TILES;
  if (p != null && p !== "") return envNum("PLAYER_SNAPSHOT_MAX_TILES", 56);
  return envNum("EQUINOX_SNAPSHOT_MAX_TILES", 56);
})();
const ZERO_ROUND_MAX_HEXES = envNum("PLAYER_ZERO_ROUND_MAX_HEXES", 64);
const ZERO_ROUND_MAX_ATTEMPTS = envNum("PLAYER_ZERO_ROUND_MAX_ATTEMPTS", 8);

const chain = defineChain({
  id: 1337,
  name: "local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } }
});

async function registerAgent(address: string) {
  const idP = resolvePromptPath(
    "PLAYER_IDENTITY_PATH",
    "personas/equinox.md",
    "EQUINOX_IDENTITY_PATH"
  );
  const stP = resolvePromptPath(
    "PLAYER_STRATEGY_PATH",
    "skills/strategy.md",
    "EQUINOX_STRATEGY_PATH"
  );
  const personality = [
    existsSync(idP) ? readFileSync(idP, "utf8") : "",
    existsSync(stP) ? readFileSync(stP, "utf8") : ""
  ]
    .join("\n")
    .slice(0, 1500);
  await fetch(`${REGISTRY_URL.replace(/\/$/, "")}/agents/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, name: AGENT_NAME, personality })
  }).catch((e) => console.warn("[player-agent] registry register failed", e));
}

async function fetchInvites(forAddr: string) {
  const u = `${REGISTRY_URL.replace(/\/$/, "")}/invites?for=${encodeURIComponent(forAddr)}`;
  const res = await fetch(u);
  if (!res.ok) return [];
  return (await res.json()) as { lobbyId: string }[];
}

async function consumeInvite(lobbyId: string, targetAddress: string) {
  await fetch(
    `${REGISTRY_URL.replace(/\/$/, "")}/invites/${lobbyId}/${targetAddress}/consume`,
    { method: "POST" }
  ).catch(() => {});
}

async function main() {
  const dep = loadDeployments();
  const lm = dep.contracts.LobbyManager.address;
  const gc = dep.contracts.GameCore.address;
  const lmAbi = dep.contracts.LobbyManager.abi;
  const gcAbi = dep.contracts.GameCore.abi;

  const account = mnemonicToAccount(MNEMONIC, {
    path: `m/44'/60'/0'/0/${ACCOUNT_INDEX}`
  });

  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL)
  });

  console.log(`[player-agent] ${AGENT_NAME} wallet ${account.address} (index ${ACCOUNT_INDEX})`);
  await registerAgent(account.address);

  /** Avoids repeat `joinLobby` txs each poll (join is on-chain noop but still logs/spams gas). */
  const gcJoinAttempted = new Set<string>();

  const ensureTicketAndJoin = async (lobbyIdStr: string) => {
    const lobbyId = BigInt(lobbyIdStr);
    const players = (await publicClient.readContract({
      address: gc,
      abi: gcAbi,
      functionName: "getLobbyPlayers",
      args: [lobbyId]
    })) as `0x${string}`[];
    if (players.some((p) => p.toLowerCase() === account.address.toLowerCase())) {
      gcJoinAttempted.add(lobbyIdStr);
      return;
    }

    const ticketPrice = (await publicClient.readContract({
      address: lm,
      abi: lmAbi,
      functionName: "TICKET_PRICE"
    })) as bigint;

    const hasT = (await publicClient.readContract({
      address: lm,
      abi: lmAbi,
      functionName: "hasTicket",
      args: [lobbyId, account.address]
    })) as boolean;

    if (!hasT) {
      try {
        const h = await walletClient.writeContract({
          address: lm,
          abi: lmAbi,
          functionName: "buyTicket",
          args: [lobbyId],
          value: ticketPrice,
          chain,
          account: account.address
        } as never);
        await publicClient.waitForTransactionReceipt({ hash: h });
        console.log(`[player-agent] bought ticket lobby ${lobbyIdStr}`);
      } catch (e) {
        console.warn(
          `[player-agent] buyTicket failed lobby ${lobbyIdStr} (lobby full or RPC error); cannot join without ticket`,
          e
        );
        return;
      }
    }

    if (gcJoinAttempted.has(lobbyIdStr)) {
      return;
    }

    const h2 = await walletClient.writeContract({
      address: gc,
      abi: gcAbi,
      functionName: "joinLobby",
      args: [lobbyId],
      chain,
      account: account.address
    });
    await publicClient.waitForTransactionReceipt({ hash: h2 });
    gcJoinAttempted.add(lobbyIdStr);
    console.log(`[player-agent] joinLobby ok lobby ${lobbyIdStr}`);
  };

  const processInvite = async (lobbyIdStr: string) => {
    await ensureTicketAndJoin(lobbyIdStr);
    await consumeInvite(lobbyIdStr, account.address);
  };

  const playLobby = async (lobbyIdStr: string) => {
    const lobbyId = BigInt(lobbyIdStr);
    const players = (await publicClient.readContract({
      address: gc,
      abi: gcAbi,
      functionName: "getLobbyPlayers",
      args: [lobbyId]
    })) as `0x${string}`[];
    if (!players.some((p) => p.toLowerCase() === account.address.toLowerCase())) {
      return;
    }

    const mapConfig = (await publicClient.readContract({
      address: gc,
      abi: gcAbi,
      functionName: "getMapConfig",
      args: [lobbyId]
    })) as readonly [bigint, number];
    const seed = mapConfig[0];
    const radius = Number(mapConfig[1]);
    const tiles = generateTiles(seed, radius);
    const tileIds = tiles.map((t) => t.id);

    const round = (await publicClient.readContract({
      address: gc,
      abi: gcAbi,
      functionName: "getLobbyRound",
      args: [lobbyId]
    })) as readonly bigint[];
    const status = Number(round[3] ?? 0n);

    if (status === 1) {
      const owned = (await publicClient.readContract({
        address: gc,
        abi: gcAbi,
        functionName: "getPlayerOwnedHexCount",
        args: [lobbyId, account.address]
      })) as bigint;
      if (owned !== 0n) {
        return;
      }

      const excluded = new Set<string>();
      for (let attempt = 0; attempt < ZERO_ROUND_MAX_ATTEMPTS; attempt += 1) {
        const candidates = await buildStartingCandidates(publicClient, gc, gcAbi, lobbyId, tiles);
        const avail = candidates.filter((c) => !excluded.has(c.id));
        if (avail.length === 0) {
          console.warn(`[player-agent] no free starting hex lobby ${lobbyIdStr}`);
          return;
        }

        const forLlm = trimStartingCandidatesForLlm(avail, ZERO_ROUND_MAX_HEXES);
        const strictSubset = avail.length > forLlm.length;
        const payload = {
          phase: "zeroRoundPick",
          lobbyId: Number(lobbyId),
          zeroRoundEndsAt: Number(round[2] ?? 0n),
          candidateHexes: forLlm,
          ...(excluded.size ? { excludedHexIds: [...excluded] } : {}),
          pickRule: strictSubset
            ? "You MUST choose hexId from candidateHexes only (other free hexes exist but were omitted from this list)."
            : "Choose hexId from candidateHexes."
        };

        let chosen: { id: string; q: number; r: number } | null = null;
        let thought = "";

        try {
          const parsed = await askOllamaStartingHex(OLLAMA_URL, OLLAMA_MODEL, JSON.stringify(payload));
          if (parsed) {
            const hid = normalizeHexId(parsed.hexId);
            const inAvail = avail.some((c) => c.id === hid);
            const inLlm = forLlm.some((c) => c.id === hid);
            if (inAvail && (!strictSubset || inLlm)) {
              const t = avail.find((c) => c.id === hid)!;
              chosen = { id: t.id, q: t.q, r: t.r };
              thought = parsed.thought;
            }
          }
        } catch (e) {
          console.warn("[player-agent] zero-round Ollama error", e);
        }

        if (!chosen) {
          const fb = deterministicStartingPick(avail, account.address, lobbyIdStr, attempt);
          chosen = { id: fb.id, q: fb.q, r: fb.r };
          thought = `(fallback) ${thought || "no valid LLM pick"}`;
        }

        try {
          await pickStartingHex(
            walletClient,
            publicClient,
            gc,
            gcAbi,
            lobbyId,
            chosen.id,
            chosen.q,
            chosen.r,
            chain,
            account.address
          );
          console.log(`[player-agent] zero-round hex ${chosen.id} lobby ${lobbyIdStr} — ${thought}`);
          break;
        } catch (e) {
          excluded.add(chosen.id);
          console.warn(
            `[player-agent] pickStartingHex ${chosen.id} failed (often already taken), retrying`,
            e
          );
        }
      }
      return;
    }

    if (status !== 2) return;

    const snap = trimSnapshotForLlm(
      await buildSnapshot(publicClient, gc, gcAbi, lobbyId, account.address, tileIds),
      SNAPSHOT_MAX_TILES
    );
    const user = JSON.stringify(snap);
    let plan;
    try {
      plan = await askOllama(OLLAMA_URL, OLLAMA_MODEL, user);
    } catch (e) {
      console.warn("[player-agent] Ollama failed, noop", e);
      plan = { thought: "ollama-down", actions: [{ type: "noop" }] };
    }
    const merged = mergePlanWithHeuristic(snap, plan);
    const act = summarizeActionsForLog(merged.actions);
    console.log(`[player-agent] round lobby ${lobbyIdStr} — ${merged.thought} · ${act}`);
    await executeRoundBatch(walletClient, publicClient, gc, gcAbi, lobbyId, merged, chain, account.address);
  };

  for (;;) {
    try {
      const invites = await fetchInvites(account.address);
      const inviteLobbyIds = [...new Set(invites.map((i) => i.lobbyId).filter(Boolean))] as string[];
      for (const lid of inviteLobbyIds) {
        await processInvite(lid);
      }

      const lobbyCount = Number(
        (await publicClient.readContract({
          address: lm,
          abi: lmAbi,
          functionName: "getLobbyCount"
        })) as bigint
      );

      for (let i = 1; i <= lobbyCount; i += 1) {
        const lobbyId = BigInt(i);
        const hasT = (await publicClient.readContract({
          address: lm,
          abi: lmAbi,
          functionName: "hasTicket",
          args: [lobbyId, account.address]
        })) as boolean;
        if (!hasT) continue;
        await claimLobbyRewardsIfWinner(
          walletClient,
          publicClient,
          lm,
          lmAbi,
          String(i),
          account.address,
          chain
        );
        await ensureTicketAndJoin(String(i));
        await playLobby(String(i));
      }
    } catch (e) {
      console.error("[player-agent] loop error", e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
