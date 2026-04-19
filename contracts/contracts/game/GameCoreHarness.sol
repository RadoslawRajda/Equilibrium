// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./GameCore.sol";

contract GameCoreHarness is GameCore {
    constructor(address _lobbyManager) GameCore(_lobbyManager) {}

    function debugSetPlayerResources(uint256 lobbyId, address player, Resources calldata resources) external {
        lobbies[lobbyId].playerState[player].resources = resources;
    }
}