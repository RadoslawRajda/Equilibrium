// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

import { IAgentStatsRegistryBase } from "../ai/ERC8004PlayerAgentRegistry.sol";
import { IExperienceStatsRegistry } from "../lobby/LobbyManager.sol";

contract ExperienceStats is Ownable2Step, IAgentStatsRegistryBase, IExperienceStatsRegistry {
    struct PlayerStats {
        uint256 experiencePoints;
        uint256 gamesPlayed;
        uint256 gamesWon;
        uint256 gamesLeft;
        uint256 lastLobbyId;
        uint256 firstSeenAt;
        bool active;
    }

    struct ListedPlayerStats {
        address player;
        uint256 experiencePoints;
        uint256 gamesPlayed;
        uint256 gamesWon;
        uint256 gamesLeft;
        uint256 lastLobbyId;
        uint256 firstSeenAt;
        bool active;
    }

    mapping(address => PlayerStats) public playerStats;
    mapping(uint256 => bool) public lobbyResultRecorded;
    mapping(uint256 => mapping(address => bool)) public lobbyExitRecorded;
    address[] private playerList;

    address public statsUpdater;

    event StatsUpdaterUpdated(address indexed previousUpdater, address indexed newUpdater);
    event PlayerExperienceUpdated(address indexed player, uint256 experiencePoints, uint256 gamesPlayed, uint256 gamesWon, uint256 gamesLeft);
    event LobbyExperienceRecorded(uint256 indexed lobbyId, address indexed player, bool won, uint256 pointsAdded, uint256 totalPoints);
    event PlayerExitPenalized(uint256 indexed lobbyId, address indexed player, uint256 penalty, uint256 totalPoints);

    modifier onlyStatsUpdater() {
        require(msg.sender == statsUpdater, "Only stats updater");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setStatsUpdater(address newUpdater) external onlyOwner {
        require(newUpdater != address(0), "Updater address required");
        emit StatsUpdaterUpdated(statsUpdater, newUpdater);
        statsUpdater = newUpdater;
    }

    /// @notice Compatibility entrypoint used by LobbyManager + ERC8004 registry flow.
    function recordLobbyResult(uint256 lobbyId, address[] calldata players, address winner) external onlyStatsUpdater {
        _recordGameResult(lobbyId, players, winner);
    }

    function recordGameResult(uint256 lobbyId, address[] calldata players, address winner) external onlyStatsUpdater {
        _recordGameResult(lobbyId, players, winner);
    }

    function _recordGameResult(uint256 lobbyId, address[] calldata players, address winner) internal {
        require(!lobbyResultRecorded[lobbyId], "Lobby result already recorded");
        require(players.length > 0, "Players required");

        address[] memory uniquePlayers = new address[](players.length);
        uint256 uniqueCount = 0;
        bool winnerPresent = winner == address(0);

        for (uint256 i = 0; i < players.length; i++) {
            address player = players[i];
            if (player == address(0)) {
                continue;
            }
            bool seen = false;
            for (uint256 j = 0; j < uniqueCount; j++) {
                if (uniquePlayers[j] == player) {
                    seen = true;
                    break;
                }
            }
            if (seen) {
                continue;
            }
            uniquePlayers[uniqueCount] = player;
            uniqueCount += 1;
            if (player == winner) {
                winnerPresent = true;
            }
        }

        require(uniqueCount > 0, "Players required");
        require(winnerPresent, "Winner must be in players");

        lobbyResultRecorded[lobbyId] = true;

        for (uint256 i = 0; i < uniqueCount; i++) {
            address player = uniquePlayers[i];
            PlayerStats storage stats = _touch(player);
            stats.lastLobbyId = lobbyId;
            if (player == winner) {
                stats.gamesPlayed += 1;
                stats.gamesWon += 1;
                stats.experiencePoints += 10;
                emit LobbyExperienceRecorded(lobbyId, player, true, 10, stats.experiencePoints);
            } else if (!lobbyExitRecorded[lobbyId][player]) {
                stats.gamesPlayed += 1;
                stats.experiencePoints += 1;
                emit LobbyExperienceRecorded(lobbyId, player, false, 1, stats.experiencePoints);
            }

            emit PlayerExperienceUpdated(
                player,
                stats.experiencePoints,
                stats.gamesPlayed,
                stats.gamesWon,
                stats.gamesLeft
            );
        }
    }

    function recordLobbyExit(uint256 lobbyId, address player) external onlyStatsUpdater {
        _recordLobbyExit(lobbyId, player);
    }

    function recordLobbyExits(uint256 lobbyId, address[] calldata players) external onlyStatsUpdater {
        for (uint256 i = 0; i < players.length; i++) {
            _recordLobbyExit(lobbyId, players[i]);
        }
    }

    function _recordLobbyExit(uint256 lobbyId, address player) internal {
        if (player == address(0)) {
            return;
        }
        if (lobbyExitRecorded[lobbyId][player]) {
            return;
        }
        lobbyExitRecorded[lobbyId][player] = true;
        PlayerStats storage stats = _touch(player);
        stats.gamesLeft += 1;
        stats.lastLobbyId = lobbyId;
        if (stats.experiencePoints > 0) {
            stats.experiencePoints -= 1;
        }
        emit PlayerExitPenalized(lobbyId, player, 1, stats.experiencePoints);
        emit PlayerExperienceUpdated(
            player,
            stats.experiencePoints,
            stats.gamesPlayed,
            stats.gamesWon,
            stats.gamesLeft
        );
    }

    function getPlayerCount() external view returns (uint256) {
        return playerList.length;
    }

    function getPlayerAt(uint256 index) external view returns (address) {
        return playerList[index];
    }

    function listPlayers(uint256 offset, uint256 max) external view returns (ListedPlayerStats[] memory) {
        uint256 total = playerList.length;
        if (offset >= total) {
            return new ListedPlayerStats[](0);
        }
        uint256 end = offset + max;
        if (end > total) {
            end = total;
        }
        uint256 n = end - offset;
        ListedPlayerStats[] memory out = new ListedPlayerStats[](n);
        for (uint256 i = 0; i < n; i++) {
            address player = playerList[offset + i];
            PlayerStats storage stats = playerStats[player];
            out[i] = ListedPlayerStats({
                player: player,
                experiencePoints: stats.experiencePoints,
                gamesPlayed: stats.gamesPlayed,
                gamesWon: stats.gamesWon,
                gamesLeft: stats.gamesLeft,
                lastLobbyId: stats.lastLobbyId,
                firstSeenAt: stats.firstSeenAt,
                active: stats.active
            });
        }
        return out;
    }

    function _touch(address player) internal returns (PlayerStats storage stats) {
        stats = playerStats[player];
        if (stats.firstSeenAt == 0) {
            stats.firstSeenAt = block.timestamp;
            playerList.push(player);
        }
        stats.active = true;
    }
}
