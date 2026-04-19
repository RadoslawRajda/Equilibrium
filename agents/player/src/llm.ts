import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { envNum } from "./config.js";
import { PKG_ROOT, resolvePromptPath } from "./promptPaths.js";

const USER_PREFIX =
  "CRITICAL: Output ONLY one JSON object. The first non-whitespace character MUST be `{`. " +
  "HOARD LIMIT (prompt): keep each of food, wood, stone, ore under ~100 in snapshot.resources — if any basic is >=100, STOP farming that pile; " +
  "trade, bankTrade, craftAlloy, or expand other biomes instead. Pushing one stat to 500+ is wrong. " +
  "WIN PATH: trust economyHints.craftAlloyCost and victoryGoodsThreshold — default game is 10 each per craft, 5 alloy to win ⇒ 50/50/50/50 basics at craftedGoods 0 is enough to chain craftAlloy five times and win immediately when craftAlloyReasonable; do not over-farm past the win line. " +
  "Keep basics ROUGHLY BALANCED until you can close. " +
  "Stockpiling e.g. 900/3/900/3 is LOSING: you cannot craft; fix via discover/build/upgrade (diversify biomes and income), " +
  "Liquidity: compare openTrades (accept best vs 4:1 bank), bankTrade for immediate fix, at most ONE createTrade per plan for same skew — never chain multiple createTrade. Bank is first-class, not only when peers fail. " +
  "Do NOT only collect every turn without expanding — collection skews one resource; growth (discover → build → upgrade) gives independence. " +
  "Smelt only when economyHints.craftAlloyReasonable is true (you have structures). " +
  "Map: upgradeStructure only your lvl-1 structures; buildStructure on your empty hexes; discover ONLY hex ids in economyHints.discoverableHexIds. " +
  "If economyHints.rebalanceTradeDraft is present, use it to choose ONE barter action (single createTrade OR bank if bank wins on math/speed) before collect that worsens skew. " +
  "Running priority: if canAffordDiscover and discoverableHexIds non-empty, bias toward discover; else build/upgrade where affordable; " +
  "collect from mature structures; craftAlloy if craftAlloyReasonable; rebalance via best of acceptTrade / bankTrade / one createTrade. " +
  "Round clock: snapshot.round.clock.logicalRoundIndex for collect vs builtAtRound when present. " +
  "Trust economyHints costs. Do NOT summarize the snapshot. No markdown.\n\n=== SNAPSHOT ===\n";

const STARTING_HEX_USER_PREFIX =
  "CRITICAL: ZERO ROUND — choose your starting hex on Equilibrium. " +
  "Output ONLY one JSON object; first non-whitespace character MUST be `{`. " +
  'Shape: {"thought":"one sentence why this hex fits your strategy","hexId":"q,r"}. ' +
  "hexId MUST exactly match one of candidateHexes[].id (same string, e.g. \"0,0\" or \"-2,1\"). " +
  "Use biome and position (center vs rim, neighbors) in your reasoning. " +
  "If excludedHexIds is non-empty, never pick those. No markdown.\n\n=== ZERO ROUND ===\n";

function readTextIfExists(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export type ParsedPlan = {
  thought?: string;
  actions: Array<Record<string, unknown>>;
  /** Trimmed model text when JSON parsing failed (for logs). */
  assistantPreview?: string;
};

function normalizeThought(raw: unknown): string {
  if (raw == null) return "(no thought)";
  const s = String(raw).trim();
  return s.length > 0 ? s : "(no thought)";
}

function pickThought(raw: Record<string, unknown>): unknown {
  return (
    raw.thought ??
    raw.Thought ??
    raw.reasoning ??
    raw.rationale ??
    raw.plan ??
    raw.comment
  );
}

function defaultPersona(): string {
  const identityPath = resolvePromptPath(
    "PLAYER_IDENTITY_PATH",
    "personas/equinox.md",
    "EQUINOX_IDENTITY_PATH"
  );
  const strategyPath = resolvePromptPath(
    "PLAYER_STRATEGY_PATH",
    "skills/strategy.md",
    "EQUINOX_STRATEGY_PATH"
  );
  const legacySystemPath = resolve(PKG_ROOT, "persona/system.md");

  const identity = readTextIfExists(identityPath)?.trim() ?? "";
  let strategy = readTextIfExists(strategyPath)?.trim() ?? "";
  if (!strategy) strategy = readTextIfExists(legacySystemPath)?.trim() ?? "";

  if (!strategy) {
    strategy = [
      "Equilibrium agent: reply with one JSON object { thought, actions }.",
      "Prompt cap: keep each basic (food wood stone ore) under ~100 — if one is >=100 stop collecting that line; trade/bank/craft/expand instead.",
      "Default spec: 5 alloy win, 10 each per craft ⇒ 50/50/50/50 can finish in one batch of craftAlloy if hints allow; trust economyHints over fixed numbers.",
      "Balance basics via discover/build/upgrade and trade/bank; do not only collect.",
      "Discover only hex ids in economyHints.discoverableHexIds. Prefer discover when affordable. Upgrade only your structures.",
      "Compare acceptTrade vs bankTrade (4:1 instant) vs one createTrade — no multiple createTrade per skew; bank when best or fastest.",
      "Use economyHints; craftAlloy only when craftAlloyReasonable is true.",
      'Example: {"thought":"Food at 110 — bank food to ore instead of another plains collect.","actions":[{"type":"bankTrade","sellKind":0,"buyKind":3}]}'
    ].join(" ");
  }

  const parts = [identity, strategy].filter(Boolean);
  return parts.join("\n\n---\n\n");
}

/** Ollama may return `content` as string, object, or an array of segments (OpenAI-style). */
function stringifyMessageContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part == null) return "";
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return JSON.stringify(part);
      })
      .join("");
  }
  if (typeof content === "object") return JSON.stringify(content);
  return String(content);
}

/** Pull assistant text from /api/chat JSON (handles thinking-only models). */
function extractAssistantTextFromChatBody(resBody: Record<string, unknown>): string {
  const msg = resBody.message as Record<string, unknown> | undefined;
  if (msg) {
    let out = stringifyMessageContent(msg.content).trim();
    if (!out && typeof msg.thinking === "string") {
      out = msg.thinking.trim();
    }
    if (out) return out;
  }
  if (typeof resBody.response === "string" && resBody.response.trim()) {
    return resBody.response.trim();
  }
  return "";
}

export function clipAssistantPreview(text: string, max = 220): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (!one) return "";
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

export function summarizeActionsForLog(actions: Array<Record<string, unknown>>): string {
  const parts = actions.slice(0, 12).map((a) => {
    const ty = String(a.type ?? "noop");
    if (ty === "noop") return "noop";
    if (ty === "craftAlloy") return "craftAlloy";
    if (ty === "discover") return `discover ${String(a.hexId ?? "")}`;
    if (ty === "collect") return `collect ${String(a.hexId ?? "")}`;
    if (ty === "buildStructure" || ty === "build") return `build ${String(a.hexId ?? "")}`;
    if (ty === "upgradeStructure" || ty === "upgrade") return `upgrade ${String(a.hexId ?? "")}`;
    if (ty === "bankTrade") return `bank ${String(a.sellKind ?? "?")}→${String(a.buyKind ?? "?")}`;
    if (ty === "acceptTrade") return `acceptTrade #${String(a.tradeId ?? "?")}`;
    if (ty === "createTrade") return `createTrade →${String(a.taker ?? "open").slice(0, 10)}`;
    if (ty === "endRoundVote") return `vote ${String(a.proposalId ?? "?")}`;
    return ty;
  });
  return parts.join("; ");
}

function stripOuterMarkdownFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  if (m) return m[1].trim();
  return t;
}

/** Small models often emit trailing commas; JSON.parse rejects them. Not string-aware — OK for typical LLM plan blobs. */
function loosenJsonForParse(json: string): string {
  let s = json.trim();
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/,(\s*[\]}])/g, "$1");
  }
  return s;
}

function tryParsePlanFromString(chunk: string): ParsedPlan | null {
  const variants = [chunk, loosenJsonForParse(chunk)];
  for (const v of variants) {
    if (!v) continue;
    try {
      const raw = JSON.parse(v) as unknown;
      const plan = normalizeParsedRoot(raw);
      if (plan) return plan;
    } catch {
      /* try loosened / next variant */
    }
  }
  return null;
}

/** First `{` … matching `}` respecting strings and escapes (handles nested objects). */
function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonPlan(text: string): ParsedPlan {
  const preview = clipAssistantPreview(text);
  const cleaned = stripOuterMarkdownFence(text);
  const candidates = [cleaned, text.trim()];
  for (const chunk of candidates) {
    if (!chunk) continue;
    const plan = tryParsePlanFromString(chunk);
    if (plan) return plan;
  }
  const balanced = extractBalancedJsonObject(cleaned) ?? extractBalancedJsonObject(text);
  if (!balanced) {
    return { thought: "parse-fail", actions: [{ type: "noop" }], assistantPreview: preview };
  }
  const plan = tryParsePlanFromString(balanced);
  if (plan) return plan;
  return { thought: "json-error", actions: [{ type: "noop" }], assistantPreview: preview };
}

function coerceActionsArray(o: Record<string, unknown>): Array<Record<string, unknown>> | null {
  const a = o.actions ?? o.Actions;
  if (Array.isArray(a)) {
    return a.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Array<Record<string, unknown>>;
  }
  const one = o.action ?? o.Action;
  if (one && typeof one === "object" && !Array.isArray(one)) {
    return [one as Record<string, unknown>];
  }
  if (Array.isArray(one)) {
    return one.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Array<Record<string, unknown>>;
  }
  const steps = o.steps ?? o.Steps;
  if (Array.isArray(steps)) {
    return steps.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Array<Record<string, unknown>>;
  }
  return null;
}

function normalizeParsedRoot(raw: unknown): ParsedPlan | null {
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const first = raw[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const fo = first as Record<string, unknown>;
      if (
        "actions" in fo ||
        "Actions" in fo ||
        "action" in fo ||
        "Action" in fo ||
        "steps" in fo ||
        "Steps" in fo ||
        pickThought(fo) != null
      ) {
        return normalizeParsedRoot(first);
      }
      if ("type" in fo) {
        return { thought: "(batch as array root)", actions: raw as Array<Record<string, unknown>> };
      }
    }
    return null;
  }
  const o = raw as Record<string, unknown>;
  const t = pickThought(o);
  const coerced = coerceActionsArray(o);

  if (typeof o.type === "string" && coerced === null) {
    return { thought: normalizeThought(t), actions: [o] };
  }
  if (coerced === null) {
    if (t == null || String(t).trim() === "") return null;
    return { thought: normalizeThought(t), actions: [{ type: "noop" }] };
  }
  if (coerced.length === 0) {
    return { thought: normalizeThought(t), actions: [{ type: "noop" }] };
  }
  return { thought: normalizeThought(t), actions: coerced };
}

export type ParsedStartingPick = { thought: string; hexId: string };

function normalizeHexIdLocal(raw: string): string {
  return raw.trim().replace(/\s*,\s*/g, ",");
}

function normalizeStartingPickRoot(raw: unknown): ParsedStartingPick | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const thought = normalizeThought(pickThought(o));
  let hex: unknown = o.hexId ?? o.hex_id;
  if (typeof hex !== "string" && o.pick && typeof o.pick === "object" && !Array.isArray(o.pick)) {
    const p = o.pick as Record<string, unknown>;
    hex = p.hexId ?? p.hex_id;
  }
  if (typeof hex !== "string" || !hex.trim()) return null;
  return { thought, hexId: normalizeHexIdLocal(hex) };
}

export function parseStartingHexPick(text: string): ParsedStartingPick | null {
  const cleaned = stripOuterMarkdownFence(text.trim());
  for (const chunk of [cleaned, text.trim()]) {
    if (!chunk) continue;
    try {
      const raw = JSON.parse(chunk) as unknown;
      const p = normalizeStartingPickRoot(raw);
      if (p) return p;
    } catch {
      /* try next */
    }
  }
  const balanced = extractBalancedJsonObject(cleaned) ?? extractBalancedJsonObject(text);
  if (!balanced) return null;
  try {
    const raw = JSON.parse(balanced) as unknown;
    return normalizeStartingPickRoot(raw);
  } catch {
    return null;
  }
}

async function ollamaFetch(url: string, init: RequestInit): Promise<Response> {
  const headersTimeout = envNum("OLLAMA_HEADERS_TIMEOUT_MS", 600_000);
  const bodyTimeout = envNum("OLLAMA_BODY_TIMEOUT_MS", 600_000);
  const connectTimeout = envNum("OLLAMA_CONNECT_TIMEOUT_MS", 120_000);
  try {
    const { Agent, fetch: ufetch } = await import("undici");
    const dispatcher = new Agent({ headersTimeout, bodyTimeout, connectTimeout });
    return ufetch(url, { ...init, dispatcher } as never) as unknown as Response;
  } catch {
    return fetch(url, init);
  }
}

type OllamaJsonMode = "off" | "roundActions" | "startingHex";

async function ollamaChatRaw(
  ollamaUrl: string,
  model: string,
  system: string,
  userMessage: string,
  jsonMode: OllamaJsonMode
): Promise<{ text: string; resBody: Record<string, unknown> }> {
  const body: Record<string, unknown> = {
    model,
    stream: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMessage }
    ],
    options: {
      temperature: Number(process.env.OLLAMA_TEMPERATURE ?? "0.35"),
      num_predict: Number(process.env.OLLAMA_NUM_PREDICT ?? "512")
    }
  };
  if (jsonMode === "roundActions" && process.env.OLLAMA_JSON_FORMAT === "1") {
    if (process.env.OLLAMA_JSON_SCHEMA === "1") {
      body.format = {
        type: "object",
        properties: {
          thought: { type: "string", description: "One sentence why this plan" },
          actions: { type: "array", description: "Game actions for this batch" }
        },
        required: ["thought", "actions"]
      };
    } else {
      body.format = "json";
    }
  }
  /** Never use round `actions` schema here — starting pick is { thought, hexId }. */
  if (
    jsonMode === "startingHex" &&
    process.env.PLAYER_ZERO_ROUND_JSON_FORMAT === "1" &&
    process.env.OLLAMA_JSON_FORMAT === "1"
  ) {
    body.format = "json";
  }

  const res = await ollamaFetch(`${ollamaUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  }
  const resBody = (await res.json()) as Record<string, unknown>;
  const text = extractAssistantTextFromChatBody(resBody);
  return { text, resBody };
}

export async function askOllama(
  ollamaUrl: string,
  model: string,
  userPayload: string
): Promise<ParsedPlan> {
  const system = defaultPersona();
  const userMessage = userPayload.startsWith("CRITICAL:") ? userPayload : `${USER_PREFIX}${userPayload}`;
  const { text, resBody } = await ollamaChatRaw(
    ollamaUrl,
    model,
    system,
    userMessage,
    process.env.OLLAMA_JSON_FORMAT === "1" ? "roundActions" : "off"
  );
  if (!text) {
    if (process.env.PLAYER_DEBUG === "1" || process.env.EQUINOX_DEBUG === "1") {
      console.warn(
        "[player-agent] Ollama empty assistant text; body keys:",
        Object.keys(resBody),
        "sample:",
        JSON.stringify(resBody).slice(0, 600)
      );
    }
    return { thought: "empty-ollama-content", actions: [{ type: "noop" }] };
  }
  return parseJsonPlan(text);
}

/** Strategic starting hex; optional `PLAYER_ZERO_ROUND_JSON_FORMAT=1` + `OLLAMA_JSON_FORMAT=1` → `format: json` only (no actions schema). */
export async function askOllamaStartingHex(
  ollamaUrl: string,
  model: string,
  userPayload: string
): Promise<ParsedStartingPick | null> {
  const system = defaultPersona();
  const userMessage = userPayload.startsWith("CRITICAL:") ? userPayload : `${STARTING_HEX_USER_PREFIX}${userPayload}`;
  const jsonMode: OllamaJsonMode =
    process.env.PLAYER_ZERO_ROUND_JSON_FORMAT === "1" && process.env.OLLAMA_JSON_FORMAT === "1"
      ? "startingHex"
      : "off";
  const { text, resBody } = await ollamaChatRaw(ollamaUrl, model, system, userMessage, jsonMode);
  if (!text) {
    if (process.env.PLAYER_DEBUG === "1" || process.env.EQUINOX_DEBUG === "1") {
      console.warn(
        "[player-agent] Ollama empty text (zero-round pick); keys:",
        Object.keys(resBody)
      );
    }
    return null;
  }
  return parseStartingHexPick(text);
}
