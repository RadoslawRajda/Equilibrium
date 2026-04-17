// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

contract Season is Ownable {
    uint256 public currentSeason = 1;
    bool public started;
    uint256 public startedAt;

    event SeasonStarted(uint256 indexed seasonId, uint256 startedAt);
    event NewSeason(uint256 indexed seasonId);

    constructor() {}

    function startSeason() external onlyOwner {
        require(!started, "Season already started");
        started = true;
        startedAt = block.timestamp;
        emit SeasonStarted(currentSeason, startedAt);
    }

    function nextSeason() external onlyOwner {
        currentSeason += 1;
        started = false;
        startedAt = 0;
        emit NewSeason(currentSeason);
    }
}
