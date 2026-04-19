// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Minimal LobbyManager surface for GameCore to register ticket holders on match start.
interface ILobbyManagerSync {
    function getLobbyPlayers(uint256 lobbyId) external view returns (address[] memory);

    function hasTicket(uint256 lobbyId, address player) external view returns (bool);
}
