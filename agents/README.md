# CryptoCatan agents

## Layout

- `registry/` — HTTP **Agent Registry** (dev): lists registered agents and delivers **lobby invites** to polling agents.
- `equinox-player/` — **Equinox** player agent: EOA on-chain, **Ollama** LLM off-chain, “round intent batch” (many txs planned in one LLM call, then executed sequentially).

## ERC-8004 alignment

The repo already ships **`IERC8004Agent`** + `MockERC8004Agent` in `contracts/contracts/ERC8004Adapters.sol` for **AI Game Master** adapters (`decideAction(lobbyId, snapshot)`).

**Player agents** are not forced on-chain: Equinox uses a **normal wallet** (mnemonic-derived EOA), registers in the **off-chain registry**, and loads prompts from **`persona/identity.md`** (soul) + **`skills/strategy.md`** (tactics / JSON contract). Optional env: `EQUINOX_IDENTITY_PATH`, `EQUINOX_STRATEGY_PATH`. That matches `IGameMasterIntegration.sol`: *personality off-chain, chain enforces rules*.

To advertise on-chain identity later, you can deploy a small **ERC-165** module or reuse `MockERC8004Agent` patterns for metadata only — gameplay stays `GameCore` calls from the same EOA.

## ERC-4337 / paymaster

Equinox uses **plain transactions** (`buyTicket`, `joinLobby`, `craftAlloy`, …) so local dev does not depend on bundler sponsorship. You can swap the write path to a smart account + paymaster later without changing game rules.

## “ERC-8211” / batch per round

There is no single on-chain **ERC-8211** opcode in this stack. Equinox implements a **round intent batch** in software:

1. Build a JSON snapshot (resources, map tiles, proposals).
2. One **Ollama** call returns ordered `{ "actions": [...] }`.
3. `executeRoundBatch` sends **sequential** transactions (craft → discover → collect → …).

For a true **multicall / intent** standard, you’d add a router contract or an EIP-5792-capable wallet; the LLM output format is already structured for that migration.

## Ollama (host)

Docker Compose sets `OLLAMA_URL=http://host.docker.internal:11434` so the agent container talks to **Ollama on your machine**, not inside Docker.

```bash
# example
ollama pull llama3.2
ollama serve
```

Override model: `OLLAMA_MODEL=mistral docker compose up equinox-agent`

**LLM JSON mode:** by default Equinox does **not** send Ollama `format: "json"` (small models often return empty `message.content` or drop `thought`). To force JSON from Ollama, set **`OLLAMA_JSON_FORMAT=1`**. Optional: **`OLLAMA_JSON_SCHEMA=1`** (with `OLLAMA_JSON_FORMAT=1`) for a stricter schema. Tune length with **`OLLAMA_NUM_PREDICT`** (default `512`) and **`OLLAMA_TEMPERATURE`**.

**Docker / slow Ollama:** Node’s `fetch` uses short Undici header timeouts; Equinox uses **`undici` with long defaults** for `/api/chat`. Override (ms): **`OLLAMA_HEADERS_TIMEOUT_MS`** (default `600000`), **`OLLAMA_BODY_TIMEOUT_MS`**, **`OLLAMA_CONNECT_TIMEOUT_MS`**.

**Large maps:** huge snapshots make small models **describe** the JSON instead of returning a plan (`parse-fail`). Equinox caps tiles sent to the LLM (**`EQUINOX_SNAPSHOT_MAX_TILES`**, default `56`; discovered tiles first). Raise if you use a larger model.

**Economy hints:** each snapshot includes **`economyHints`** from chain (`previewCraftAlloyCost`, `previewDiscoverCost`, `getVictoryGoodsThreshold`) so the model sees **`canCraftAlloy`** / **`canAffordDiscover`** instead of guessing. If the LLM still returns only **`noop`**, a small **heuristic** injects **`craftAlloy`** or **`discover`** when those flags allow it.

Debug empty replies: **`EQUINOX_DEBUG=1`**.

Probe locally: `node equinox-player/scripts/probe-ollama.mjs llama3.2:latest`

## Agent wallet & balance

Default **`AGENT_ACCOUNT_INDEX=10`** uses the same **Anvil/Hardhat mnemonic** as the rest of the repo (`candy maple…`). Those accounts are prefunded with **1000 ETH** on local chains — the “100 ETH” requirement is satisfied on Anvil.

## Registry API

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| GET | `/agents` | — | List `{ address, name, … }` |
| POST | `/agents/register` | `{ address, name, personality? }` | Agent startup self-registration |
| POST | `/lobbies/:lobbyId/invite` | `{ targetAddress, hostAddress }` | Host invites agent |
| GET | `/invites?for=0x…` | — | Agent polls pending invites |
| POST | `/invites/:lobbyId/:targetAddress/consume` | — | Clear invite after join |

**No authentication** — local dev only.

## Frontend

Set `VITE_AGENT_REGISTRY_URL` (e.g. `http://localhost:4050`). Hosts see **registered agents** and can **Send invite**. Players with registry addresses show a **robot** icon next to the nickname in the lobby list.

## Run with Docker Compose

From repo root (after `contracts` deployed so `deployments/localhost.json` exists):

```bash
docker compose up agent-registry equinox-agent
```

Ensure **Ollama** is listening on the host and `contracts/deployments/localhost.json` is mounted (Compose maps `./contracts/deployments`).

## Local dev without Docker

```bash
cd agents/registry && npm install && npm start
cd agents/equinox-player && npm install && DEPLOYMENTS_PATH=../../contracts/deployments/localhost.json npm run dev
```
