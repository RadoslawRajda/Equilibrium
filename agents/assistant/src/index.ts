import cors from "cors";
import express from "express";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";
import { createPublicClient, defineChain, http } from "viem";

import { envBool, envNum, envStr, loadDeploymentsWhenReady } from "./config.js";
import { getGameContext } from "./gameContextProvider.js";
import { getAssistantAnswer } from "./assistantResponder.js";

const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

const httpRequestsTotal = new Counter({
  name: "assistant_http_requests_total",
  help: "Total HTTP requests handled by the assistant agent",
  labelNames: ["method", "route", "status"] as const,
  registers: [metricsRegistry]
});

const httpRequestDuration = new Histogram({
  name: "assistant_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route"] as const,
  buckets: [0.05, 0.1, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry]
});

const ollamaRequests = new Counter({
  name: "assistant_ollama_requests_total",
  help: "Total Ollama LLM requests",
  registers: [metricsRegistry]
});

const ollamaErrors = new Counter({
  name: "assistant_ollama_errors_total",
  help: "Total failed Ollama LLM requests",
  registers: [metricsRegistry]
});

const PORT = envNum("PORT", 4060);
const RPC_URL = envStr("RPC_URL", "http://127.0.0.1:8545");
const CONTEXT_TIMEOUT_MS = envNum("CONTEXT_TIMEOUT_MS", 6000);
const ASSISTANT_OLLAMA_URL = envStr(
  "ASSISTANT_OLLAMA_URL",
  envStr("OLLAMA_URL", "http://127.0.0.1:11434")
);
const ASSISTANT_OLLAMA_MODEL = envStr(
  "ASSISTANT_OLLAMA_MODEL",
  envStr("OLLAMA_MODEL", "llama3.2")
);
const INCLUDE_DEBUG_CONTEXT = envBool("ASSISTANT_INCLUDE_DEBUG_CONTEXT", true);

const chain = defineChain({
  id: 1337,
  name: "local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } }
});

function isValidLobbyId(v: unknown): v is string {
  return typeof v === "string" && /^\d+$/.test(v) && Number(v) > 0;
}

function isValidAddress(v: unknown): v is `0x${string}` {
  return typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v);
}

function isValidPrompt(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.trim().length <= 2000;
}

async function main() {
  const deployments = await loadDeploymentsWhenReady();
  const gameCoreAddress = deployments.contracts.GameCore.address;
  const gameCoreAbi = deployments.contracts.GameCore.abi;

  const client = createPublicClient({ chain, transport: http(RPC_URL) });

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      rpcUrl: RPC_URL,
      llmMode: `ollama:${ASSISTANT_OLLAMA_MODEL}`,
      ollamaUrl: ASSISTANT_OLLAMA_URL
    });
  });

  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  });

  app.post("/api/assistant/ask", async (req, res) => {
    const end = httpRequestDuration.startTimer({ method: "POST", route: "/api/assistant/ask" });
    const { lobbyId, playerAddress, prompt } = req.body ?? {};

    if (!isValidLobbyId(lobbyId)) {
      httpRequestsTotal.inc({ method: "POST", route: "/api/assistant/ask", status: "400" });
      end();
      return res.status(400).json({ error: "Invalid lobbyId (expected positive numeric string)" });
    }
    if (!isValidAddress(playerAddress)) {
      httpRequestsTotal.inc({ method: "POST", route: "/api/assistant/ask", status: "400" });
      end();
      return res.status(400).json({ error: "Invalid playerAddress" });
    }
    if (!isValidPrompt(prompt)) {
      httpRequestsTotal.inc({ method: "POST", route: "/api/assistant/ask", status: "400" });
      end();
      return res.status(400).json({ error: "Invalid prompt (1-2000 chars)" });
    }

    try {
      const context = await getGameContext({
        client,
        gameCoreAddress,
        gameCoreAbi,
        lobbyId,
        playerAddress,
        timeoutMs: CONTEXT_TIMEOUT_MS
      });

      ollamaRequests.inc();
      const answer = await getAssistantAnswer({
        prompt: prompt.trim(),
        context,
        ollamaUrl: ASSISTANT_OLLAMA_URL,
        ollamaModel: ASSISTANT_OLLAMA_MODEL
      });

      const contextUsed = INCLUDE_DEBUG_CONTEXT
        ? {
            lobbyId,
            playerAddress: playerAddress.toLowerCase(),
            summaryText: context.summaryText,
            playerPerspective: context.playerPerspective,
            round: context.rawState.round,
            resources: context.rawState.resources
          }
        : undefined;

      httpRequestsTotal.inc({ method: "POST", route: "/api/assistant/ask", status: "200" });
      end();
      return res.json({ answer, contextUsed });
    } catch (err) {
      ollamaErrors.inc();
      const details = err instanceof Error ? err.message : String(err);
      console.error("[assistant-agent] Failed to build answer", {
        lobbyId,
        playerAddress,
        details
      });

      const answer =
        "I cannot answer right now because I could not read game context or reach Ollama. Please try again in a moment and check assistant-agent logs if the issue persists.";

      httpRequestsTotal.inc({ method: "POST", route: "/api/assistant/ask", status: "500" });
      end();
      return res.json({
        answer,
        contextUsed: INCLUDE_DEBUG_CONTEXT ? { lobbyId, playerAddress, error: details } : undefined
      });
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[assistant-agent] http://0.0.0.0:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[assistant-agent] fatal startup error", err);
  process.exit(1);
});
