// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../access/ActorAware.sol";

contract Voting is ActorAware {
    struct Proposal {
        string title;
        string effectKey;
        uint256 startTime;
        uint256 endTime;
        uint256 yesVotes;
        uint256 noVotes;
        bool executed;
    }

    Proposal[] public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event ProposalCreated(uint256 indexed proposalId, string title, string effectKey);
    event Voted(uint256 indexed proposalId, address indexed voter, bool support);
    event ProposalExecuted(uint256 indexed proposalId, bool passed);

    constructor() {}

    function createProposal(string calldata title, string calldata effectKey, uint256 durationSeconds) external onlyOwner returns (uint256) {
        proposals.push(Proposal({
            title: title,
            effectKey: effectKey,
            startTime: block.timestamp,
            endTime: block.timestamp + durationSeconds,
            yesVotes: 0,
            noVotes: 0,
            executed: false
        }));

        uint256 proposalId = proposals.length - 1;
        emit ProposalCreated(proposalId, title, effectKey);
        return proposalId;
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage proposal = proposals[proposalId];
        address voter = _actor();
        require(block.timestamp <= proposal.endTime, "Voting closed");
        require(!hasVoted[proposalId][voter], "Already voted");

        hasVoted[proposalId][voter] = true;
        if (support) {
            proposal.yesVotes += 1;
        } else {
            proposal.noVotes += 1;
        }

        emit Voted(proposalId, voter, support);
    }

    function executeProposal(uint256 proposalId) external onlyOwner returns (bool passed) {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp > proposal.endTime, "Voting still active");
        require(!proposal.executed, "Already executed");

        proposal.executed = true;
        passed = proposal.yesVotes > proposal.noVotes;

        emit ProposalExecuted(proposalId, passed);
    }
}
