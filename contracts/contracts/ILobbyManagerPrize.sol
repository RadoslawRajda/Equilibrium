// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev LobbyManager hook when GameCore ends a match on-chain. `winner == address(0)` means abandon; sponsor remainder is split for `withdraw()`.
interface ILobbyManagerPrize {
    function notifyGameSettled(uint256 lobbyId, address winner) external;
}
