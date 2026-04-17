// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./ActorAware.sol";

contract AIGameMaster is ActorAware {
    struct LoggedEvent {
        string name;
        string payload;
        uint256 timestamp;
    }

    struct RoundState {
        uint256 index;
        uint256 nextRoundAt;
        uint256 durationSeconds;
        bool active;
    }

    LoggedEvent[] public eventsLog;
    mapping(uint256 => RoundState) public rounds;

    event ActionLogged(uint256 indexed lobbyId, address indexed actor, string kind, string payload, uint256 timestamp);
    event RoundStarted(uint256 indexed lobbyId, uint256 indexed roundIndex, uint256 nextRoundAt);
    event RoundEnded(uint256 indexed lobbyId, uint256 indexed roundIndex, uint256 endedAt);
    event AIEventLogged(string indexed name, string payload, uint256 timestamp);

    constructor() {}

    function logAction(uint256 lobbyId, string calldata kind, string calldata payload) external returns (uint256) {
        address actor = _actor();
        eventsLog.push(LoggedEvent({name: kind, payload: payload, timestamp: block.timestamp}));
        emit ActionLogged(lobbyId, actor, kind, payload, block.timestamp);
        return eventsLog.length - 1;
    }

    function startRound(uint256 lobbyId, uint256 durationSeconds) external returns (uint256) {
        RoundState storage round = rounds[lobbyId];
        round.index += 1;
        round.active = true;
        round.durationSeconds = durationSeconds;
        round.nextRoundAt = block.timestamp + durationSeconds;
        emit RoundStarted(lobbyId, round.index, round.nextRoundAt);
        return round.index;
    }

    function endRound(uint256 lobbyId) external returns (uint256) {
        RoundState storage round = rounds[lobbyId];
        require(round.active, "Round not active");
        require(block.timestamp >= round.nextRoundAt, "Round still running");

        round.active = false;
        emit RoundEnded(lobbyId, round.index, block.timestamp);

        round.index += 1;
        round.active = true;
        round.nextRoundAt = block.timestamp + round.durationSeconds;
        emit RoundStarted(lobbyId, round.index, round.nextRoundAt);

        return round.index;
    }

    function getRound(uint256 lobbyId) external view returns (uint256 index, uint256 nextRoundAt, bool active) {
        RoundState storage round = rounds[lobbyId];
        return (round.index, round.nextRoundAt, round.active);
    }

    function logEvent(string calldata name, string calldata payload) external onlyOwner {
        eventsLog.push(LoggedEvent({name: name, payload: payload, timestamp: block.timestamp}));
        emit AIEventLogged(name, payload, block.timestamp);
    }

    function eventsCount() external view returns (uint256) {
        return eventsLog.length;
    }
}
