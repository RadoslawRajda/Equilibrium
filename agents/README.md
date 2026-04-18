# CryptoCatan agents

## Layout

- `registry/` — HTTP **Agent Registry** (dev): lists registered agents and delivers **lobby invites** to polling agents.
- `player/` — **LLM player agent** (Docker image `cryptocatan/player-agent:local`): mnemonic EOA, off-chain registry, **Ollama** round planning, sequential txs. One image, many instances: set `AGENT_NAME`, `AGENT_ACCOUNT_INDEX`, and `PLAYER_IDENTITY_PATH` (e.g. `personas/equinox.md`, `personas/aurora.md`). Default if unset: **`personas/equinox.md`**.

## ERC-8004 alignment

The repo already ships **`IERC8004Agent`** + `MockERC8004Agent` in `contracts/contracts/ERC8004Adapters.sol` for **AI Game Master** adapters (`decideAction(lobbyId, snapshot)`).

**Player agents** use a **normal wallet** (mnemonic-derived EOA), register in the **off-chain registry**, and load prompts from a **persona markdown** under **`personas/`** (soul; default **`personas/equinox.md`**) + **`skills/strategy.md`** (tactics / JSON contract). Set **`PLAYER_IDENTITY_PATH`** / **`PLAYER_STRATEGY_PATH`** explicitly in Compose for each bot (recommended). Legacy aliases **`EQUINOX_IDENTITY_PATH`** / **`EQUINOX_STRATEGY_PATH`** are still read if the `PLAYER_*` vars are unset.

On startup, each player now also auto-creates an on-chain **ERC-8004 identity contract** via `ERC8004PlayerAgentRegistry.createAndRegisterAgent(...)` (if this contract is present in deployments). This gives every bot a real ERC-165 / ERC-8004 address plus on-chain win/loss stats.

To advertise on-chain identity later, you can deploy a small **ERC-165** module or reuse `MockERC8004Agent` patterns for metadata only — gameplay stays `GameCore` calls from the same EOA.

## ERC-4337 / paymaster

The player agent uses **plain transactions** (`buyTicket`, `joinLobby`, `craftAlloy`, …) so local dev does not depend on bundler sponsorship. You can swap the write path to a smart account + paymaster later without changing game rules.

## “ERC-8211” / batch per round

There is no single on-chain **ERC-8211** opcode in this stack. The agent implements a **round intent batch** in software:

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

**LLM JSON mode:** by default the agent does **not** send Ollama `format: "json"` (small models often return empty `message.content` or drop `thought`). To force JSON from Ollama, set **`OLLAMA_JSON_FORMAT=1`**. Optional: **`OLLAMA_JSON_SCHEMA=1`** (with `OLLAMA_JSON_FORMAT=1`) for a stricter schema. Tune length with **`OLLAMA_NUM_PREDICT`** (default `512`) and **`OLLAMA_TEMPERATURE`**.

**Docker / slow Ollama:** Node’s `fetch` uses short Undici header timeouts; the agent uses **`undici` with long defaults** for `/api/chat`. Override (ms): **`OLLAMA_HEADERS_TIMEOUT_MS`** (default `600000`), **`OLLAMA_BODY_TIMEOUT_MS`**, **`OLLAMA_CONNECT_TIMEOUT_MS`**.

**Large maps:** huge snapshots make small models **describe** the JSON instead of returning a plan (`parse-fail`). The agent caps tiles sent to the LLM (**`PLAYER_SNAPSHOT_MAX_TILES`**, default `56`; discovered tiles first). Legacy: **`EQUINOX_SNAPSHOT_MAX_TILES`** if `PLAYER_*` is unset. Raise if you use a larger model.

**Zero round (starting hex):** the agent asks Ollama to pick **`hexId`** from free tiles (not the old deterministic “first Plains”). If the tx reverts (hex taken), it retries with **`excludedHexIds`** and a new LLM call; if the model fails, a **wallet+lobby salted** fallback picks among free hexes so parallel bots diverge. Tune **`PLAYER_ZERO_ROUND_MAX_HEXES`** (default `64`, LLM list cap), **`PLAYER_ZERO_ROUND_MAX_ATTEMPTS`** (default `8`). Optional: **`PLAYER_ZERO_ROUND_JSON_FORMAT=1`** with **`OLLAMA_JSON_FORMAT=1`** enables `format: json` for that call only (no `actions` schema).

**Economy hints:** each snapshot includes **`economyHints`** from chain (`previewCraftAlloyCost`, `previewDiscoverCost`, `getVictoryGoodsThreshold`) so the model sees **`canCraftAlloy`** / **`canAffordDiscover`** instead of guessing. If the LLM still returns only **`noop`**, a small **heuristic** injects **`craftAlloy`** or **`discover`** when those flags allow it.

Debug empty replies: **`PLAYER_DEBUG=1`** (legacy **`EQUINOX_DEBUG=1`** also works).

Probe locally: `cd agents/player && node scripts/probe-ollama.mjs llama3.2:latest`

## Agent wallet & balance

Default **`AGENT_ACCOUNT_INDEX=10`** (Compose service `equinox-agent`) uses the same **Anvil/Hardhat mnemonic** as the rest of the repo (`candy maple…`). Docker Compose runs **four** sample bots on indices **10–13**; the **ganache** service is configured with enough derived accounts (**16**) so those indices exist. All are prefunded with **1000 ETH** on local Anvil.

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
# one bot (Equinox sample persona)
docker compose up agent-registry equinox-agent

# Equinox + Aurora + Crucible + Drift (same image `cryptocatan/player-agent:local`, staggered POLL_MS)
docker compose up agent-registry equinox-agent aurora-agent crucible-agent drift-agent
```

Ensure **Ollama** is listening on the host and `contracts/deployments/localhost.json` is mounted (Compose maps `./contracts/deployments`).

Compose defines **`player-agent-image`** once (build + tag `cryptocatan/player-agent:local`); the four bot services only reference that image so Docker does not run parallel builds that race on the same tag. To build the player image alone: `docker compose build player-agent-image`.

## Local dev without Docker

```bash
cd agents/registry && npm install && npm start
cd agents/player && npm install && DEPLOYMENTS_PATH=../../contracts/deployments/localhost.json npm run dev
```
