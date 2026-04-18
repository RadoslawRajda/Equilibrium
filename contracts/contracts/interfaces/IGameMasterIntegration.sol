// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IGameMasterIntegration (documentation only)
 * @notice Historical notes for an earlier AI game-master architecture.
 *
 * The on-chain core no longer exposes game-master write methods. Keep agent policy,
 * narrative, and orchestration off-chain; if you need authenticated balance changes,
 * route them through a dedicated auxiliary contract instead of GameCore.
 */
interface IGameMasterIntegration {}
