import { createServer } from "node:http";
import { collectDefaultMetrics, Counter, Gauge, Registry } from "prom-client";

export const register = new Registry();

collectDefaultMetrics({ register });

export const pollTotal = new Counter({
  name: "player_agent_poll_iterations_total",
  help: "Total poll loop iterations",
  labelNames: ["agent"] as const,
  registers: [register]
});

export const txTotal = new Counter({
  name: "player_agent_transactions_total",
  help: "Total on-chain transactions sent",
  labelNames: ["agent", "type"] as const,
  registers: [register]
});

export const txErrors = new Counter({
  name: "player_agent_transaction_errors_total",
  help: "Total on-chain transaction failures",
  labelNames: ["agent", "type"] as const,
  registers: [register]
});

export const ollamaRequests = new Counter({
  name: "player_agent_ollama_requests_total",
  help: "Total LLM requests sent to Ollama",
  labelNames: ["agent"] as const,
  registers: [register]
});

export const ollamaErrors = new Counter({
  name: "player_agent_ollama_errors_total",
  help: "Total Ollama request failures",
  labelNames: ["agent"] as const,
  registers: [register]
});

export const activeLobbies = new Gauge({
  name: "player_agent_active_lobbies",
  help: "Number of lobbies the agent currently holds a ticket for",
  labelNames: ["agent"] as const,
  registers: [register]
});

export function startMetricsServer(port: number): void {
  const server = createServer(async (_req, res) => {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`[player-agent] metrics http://0.0.0.0:${port}/metrics`);
  });
}
