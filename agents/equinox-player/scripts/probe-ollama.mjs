#!/usr/bin/env node
/**
 * Dev helper: compare Ollama /api/chat with and without format=json.
 * Usage: node scripts/probe-ollama.mjs [model]
 */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const system = [
  fs.existsSync(join(root, "persona", "identity.md"))
    ? fs.readFileSync(join(root, "persona", "identity.md"), "utf8")
    : "",
  fs.existsSync(join(root, "skills", "strategy.md"))
    ? fs.readFileSync(join(root, "skills", "strategy.md"), "utf8")
    : ""
]
  .filter(Boolean)
  .join("\n\n---\n\n");
if (!system.trim()) {
  console.error("Missing persona/identity.md and skills/strategy.md");
  process.exit(1);
}
const model = process.argv[2] || "llama3.2:latest";
const ollama = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");

const user = JSON.stringify(
  {
    lobbyId: 1,
    round: { status: 2, roundIndex: 1, roundEndsAt: 1710000000, zeroRoundEndsAt: 0 },
    resources: { food: 5, wood: 3, stone: 2, ore: 1, energy: 10 },
    craftedGoods: 0,
    ownedHexCount: 1,
    tiles: [
      {
        id: "0,0",
        q: 0,
        r: 0,
        biome: "plains",
        owner: "0x627306090abaB3A6e1400e9345bC60c78a8BEf57",
        discovered: true,
        structure: { exists: true, level: 1 }
      },
      {
        id: "1,0",
        q: 1,
        r: 0,
        biome: "forest",
        owner: null,
        discovered: false,
        structure: { exists: false, level: 0 }
      }
    ],
    proposals: []
  },
  null,
  2
);

const fastOpts = {
  temperature: 0.35,
  num_predict: Number(process.env.PROBE_NUM_PREDICT ?? "256")
};

async function run(label, body) {
  const t0 = Date.now();
  const res = await fetch(`${ollama}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, options: { ...fastOpts, ...(body.options ?? {}) } })
  });
  const j = await res.json();
  const ms = Date.now() - t0;
  console.log(`\n=== ${label} HTTP ${res.status} ${ms}ms ===`);
  console.log("top-level keys:", Object.keys(j));
  if (j.message) console.log("message keys:", Object.keys(j.message));
  const c = j.message?.content;
  console.log("content typeof:", typeof c);
  if (typeof c === "string") {
    console.log("content length:", c.length);
    console.log("content preview:\n", c.slice(0, 1200));
  } else if (c != null) {
    console.log("content (non-string):", JSON.stringify(c).slice(0, 1200));
  } else {
    console.log("content: null/undefined");
    console.log("message:", JSON.stringify(j.message).slice(0, 800));
  }
  return j;
}

await run("NO format (Equinox default)", {
  model,
  stream: false,
  messages: [
    { role: "system", content: system },
    { role: "user", content: `Game state JSON:\n${user}` }
  ]
});

if (process.env.PROBE_WITH_JSON_FORMAT === "1") {
  await run("WITH format=json (OLLAMA_JSON_FORMAT=1)", {
    model,
    stream: false,
    format: "json",
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Game state JSON:\n${user}` }
    ]
  });
}
