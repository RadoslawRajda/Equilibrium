// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library GameConfig {
    function startingResources() internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        return (50, 50, 50, 50, 100);
    }

    function buildCost() internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        return (10, 10, 10, 0, 0);
    }

    function upgradeCost() internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        return (30, 0, 30, 30, 0);
    }

    function discoverCost(uint256 ownedHexCount) internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        uint256 resourceCost = 40;
        for (uint256 i = 1; i < ownedHexCount; i++) {
            resourceCost = (resourceCost * 3 + 1) / 2;
        }

        return (resourceCost, resourceCost, resourceCost, resourceCost, 0);
    }

    function collectionEnergyCost(uint8 structureLevel) internal pure returns (uint256) {
        return structureLevel == 1 ? 10 : 20;
    }

    function endRoundAdvanceSeconds() internal pure returns (uint256) {
        return 300;
    }
}