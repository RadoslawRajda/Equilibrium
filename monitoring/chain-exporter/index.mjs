/**
 * chain-exporter: polls on-chain state (Anvil/Ganache + deployed contracts)
 * and exposes Prometheus metrics on port 9100.
 *
 * Metrics exposed:
 *   chain_head_block_number                      – current block number
 *   chain_head_block_timestamp                   – Unix timestamp of the latest block
 *   account_balance_eth{address,name}            – ETH balance of each monitored account
 *   lobbymanager_lobby_count                     – total lobbies ever created
 *   lobbymanager_lobby_status{lobby_id,status}   – 0=OPEN 1=ACTIVE 2=COMPLETED 3=CANCELLED
 *   bundler_rpc_up                               – 1 if the ERC-4337 bundler RPC is responding
 *   bundler_executor_tx_count                    – nonce (tx count) of the bundler executor account
 *   erc4337_paymaster_deposit_eth{address,name}  – ETH deposited by paymaster on the EntryPoint
 *   erc4337_userops_success_total                – cumulative successful UserOperations (since start)
 *   erc4337_userops_failed_total                 – cumulative failed UserOperations (since start)
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createPublicClient, defineChain, http, formatEther, parseAbiItem } from "viem";
import { mnemonicToAccount, privateKeyToAddress } from "viem/accounts";
import { collectDefaultMetrics, Counter, Gauge, Registry } from "prom-client";

const PORT = Number(process.env.PORT ?? 9100);
const RPC_URL = process.env.RPC_URL ?? "http://ganache:8545";
const DEPLOYMENTS_PATH = process.env.DEPLOYMENTS_PATH ?? "/contracts/deployments/localhost.json";
const POLL_MS = Number(process.env.POLL_MS ?? 10000);
const MNEMONIC =
  process.env.MNEMONIC ??
  "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat";
const BUNDLER_EXECUTOR_KEY =
  process.env.BUNDLER_EXECUTOR_KEY ??
  "0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3";
const BUNDLER_UTILITY_KEY =
  process.env.BUNDLER_UTILITY_KEY ??
  "0xae6ae8e5ccbfb04590405997ee2d52d2b330726137b875053c36d94e974d162f";
const BUNDLER_RPC_URL = process.env.BUNDLER_RPC_URL ?? "http://paymaster:4337";

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
  help: "Status of a specific lobby (0=OPEN 1=ACTIVE 2=COMPLETED 3=CANCELLED)",
  labelNames: ["lobby_id", "status"],
  registers: [register]
});

// ERC-4337 / Bundler metrics
const bundlerUp = new Gauge({
  name: "bundler_rpc_up",
  help: "1 if the ERC-4337 bundler JSON-RPC is responding, 0 otherwise",
  registers: [register]
});

const bundlerExecutorNonce = new Gauge({
  name: "bundler_executor_tx_count",
  help: "Transaction count (nonce) of the bundler executor account — proxy for bundles submitted",
  registers: [register]
});

const paymasterDeposit = new Gauge({
  name: "erc4337_paymaster_deposit_eth",
  help: "ETH deposited by a paymaster on the EntryPoint (available to sponsor gas)",
  labelNames: ["address", "name"],
  registers: [register]
});

const useropSuccessTotal = new Counter({
  name: "erc4337_userops_success_total",
  help: "Cumulative successful UserOperations processed by the EntryPoint (since exporter start)",
  registers: [register]
});

const useropFailedTotal = new Counter({
  name: "erc4337_userops_failed_total",
  help: "Cumulative failed UserOperations processed by the EntryPoint (since exporter start)",
  registers: [register]
});

// Minimal ABI fragments used by this exporter
const EP_BALANCE_OF_ABI = parseAbiItem(
  "function balanceOf(address account) view returns (uint256)"
);
const USEROP_EVENT_ABI = parseAbiItem(
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)"
);

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

// Build list of accounts to monitor (game mnemonic indices + bundler keys)
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

// Bundler executor & utility accounts are keyed separately (different mnemonic origin)
const bundlerExecutorAddress = privateKeyToAddress(BUNDLER_EXECUTOR_KEY);
const bundlerUtilityAddress = privateKeyToAddress(BUNDLER_UTILITY_KEY);
monitoredAccounts.push({ address: bundlerExecutorAddress, name: "bundler-executor" });
monitoredAccounts.push({ address: bundlerUtilityAddress, name: "bundler-utility" });

// Track the last block we scanned for EntryPoint events (avoids re-scanning from genesis)
let lastEventBlock = 0n;

// ---------------------------------------------------------------------------
// Bundler JSON-RPC health check
// ---------------------------------------------------------------------------
async function checkBundlerHealth() {
  try {
    const resp = await fetch(BUNDLER_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
      signal: AbortSignal.timeout(5000)
    });
    const json = await resp.json();
    bundlerUp.set(json.result ? 1 : 0);
  } catch {
    bundlerUp.set(0);
  }
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------
async function poll() {
  // --- Bundler health ---
  await checkBundlerHealth();

  let latestBlock;
  try {
    // --- Head block ---
    const block = await client.getBlock();
    latestBlock = block.number;
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

  // --- Bundler executor nonce ---
  try {
    const nonce = await client.getTransactionCount({ address: bundlerExecutorAddress });
    bundlerExecutorNonce.set(nonce);
  } catch (e) {
    console.warn("[chain-exporter] getTransactionCount(executor) failed", e?.message ?? e);
  }

  // --- Contract state ---
  if (!existsSync(DEPLOYMENTS_PATH)) return;
  let dep;
  try {
    dep = JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8"));
  } catch {
    return;
  }

  const epContract = dep?.contracts?.EntryPoint;
  const pmContract = dep?.contracts?.LobbySessionPaymaster;
  const lmContract = dep?.contracts?.LobbyManager;

  // --- Paymaster deposit on EntryPoint ---
  if (epContract?.address && pmContract?.address) {
    try {
      const deposit = await client.readContract({
        address: epContract.address,
        abi: [EP_BALANCE_OF_ABI],
        functionName: "balanceOf",
        args: [pmContract.address]
      });
      paymasterDeposit.set(
        { address: pmContract.address.toLowerCase(), name: "LobbySessionPaymaster" },
        Number(formatEther(deposit))
      );
    } catch (e) {
      console.warn("[chain-exporter] EntryPoint.balanceOf(paymaster) failed", e?.message ?? e);
    }
  }

  // --- EntryPoint UserOperationEvent logs ---
  if (epContract?.address && latestBlock !== undefined && latestBlock > lastEventBlock) {
    try {
      const fromBlock = lastEventBlock === 0n ? 0n : lastEventBlock + 1n;
      const logs = await client.getLogs({
        address: epContract.address,
        event: USEROP_EVENT_ABI,
        fromBlock,
        toBlock: latestBlock
      });
      let successCount = 0;
      let failedCount = 0;
      for (const log of logs) {
        if (log.args.success) successCount++;
        else failedCount++;
      }
      if (successCount > 0) useropSuccessTotal.inc(successCount);
      if (failedCount > 0) useropFailedTotal.inc(failedCount);
      if (logs.length > 0) {
        console.log(
          `[chain-exporter] EntryPoint events blocks ${fromBlock}-${latestBlock}: ` +
            `${successCount} success, ${failedCount} failed`
        );
      }
      lastEventBlock = latestBlock;
    } catch (e) {
      console.warn("[chain-exporter] getLogs(UserOperationEvent) failed", e?.message ?? e);
    }
  }

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
          functionName: "getLobby",
          args: [BigInt(i)]
        });
        // getLobby returns tuple (host, name, createdAt, status, prizePool, playerCount, winner)
        // status is at index 3: LobbyManager.LobbyStatus OPEN=0, ACTIVE=1, COMPLETED=2, CANCELLED=3
        const statusVal = Number(Array.isArray(info) ? info[3] ?? 0 : 0);
        const statusNames = ["OPEN", "ACTIVE", "COMPLETED", "CANCELLED"];
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
  console.log(`[chain-exporter] bundler=${BUNDLER_RPC_URL}`);
  console.log(`[chain-exporter] executor=${bundlerExecutorAddress}  utility=${bundlerUtilityAddress}`);
});

// Initial poll + interval
(async () => {
  await poll();
  setInterval(poll, POLL_MS);
})();
