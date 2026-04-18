import { readFileSync, existsSync } from "node:fs";
import { type PublicClient, createPublicClient, createWalletClient, defineChain, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";

import { loadDeployments, loadDeploymentsWhenReady, envStr, envNum } from "./config.js";
import { resolvePromptPath } from "./promptPaths.js";
import {
  activeLobbies,
  ollamaErrors,
  ollamaRequests,
  pollTotal,
  startMetricsServer,
  txErrors,
  txTotal
} from "./metrics.js";
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
const OLLAMA_URL = envStr("OLLAMA_URL", "http://127.0.0.1:11434");
const OLLAMA_MODEL = envStr("OLLAMA_MODEL", "llama3.2");
const MNEMONIC = envStr(
  "MNEMONIC",
  "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat"
);
const ACCOUNT_INDEX = envNum("AGENT_ACCOUNT_INDEX", 10);
const AGENT_NAME = envStr("AGENT_NAME", "Equinox");
const METRICS_PORT = envNum("METRICS_PORT", 9100);
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

async function waitUntilBytecode(
  publicClient: PublicClient,
  label: string,
  address: `0x${string}`,
  maxWaitMs = 180_000,
  pollMs = 2000
) {
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    const code = await publicClient.getBytecode({ address });
    if (code && code !== "0x") {
      return;
    }
    attempt += 1;
    if (attempt === 1 || attempt % 5 === 0) {
      console.warn(
        `[player-agent] ${label} ${address} — no bytecode on ${RPC_URL} (chain id ${chain.id}); ` +
          `Hardhat may not have deployed yet, or Anvil was reset while localhost.json still has old addresses (attempt ${attempt})`
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `[player-agent] ${label} at ${address}: no contract code on ${RPC_URL} after ${maxWaitMs}ms. ` +
      "Redeploy to this node and refresh deployments/localhost.json (docker: let the hardhat service finish deploy)."
  );
}

async function main() {
  startMetricsServer(METRICS_PORT);

  let dep;
  if (process.env.PLAYER_SKIP_ERC8004_REGISTRY_WAIT === "1") {
    dep = loadDeployments();
  } else {
    console.log("[player-agent] waiting for deployments (including ERC8004PlayerAgentRegistry)…");
    dep = await loadDeploymentsWhenReady();
  }
  const lm = dep.contracts.LobbyManager.address;
  const gc = dep.contracts.GameCore.address;
  const lmAbi = dep.contracts.LobbyManager.abi;
  const gcAbi = dep.contracts.GameCore.abi;
  const onChainAgentRegistry = dep.contracts.ERC8004PlayerAgentRegistry;

  const account = mnemonicToAccount(MNEMONIC, {
    path: `m/44'/60'/0'/0/${ACCOUNT_INDEX}`
  });

  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL)
  });

  await waitUntilBytecode(publicClient, "LobbyManager", lm);
  await waitUntilBytecode(publicClient, "GameCore", gc);
  if (onChainAgentRegistry) {
    await waitUntilBytecode(publicClient, "ERC8004PlayerAgentRegistry", onChainAgentRegistry.address);
  }

  const ensureOnChainAgentIdentity = async (): Promise<`0x${string}` | undefined> => {
    if (!onChainAgentRegistry) {
      console.warn("[player-agent] ERC8004PlayerAgentRegistry missing in deployments; skipping on-chain agent identity");
      return undefined;
    }
    const registryAddress = onChainAgentRegistry.address;
    const registryAbi = onChainAgentRegistry.abi;

    const current = (await publicClient.readContract({
      address: registryAddress,
      abi: registryAbi,
      functionName: "getAgentByController",
      args: [account.address]
    })) as `0x${string}`;
    const zero = "0x0000000000000000000000000000000000000000";
    if (current && current.toLowerCase() !== zero) {
      return current;
    }

    const metadataUri = `agent://${AGENT_NAME.toLowerCase()}/${ACCOUNT_INDEX}`;
    let txHash: `0x${string}`;
    try {
      txHash = await walletClient.writeContract({
        address: registryAddress,
        abi: registryAbi,
        functionName: "createAndRegisterAgent",
        args: [AGENT_NAME, metadataUri],
        chain,
        account: account.address
      } as never);
    } catch (e) {
      console.error(
        "[player-agent] createAndRegisterAgent tx failed (revert, wrong chain, or insufficient ETH for identity deploy)",
        e
      );
      throw e;
    }
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    const created = (await publicClient.readContract({
      address: registryAddress,
      abi: registryAbi,
      functionName: "getAgentByController",
      args: [account.address]
    })) as `0x${string}`;
    if (!created || created.toLowerCase() === zero) {
      throw new Error("On-chain agent registration did not persist");
    }
    try {
      const count = (await publicClient.readContract({
        address: registryAddress,
        abi: registryAbi,
        functionName: "getAgentCount"
      })) as bigint;
      console.log(`[player-agent] ERC8004 registry total agents (getAgentCount): ${count}`);
    } catch {
      /* optional */
    }
    return created;
  };

  console.log(`[player-agent] ${AGENT_NAME} wallet ${account.address} (index ${ACCOUNT_INDEX})`);
  const onChainAgentAddress = await ensureOnChainAgentIdentity();
  if (onChainAgentAddress) {
    console.log(`[player-agent] ${AGENT_NAME} on-chain ERC8004 agent ${onChainAgentAddress}`);
  }

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
        txTotal.inc({ agent: AGENT_NAME, type: "buyTicket" });
        console.log(`[player-agent] bought ticket lobby ${lobbyIdStr}`);
      } catch (e) {
        txErrors.inc({ agent: AGENT_NAME, type: "buyTicket" });
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
    txTotal.inc({ agent: AGENT_NAME, type: "joinLobby" });
    gcJoinAttempted.add(lobbyIdStr);
    console.log(`[player-agent] joinLobby ok lobby ${lobbyIdStr}`);
  };

  const processInvite = async (lobbyIdStr: string) => {
    await ensureTicketAndJoin(lobbyIdStr);
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
          ollamaRequests.inc({ agent: AGENT_NAME });
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
          ollamaErrors.inc({ agent: AGENT_NAME });
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
          txTotal.inc({ agent: AGENT_NAME, type: "pickStartingHex" });
          console.log(`[player-agent] zero-round hex ${chosen.id} lobby ${lobbyIdStr} — ${thought}`);
          break;
        } catch (e) {
          txErrors.inc({ agent: AGENT_NAME, type: "pickStartingHex" });
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
      ollamaRequests.inc({ agent: AGENT_NAME });
      plan = await askOllama(OLLAMA_URL, OLLAMA_MODEL, user);
    } catch (e) {
      ollamaErrors.inc({ agent: AGENT_NAME });
      console.warn("[player-agent] Ollama failed, noop", e);
      plan = { thought: "ollama-down", actions: [{ type: "noop" }] };
    }
    const merged = mergePlanWithHeuristic(snap, plan);
    const act = summarizeActionsForLog(merged.actions);
    console.log(`[player-agent] round lobby ${lobbyIdStr} — ${merged.thought} · ${act}`);
    await executeRoundBatch(walletClient, publicClient, gc, gcAbi, lobbyId, merged, chain, account.address);
    txTotal.inc({ agent: AGENT_NAME, type: "roundBatch" });
  };

  for (;;) {
    try {
      pollTotal.inc({ agent: AGENT_NAME });
      const lobbyCount = Number(
        (await publicClient.readContract({
          address: lm,
          abi: lmAbi,
          functionName: "getLobbyCount"
        })) as bigint
      );

      let ticketedLobbies = 0;
      for (let i = 1; i <= lobbyCount; i += 1) {
        const invited = (await publicClient.readContract({
          address: lm,
          abi: lmAbi,
          functionName: "getLobbyAgentInvite",
          args: [BigInt(i), account.address]
        })) as boolean;
        if (invited) {
          await processInvite(String(i));
        }

        const lobbyId = BigInt(i);
        const hasT = (await publicClient.readContract({
          address: lm,
          abi: lmAbi,
          functionName: "hasTicket",
          args: [lobbyId, account.address]
        })) as boolean;
        if (!hasT) continue;
        ticketedLobbies += 1;
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
      activeLobbies.set({ agent: AGENT_NAME }, ticketedLobbies);
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
