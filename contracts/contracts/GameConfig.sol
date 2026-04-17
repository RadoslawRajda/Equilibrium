// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Central economy tuning. Bank gives a sink/source independent of other players (Catan-style).
library GameConfig {
    /// Starting stock: enough for several actions; bank 4:1 covers dry spells when P2P trade fails.
    function startingResources() internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        return (48, 48, 48, 48, 96);
    }

    function buildCost() internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        return (10, 10, 10, 0, 0);
    }

    function upgradeCost() internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        return (28, 0, 28, 28, 0);
    }

    /// Discovery scales with empire size; curve slightly gentler than pure exponential.
    function discoverCost(uint256 ownedHexCount) internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        uint256 resourceCost = 36;
        for (uint256 i = 1; i < ownedHexCount; i++) {
            resourceCost += 8;
        }
        if (resourceCost > 80) {
            resourceCost = 80;
        }

        return (resourceCost, resourceCost, resourceCost, resourceCost, 0);
    }

    function collectionEnergyCost(uint8 structureLevel) internal pure returns (uint256) {
        return structureLevel == 1 ? 10 : 20;
    }

    function endRoundAdvanceSeconds() internal pure returns (uint256) {
        return 300;
    }

    /// @dev Pay `giveAmount` of one basic resource (0–3) to receive `receiveAmount` of another.
    function bankTradeGiveAmount() internal pure returns (uint256) {
        return 4;
    }

    function bankTradeReceiveAmount() internal pure returns (uint256) {
        return 1;
    }

    /// @dev Per-resource ceiling on *grants* in one `gameMasterAdjustResources` call (burns uncapped by player balance).
    function gameMasterMaxGrantPerResource() internal pure returns (uint256) {
        return 24;
    }

    /// @dev Smelt basic resources into one unit of “alloy” (off-chain UI can label as steel/goods).
    function craftAlloyCost() internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        return (5, 5, 5, 5, 0);
    }

    function craftAlloyYield() internal pure returns (uint256) {
        return 1;
    }

    /// @dev First player to reach this many alloy wins (while game is Running).
    function victoryGoodsThreshold() internal pure returns (uint256) {
        return 12;
    }
}
