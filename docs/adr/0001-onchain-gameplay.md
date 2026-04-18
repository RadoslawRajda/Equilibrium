# ADR 0001: On-chain Gameplay as the Source of Truth

## Status
Proposed

## Context
Equilibrium currently splits gameplay between three layers:
- Solidity contracts that already own part of the game state.
- A Node/Express/Socket.IO backend that still mutates a parallel off-chain engine.
- A React/Vite frontend that reconstructs part of the game state and projects timers locally.

This creates duplicated rules, race conditions, 2-step actions, and inconsistent state sources.

## Decision
Move gameplay authority fully on-chain and reduce the backend to an optional read-only helper.

### Target shape
```text
Frontend (read model + tx adapter)
  -> reads chain state, events, and config
  -> sends gameplay txs directly to contracts

Contracts
  GameCore
    -> entrypoint / orchestrator
  GameStorage / registries
    -> lobby, player, tile, trade, proposal, config state
  Rules modules
    -> map, round, hex, trade, voting, GM policy
  Optional adapters
    -> GM, AI, session-key authorizer, 4337 paymaster hooks

Backend (optional)
  -> deployment/ABI sync
  -> indexer-lite/cache for UI
  -> no gameplay authority
```

## Current Code Map
The existing repo already has most of the state split, but the ownership is still mixed:

- `contracts/contracts/GameCore.sol`: current gameplay hub and best candidate for the first modular split.
- `contracts/contracts/LobbyManager.sol`: legacy lobby and prize-flow path that overlaps with GameCore ticketing and lobby lifecycle.
- `contracts/contracts/Voting.sol`: parallel voting logic that should be merged into the main rules surface or replaced by a shared module.
- `contracts/contracts/AIGameMaster.sol`: logging and AI-adjacent hook, currently closer to an adapter than authority.
- `contracts/contracts/PlayerState.sol`, `Structures.sol`, `Season.sol`, `Ticket.sol`: domain fragments that should become storage or registry inputs instead of independent rule owners.
- `backend/src/gameEngine.js` and `backend/src/index.js`: duplicate authority today; these should end up as sync/indexer-only paths.
- `frontend/src/App.tsx` and related components: should stay read-model driven and consume contract previews and events instead of local rule copies.

This map matters because the first extraction target should be the rule/config layer, not the UI or transport layer.

## Contract modularity
Use modular contracts plus a central `GameCore`, not a Diamond yet.

Reasons:
- Smaller blast radius for storage changes.
- Simpler tests and deployment.
- Easier staged removal of backend gameplay.
- Easier future migration to account abstraction and AI adapters.

## Configuration model
Use versioned, data-driven config per lobby or season.

Recommended config buckets:
- ticket price
- round durations
- starting resources
- build/upgrade/discover costs
- resource registry
- structure registry
- recipe registry
- event registry / GM policy registry
- session-key limits

Config should be keyed by stable identifiers (`bytes32`) and snapshot at lobby start.
Existing lobbies should not change rules mid-game unless explicitly versioned and tested.

## GM / AI direction
The Game Master should be optional.

If present:
- host sets a GM address at lobby creation or before start
- GM may only trigger allowlisted event actions
- GM cannot transfer player funds or bypass invariants
- every GM action must emit auditable events

If absent:
- gameplay remains deterministic and fully playable.

## 4337 direction
The gameplay contracts should distinguish identity from `msg.sender`.

Planned flow:
- player identity is resolved by an adapter
- session key registry limits action scope
- paymaster sponsorship can be tied to ticket pool / lobby funds
- frontend stays on wagmi/viem first, then swaps write path to bundler flow

## ERC-8004 direction
AI players and AI GM should be adapter-based, not hardcoded.

Plan:
- define `IAgent` / `IAIGameMaster` interfaces
- start with mock/stub implementations
- validate integration via tests
- wire real ERC-8004 later without changing game rules

## Migration phases
1. Freeze current on-chain rules with tests.
2. Extract config and read helpers from GameCore.
3. Move frontend reads to contract-provided previews.
4. Remove backend gameplay handlers.
5. Convert backend to read-only sync/indexer-lite.
6. Add GM/session-key adapters.
7. Add 4337 paymaster/session-key flow.
8. Add ERC-8004 adapters and mocks.

## First Refactor Slice
The next code change should be small and mechanically testable:

1. Lift remaining hardcoded rule values into explicit view helpers or a dedicated config surface.
2. Keep `GameCore` as the canonical rules entrypoint while the data moves out.
3. Add or extend Hardhat tests for any rule that becomes externally readable.
4. Only after that, delete the mirrored backend/game-engine rule path.

## Breaking changes
- Backend Socket.IO gameplay actions will be removed.
- Frontend optimistic state should only be a temporary UX hint, not authoritative logic.
- Timers should be driven by contract timestamps, not local simulation.
- Trade/vote/begin round resolution moves to chain events.
- Any duplicated engine rules outside contracts become stale and should be deleted.
