import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { envNum } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const USER_PREFIX =
  "CRITICAL: Output ONLY one JSON object. The first non-whitespace character MUST be `{`. " +
  "Prefer real actions when snapshot.economyHints allows (e.g. " +
  '`{"thought":"Craft advances win.","actions":[{"type":"craftAlloy"}]}`). ' +
  "Do NOT default to noop when canCraftAlloy is true. " +
  "Do NOT explain or summarize the snapshot. No markdown.\n\n=== SNAPSHOT ===\n";

const PKG_ROOT = resolve(__dirname, "..");

function readTextIfExists(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function resolvePromptPath(envKey: string, defaultRel: string): string {
  const v = process.env[envKey]?.trim();
  if (!v) return resolve(PKG_ROOT, defaultRel);
  if (v.startsWith("/")) return v;
  return resolve(PKG_ROOT, v);
}

export type ParsedPlan = { thought?: string; actions: Array<Record<string, unknown>> };

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
  const identityPath = resolvePromptPath("EQUINOX_IDENTITY_PATH", "persona/identity.md");
  const strategyPath = resolvePromptPath("EQUINOX_STRATEGY_PATH", "skills/strategy.md");
  const legacySystemPath = resolve(PKG_ROOT, "persona/system.md");

  const identity = readTextIfExists(identityPath)?.trim() ?? "";
  let strategy = readTextIfExists(strategyPath)?.trim() ?? "";
  if (!strategy) strategy = readTextIfExists(legacySystemPath)?.trim() ?? "";

  if (!strategy) {
    strategy = [
      "CryptoCatan agent: reply with one JSON object { thought, actions }.",
      "Use economyHints.canCraftAlloy and canAffordDiscover from the snapshot.",
      "If canCraftAlloy is true, actions should include craftAlloy, not only noop.",
      'Example: {"thought":"Smelt now.","actions":[{"type":"craftAlloy"}]}'
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

function stripOuterMarkdownFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  if (m) return m[1].trim();
  return t;
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
  const cleaned = stripOuterMarkdownFence(text);
  const candidates = [cleaned, text.trim()];
  for (const chunk of candidates) {
    if (!chunk) continue;
    try {
      const raw = JSON.parse(chunk) as unknown;
      const plan = normalizeParsedRoot(raw);
      if (plan) return plan;
    } catch {
      /* try next */
    }
  }
  const balanced = extractBalancedJsonObject(cleaned) ?? extractBalancedJsonObject(text);
  if (!balanced) {
    return { thought: "parse-fail", actions: [{ type: "noop" }] };
  }
  try {
    const raw = JSON.parse(balanced) as unknown;
    const plan = normalizeParsedRoot(raw);
    if (plan) return plan;
  } catch {
    return { thought: "json-error", actions: [{ type: "noop" }] };
  }
  return { thought: "json-error", actions: [{ type: "noop" }] };
}

function normalizeParsedRoot(raw: unknown): ParsedPlan | null {
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const first = raw[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const fo = first as Record<string, unknown>;
      if ("actions" in fo || pickThought(fo) != null) {
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
  if (typeof o.type === "string" && !("actions" in o)) {
    return { thought: normalizeThought(t), actions: [o] };
  }
  if (!("actions" in o) && (t == null || String(t).trim() === "")) {
    return null;
  }
  const actions = Array.isArray(o.actions) ? o.actions : [{ type: "noop" }];
  return { thought: normalizeThought(t), actions };
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

export async function askOllama(
  ollamaUrl: string,
  model: string,
  userPayload: string
): Promise<ParsedPlan> {
  const system = defaultPersona();
  const userMessage = userPayload.startsWith("CRITICAL:") ? userPayload : `${USER_PREFIX}${userPayload}`;
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
  /** `format: "json"` is opt-in — several small models return empty/minimal `content` or omit `thought` when it is on. Set `OLLAMA_JSON_FORMAT=1` to enable. */
  if (process.env.OLLAMA_JSON_FORMAT === "1") {
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
  if (!text) {
    if (process.env.EQUINOX_DEBUG === "1") {
      console.warn(
        "[equinox] Ollama empty assistant text; body keys:",
        Object.keys(resBody),
        "sample:",
        JSON.stringify(resBody).slice(0, 600)
      );
    }
    return { thought: "empty-ollama-content", actions: [{ type: "noop" }] };
  }
  return parseJsonPlan(text);
}
