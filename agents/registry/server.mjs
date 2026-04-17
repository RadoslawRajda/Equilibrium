/**
 * Dev registry: online agents + lobby invites (no auth — use only on local nets).
 */
import cors from "cors";
import express from "express";

const app = express();
app.use(cors());
app.use(express.json());

/** @type {Map<string, { address: string, name: string, registeredAt: string, personality?: string }>} */
const agents = new Map();

/** @type {Map<string, { lobbyId: string, targetAddress: string, hostAddress: string, createdAt: string }[]>} key = targetAddress lower */
const invitesByAgent = new Map();

app.get("/health", (_req, res) => {
  res.json({ ok: true, agents: agents.size });
});

app.get("/agents", (_req, res) => {
  res.json([...agents.values()]);
});

app.post("/agents/register", (req, res) => {
  const { address, name, personality } = req.body ?? {};
  if (!address || typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }
  const n = typeof name === "string" && name.trim() ? name.trim() : "Agent";
  const key = address.toLowerCase();
  const row = {
    address,
    name: n,
    registeredAt: new Date().toISOString(),
    ...(personality ? { personality: String(personality).slice(0, 2000) } : {})
  };
  agents.set(key, row);
  res.json(row);
});

app.post("/lobbies/:lobbyId/invite", (req, res) => {
  const { lobbyId } = req.params;
  const { targetAddress, hostAddress } = req.body ?? {};
  if (!targetAddress || !/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
    return res.status(400).json({ error: "targetAddress required" });
  }
  const host = typeof hostAddress === "string" && hostAddress.startsWith("0x") ? hostAddress : "0x0000000000000000000000000000000000000000";
  const invite = {
    lobbyId: String(lobbyId),
    targetAddress,
    hostAddress: host,
    createdAt: new Date().toISOString()
  };
  const key = targetAddress.toLowerCase();
  const list = invitesByAgent.get(key) ?? [];
  list.push(invite);
  invitesByAgent.set(key, list);
  res.json({ ok: true, invite });
});

app.get("/invites", (req, res) => {
  const forAddr = req.query.for;
  if (!forAddr || typeof forAddr !== "string") {
    return res.status(400).json({ error: "Query ?for=0x... required" });
  }
  const key = forAddr.toLowerCase();
  res.json(invitesByAgent.get(key) ?? []);
});

app.post("/invites/:lobbyId/:targetAddress/consume", (req, res) => {
  const { lobbyId, targetAddress } = req.params;
  const key = targetAddress.toLowerCase();
  const list = invitesByAgent.get(key) ?? [];
  const next = list.filter((i) => i.lobbyId !== String(lobbyId));
  invitesByAgent.set(key, next);
  res.json({ ok: true, remaining: next.length });
});

const port = Number(process.env.PORT ?? 4050);
app.listen(port, "0.0.0.0", () => {
  console.log(`[agent-registry] http://0.0.0.0:${port}`);
});
