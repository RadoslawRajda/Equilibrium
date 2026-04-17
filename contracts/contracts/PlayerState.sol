// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

contract PlayerState is Ownable {
    struct Resources {
        uint256 food;
        uint256 wood;
        uint256 stone;
        uint256 ore;
        uint256 energy;
    }

    mapping(address => Resources) public playerResources;
    mapping(address => bool) public initialized;

    event PlayerInitialized(address indexed player);
    event ResourcesUpdated(address indexed player, uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy);

    constructor() {}

    function initPlayer(address player) external onlyOwner {
        require(!initialized[player], "Player already initialized");
        initialized[player] = true;
        playerResources[player] = Resources(50, 50, 50, 50, 100);
        emit PlayerInitialized(player);
    }

    function setResources(
        address player,
        uint256 food,
        uint256 wood,
        uint256 stone,
        uint256 ore,
        uint256 energy
    ) external onlyOwner {
        require(initialized[player], "Player not initialized");
        playerResources[player] = Resources(food, wood, stone, ore, energy);
        emit ResourcesUpdated(player, food, wood, stone, ore, energy);
    }
}
