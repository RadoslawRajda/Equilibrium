import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type DeploymentsFile = {
  contracts: {
    LobbyManager: { address: `0x${string}`; abi: readonly unknown[] };
    GameCore: { address: `0x${string}`; abi: readonly unknown[] };
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

export async function loadDeploymentsWhenReady(options?: {
  maxWaitMs?: number;
  pollMs?: number;
}): Promise<DeploymentsFile> {
  const maxWaitMs = options?.maxWaitMs ?? 180_000;
  const pollMs = options?.pollMs ?? 2_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      const dep = loadDeployments();
      if (
        dep.contracts?.LobbyManager?.address &&
        dep.contracts?.GameCore?.address &&
        Array.isArray(dep.contracts?.LobbyManager?.abi) &&
        Array.isArray(dep.contracts?.GameCore?.abi)
      ) {
        return dep;
      }
    } catch {
      // keep waiting until deployment file appears and is complete
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(`Deployments not ready within ${maxWaitMs}ms`);
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

export function envBool(name: string, fallback: boolean): boolean {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  if (!v) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return fallback;
}
