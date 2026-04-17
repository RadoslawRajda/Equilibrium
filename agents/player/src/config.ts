import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type DeploymentsFile = {
  contracts: {
    LobbyManager: { address: `0x${string}`; abi: readonly unknown[] };
    GameCore: { address: `0x${string}`; abi: readonly unknown[] };
    ERC8004PlayerAgentRegistry?: { address: `0x${string}`; abi: readonly unknown[] };
  };
};

export function loadDeployments(): DeploymentsFile {
  const p =
    process.env.DEPLOYMENTS_PATH ??
    resolve(__dirname, "../../../contracts/deployments/localhost.json");
  if (!existsSync(p)) {
    throw new Error(`Deployments not found: ${p}`);
  }
  return JSON.parse(readFileSync(p, "utf8")) as DeploymentsFile;
}

/** Waits until Hardhat has written a deployment that includes the ERC-8004 registry (avoids starting before deploy finishes). */
export async function loadDeploymentsWhenReady(options?: { maxWaitMs?: number; pollMs?: number }): Promise<DeploymentsFile> {
  const maxWaitMs = options?.maxWaitMs ?? 180_000;
  const pollMs = options?.pollMs ?? 2_000;
  const deadline = Date.now() + maxWaitMs;
  let lastErr: Error | null = null;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const dep = loadDeployments();
      const reg = dep.contracts.ERC8004PlayerAgentRegistry;
      if (
        reg?.address &&
        /^0x[a-fA-F0-9]{40}$/.test(reg.address) &&
        Array.isArray(reg.abi) &&
        reg.abi.length > 0
      ) {
        return dep;
      }
      lastErr = new Error("ERC8004PlayerAgentRegistry missing or has no ABI in deployments JSON");
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
    if (attempt === 1 || attempt % 5 === 0) {
      console.warn(
        `[player-agent] deployments not ready for ERC8004 (attempt ${attempt}, last: ${lastErr?.message ?? "unknown"})`
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw lastErr ?? new Error(`Deployments not ready within ${maxWaitMs}ms`);
}

export function envStr(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
