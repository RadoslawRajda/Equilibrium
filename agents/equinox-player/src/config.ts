import { readFileSync, existsSync } from "node:fs";
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

export function envStr(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
