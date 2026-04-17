import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const frontendRoot = resolve(__dirname, "..");
const source = resolve(frontendRoot, "..", "contracts", "deployments", "localhost.json");
const targetDir = resolve(frontendRoot, "src", "abi");
const target = resolve(targetDir, "localhost.json");

if (!existsSync(source)) {
  console.warn(`[sync-abi] Source deployment file not found: ${source}`);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log(`[sync-abi] Updated ${target}`);
