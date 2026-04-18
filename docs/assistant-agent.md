# Assistant Agent

Assistant agent is a standalone HTTP service running as a separate Docker image. It reads the current game context from chain and answers player questions.

## Endpoint

POST /api/assistant/ask

Body JSON:
{
  "lobbyId": "1",
  "playerAddress": "0x0000000000000000000000000000000000000000",
  "prompt": "Co powinienem zrobic w tej turze?"
}

Response JSON:
{
  "answer": "...",
  "contextUsed": {
    "lobbyId": "1",
    "playerAddress": "0x...",
    "summaryText": "..."
  }
}

## Response Mode

Ollama only (same pattern as player-agent):

- Uses `OLLAMA_URL` and `OLLAMA_MODEL` by default.
- Supports optional overrides `ASSISTANT_OLLAMA_URL` and `ASSISTANT_OLLAMA_MODEL`.
- Uses a fixed system prompt tailored for a helpful Equilibrium rules + strategy assistant.

## ENV

- PORT (default `4060`)
- RPC_URL (default `http://127.0.0.1:8545`)
- DEPLOYMENTS_PATH (default `/contracts/deployments/localhost.json`)
- CONTEXT_TIMEOUT_MS (default `6000`)
- OLLAMA_URL (default `http://127.0.0.1:11434`)
- OLLAMA_MODEL (default `llama3.2`)
- ASSISTANT_OLLAMA_URL (optional override for `OLLAMA_URL`)
- ASSISTANT_OLLAMA_MODEL (optional override for `OLLAMA_MODEL`)
- ASSISTANT_INCLUDE_DEBUG_CONTEXT (default `true`)

## Run

Docker Compose:

docker compose up --build assistant-agent

Full stack:

docker compose up --build

## Example curl

curl -sS http://localhost:4060/api/assistant/ask \
  -H "Content-Type: application/json" \
  -d '{
    "lobbyId": "1",
    "playerAddress": "0x0000000000000000000000000000000000000000",
    "prompt": "Explain what I can do now and what my resources mean"
  }'
