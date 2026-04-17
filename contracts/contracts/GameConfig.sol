// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Central economy tuning — paced for ~10–15 rounds to decisive play (alloy win) in typical sessions.
library GameConfig {
    /// Starting stock: enough for early builds; not so large that the mid-game never arrives.
    function startingResources() internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        return (18, 18, 18, 18, 36);
    }

    function buildCost() internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        return (5, 5, 5, 0, 0);
    }

    function upgradeCost() internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        return (14, 0, 14, 14, 0);
    }

    /// Discovery scales with empire size; capped so late game stays affordable.
    function discoverCost(uint256 ownedHexCount) internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        uint256 resourceCost = 18;
        for (uint256 i = 1; i < ownedHexCount; i++) {
            resourceCost += 4;
        }
        if (resourceCost > 48) {
            resourceCost = 48;
        }

        return (resourceCost, resourceCost, resourceCost, resourceCost, 0);
    }

    function collectionEnergyCost(uint8 structureLevel) internal pure returns (uint256) {
        return structureLevel == 1 ? 8 : 16;
    }

    function endRoundAdvanceSeconds() internal pure returns (uint256) {
        return 300;
    }

    /// @dev Pay `giveAmount` of one basic resource (0–3) to receive `receiveAmount` of another (one “lot”).
    function bankTradeGiveAmount() internal pure returns (uint256) {
        return 4;
    }

    function bankTradeReceiveAmount() internal pure returns (uint256) {
        return 1;
    }

    /// @dev Max lots in a single `tradeWithBankBulk` call (4:1 per lot).
    function bankTradeBulkMaxLots() internal pure returns (uint256) {
        return 48;
    }

    /// @dev Per-resource ceiling on *grants* in one `gameMasterAdjustResources` call (burns uncapped by player balance).
    function gameMasterMaxGrantPerResource() internal pure returns (uint256) {
        return 24;
    }

    /// @dev Smelt basics into alloy; tuned with `victoryGoodsThreshold` for ~10–15 round games.
    function craftAlloyCost() internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        return (3, 3, 3, 3, 0);
    }

    function craftAlloyYield() internal pure returns (uint256) {
        return 1;
    }

    /// @dev First to this many alloy wins (while Running).
    function victoryGoodsThreshold() internal pure returns (uint256) {
        return 5;
    }
}
