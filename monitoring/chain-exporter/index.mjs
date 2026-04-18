/**
 * chain-exporter: polls on-chain state (Anvil/Ganache + deployed contracts)
 * and exposes Prometheus metrics on port 9100.
 *
 * Metrics exposed:
 *   chain_head_block_number          – current block number
 *   chain_head_block_timestamp       – Unix timestamp of the latest block
 *   account_balance_eth{address,name} – ETH balance of each monitored account
 *   lobbymanager_lobby_count          – total lobbies ever created
 *   lobbymanager_lobby_status{lobby_id,status} – 0=Waiting 1=ZeroRound 2=Active 3=Ended
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createPublicClient, defineChain, http, formatEther } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { collectDefaultMetrics, Gauge, Registry } from "prom-client";

const PORT = Number(process.env.PORT ?? 9100);
const RPC_URL = process.env.RPC_URL ?? "http://ganache:8545";
const DEPLOYMENTS_PATH = process.env.DEPLOYMENTS_PATH ?? "/contracts/deployments/localhost.json";
const POLL_MS = Number(process.env.POLL_MS ?? 10000);
const MNEMONIC =
  process.env.MNEMONIC ??
  "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat";

// ---------------------------------------------------------------------------
// Prometheus registry
// ---------------------------------------------------------------------------
const register = new Registry();
collectDefaultMetrics({ register });

const headBlock = new Gauge({
  name: "chain_head_block_number",
  help: "Current head block number",
  registers: [register]
});

const headTimestamp = new Gauge({
  name: "chain_head_block_timestamp",
  help: "Unix timestamp of the current head block",
  registers: [register]
});

const accountBalance = new Gauge({
  name: "account_balance_eth",
  help: "ETH balance of a monitored account",
  labelNames: ["address", "name"],
  registers: [register]
});

const lobbyCount = new Gauge({
  name: "lobbymanager_lobby_count",
  help: "Total number of lobbies created in LobbyManager",
  registers: [register]
});

const lobbyStatus = new Gauge({
  name: "lobbymanager_lobby_status",
  help: "Status of a specific lobby (0=Waiting 1=ZeroRound 2=Active 3=Ended)",
  labelNames: ["lobby_id", "status"],
  registers: [register]
});

// ---------------------------------------------------------------------------
// Blockchain client
// ---------------------------------------------------------------------------
const chain = defineChain({
  id: 1337,
  name: "local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } }
});

const client = createPublicClient({ chain, transport: http(RPC_URL) });

// Build list of accounts to monitor (indices 0-13, same mnemonic as other services)
const ACCOUNT_NAMES = {
  0: "deployer",
  1: "treasury",
  10: "equinox",
  11: "aurora",
  12: "crucible",
  13: "drift"
};
const monitoredAccounts = Object.entries(ACCOUNT_NAMES).map(([idx, name]) => ({
  address: mnemonicToAccount(MNEMONIC, { path: `m/44'/60'/0'/0/${idx}` }).address,
  name
}));

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------
async function poll() {
  try {
    // --- Head block ---
    const block = await client.getBlock();
    headBlock.set(Number(block.number));
    headTimestamp.set(Number(block.timestamp));
  } catch (e) {
    console.warn("[chain-exporter] getBlock failed", e?.message ?? e);
  }

  // --- Account balances ---
  for (const { address, name } of monitoredAccounts) {
    try {
      const bal = await client.getBalance({ address });
      accountBalance.set({ address: address.toLowerCase(), name }, Number(formatEther(bal)));
    } catch (e) {
      console.warn(`[chain-exporter] getBalance(${name}) failed`, e?.message ?? e);
    }
  }

  // --- Contract state ---
  if (!existsSync(DEPLOYMENTS_PATH)) return;
  let dep;
  try {
    dep = JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8"));
  } catch {
    return;
  }

  const lmContract = dep?.contracts?.LobbyManager;
  if (!lmContract?.address || !lmContract?.abi) return;

  const lmAddress = lmContract.address;
  const lmAbi = lmContract.abi;

  try {
    const count = Number(
      await client.readContract({ address: lmAddress, abi: lmAbi, functionName: "getLobbyCount" })
    );
    lobbyCount.set(count);

    for (let i = 1; i <= count; i++) {
      try {
        const info = await client.readContract({
          address: lmAddress,
          abi: lmAbi,
          functionName: "getLobbyInfo",
          args: [BigInt(i)]
        });
        // getLobbyInfo returns tuple — last field (index 3) is status enum
        const statusVal = Number(Array.isArray(info) ? info[3] ?? 0 : 0);
        const statusNames = ["Waiting", "ZeroRound", "Active", "Ended"];
        // Reset all status labels for this lobby to 0, set the active one to 1
        for (let s = 0; s < statusNames.length; s++) {
          lobbyStatus.set({ lobby_id: String(i), status: statusNames[s] }, s === statusVal ? 1 : 0);
        }
      } catch {
        /* individual lobby read may fail if lobby doesn't exist yet */
      }
    }
  } catch (e) {
    console.warn("[chain-exporter] LobbyManager read failed", e?.message ?? e);
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = createServer(async (_req, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[chain-exporter] http://0.0.0.0:${PORT}/metrics  rpc=${RPC_URL}`);
});

// Initial poll + interval
(async () => {
  await poll();
  setInterval(poll, POLL_MS);
})();
