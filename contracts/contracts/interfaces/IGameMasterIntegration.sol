// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IGameMasterIntegration (documentation only)
 * @notice Architecture for ERC-8004 / AI Game Master:
 *
 * 1. **Separation of concerns** — Agent personality, narrative, and policy live off-chain (or in the agent’s
 *    registry metadata). The chain only enforces **bounded, auditable effects** via `GameCore.gameMasterAdjustResources`.
 *
 * 2. **Wiring** — Host calls `GameCore.setLobbyGameMaster(lobbyId, adapterAddress)`. The adapter is typically
 *    `ERC8004AIGameMasterAdapter` or a custom contract that (a) verifies the agent, (b) optionally calls
 *    `AIGameMaster.logAction` for an append-only audit trail, (c) calls `gameMasterAdjustResources` with caps from `GameConfig`.
 *
 * 3. **Round cadence** — Indexers / bots listen to `RoundAdvanced` and push snapshots to the agent; the adapter
 *    submits adjustments once per policy window (not inside player txs — avoids reentrancy and keeps gas predictable).
 *
 * 4. **Future** — Replace `grant/take` with a typed effect enum + router if you add crafting, disasters, or dynamic rules.
 */
interface IGameMasterIntegration {}
