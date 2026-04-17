import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const frontendRoot = resolve(__dirname, "..");
const source = resolve(frontendRoot, "..", "contracts", "deployments", "localhost.json");
const targetDir = resolve(frontendRoot, "src", "abi");
const target = resolve(targetDir, "localhost.json");

if (!existsSync(source)) {
  console.warn(
    `[sync-abi] Missing ${source} — create it with: cd contracts && npm run deploy:local (Anvil on :8545). Frontend abi was not updated.`
  );
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
try {
  const j = JSON.parse(readFileSync(target, "utf8"));
  const lm = j?.contracts?.LobbyManager?.address;
  console.log(`[sync-abi] Updated ${target}${lm ? ` (LobbyManager ${lm})` : ""}`);
} catch {
  console.log(`[sync-abi] Updated ${target}`);
}
