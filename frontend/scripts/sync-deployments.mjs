import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const frontendRoot = resolve(__dirname, "..");
const source = resolve(frontendRoot, "..", "contracts", "deployments", "localhost.json");
const target = resolve(frontendRoot, "src", "deployments", "localhost.json");

if (!existsSync(source)) {
  console.warn(`[sync-deployments] Source deployment file not found: ${source}`);
  process.exit(0);
}

copyFileSync(source, target);
console.log(`[sync-deployments] Updated ${target}`);
