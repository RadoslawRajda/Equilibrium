// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev LobbyManager payout hook called by GameCore when a winner is determined on-chain.
interface ILobbyManagerPrize {
    function notifyGameWinner(uint256 lobbyId, address winner) external;
}
