// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Central economy tuning — paced for ~10–15 rounds to decisive play (alloy win) in typical sessions.
library GameConfig {
    function energyMax() internal pure returns (uint256) {
        return 100;
    }

    function energyRegenPerRound() internal pure returns (uint256) {
        return 50;
    }

    function discoverEnergyCost() internal pure returns (uint256) {
        return 0;
    }

    function buildEnergyCost() internal pure returns (uint256) {
        return 50;
    }

    function upgradeEnergyCost() internal pure returns (uint256) {
        return 0;
    }

    function craftAlloyEnergyCost() internal pure returns (uint256) {
        return 0;
    }

    function tradingEnergyCost() internal pure returns (uint256) {
        return 0;
    }

    /// Starting stock: enough for early builds; not so large that the mid-game never arrives.
    function startingResources() internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        return (18, 18, 18, 18, 36);
    }

    function buildCost() internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        return (5, 5, 5, 0, buildEnergyCost());
    }

    function upgradeCost() internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        return (0, 0, 5, 5, upgradeEnergyCost());
    }

    /// Discovery scales with empire size; capped so late game stays affordable.
    function discoverCost(uint256 ownedHexCount) internal pure returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        uint256 resourceCost = 5;
        for (uint256 i = 1; i < ownedHexCount; i++) {
            resourceCost += 5;
        }
        if (resourceCost > 20) {
            resourceCost = 20;
        }

        return (resourceCost, resourceCost, resourceCost, resourceCost, discoverEnergyCost());
    }

    function collectionEnergyCost(uint8 structureLevel) internal pure returns (uint256) {
        return structureLevel == 1 ? 0 : 0;
    }

    /// @dev Basic resource units gained from one collect (biome selects which kind); tune with `collectionEnergyCost`.
    function collectionResourceYield(uint8 structureLevel) internal pure returns (uint256) {
        return structureLevel == 1 ? 30 : 45;
    }

    function endRoundAdvanceSeconds() internal pure returns (uint256) {
        return 200;
    }

    /// @dev Default zero-round wall clock for new matches (`GameCore.startGame`); keep in line with round pacing.
    function defaultZeroRoundSeconds() internal pure returns (uint256) {
        return endRoundAdvanceSeconds();
    }

    /// @dev Default running-round wall clock for `startGame` / `advanceRound` when the host uses defaults.
    function defaultRunningRoundSeconds() internal pure returns (uint256) {
        return endRoundAdvanceSeconds();
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
        return (10, 10, 10, 10, craftAlloyEnergyCost());
    }

    function craftAlloyYield() internal pure returns (uint256) {
        return 1;
    }

    /// @dev First to this many alloy wins (while Running).
    function victoryGoodsThreshold() internal pure returns (uint256) {
        return 5;
    }
}
