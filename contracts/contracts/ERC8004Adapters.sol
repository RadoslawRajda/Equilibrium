// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "./AIGameMaster.sol";

interface IERC8004Agent is IERC165 {
    function decideAction(uint256 lobbyId, bytes calldata snapshot)
        external
        returns (string memory kind, string memory payload);
}

contract MockERC8004Agent is Ownable2Step, ERC165, IERC8004Agent {
    constructor() Ownable(msg.sender) {}

    string public nextKind;
    string public nextPayload;

    event NextActionConfigured(string kind, string payload);

    function configureNextAction(string calldata kind, string calldata payload) external onlyOwner {
        nextKind = kind;
        nextPayload = payload;
        emit NextActionConfigured(kind, payload);
    }

    function decideAction(uint256, bytes calldata)
        external
        view
        returns (string memory kind, string memory payload)
    {
        return (nextKind, nextPayload);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IERC8004Agent).interfaceId || super.supportsInterface(interfaceId);
    }
}

/// @dev Relays agent decisions into `AIGameMaster` logs. To **affect balances**, also wire the same (or another)
///      trusted address via `GameCore.setLobbyGameMaster` and call `gameMasterAdjustResources` from this adapter
///      after `decideAction` (see `IGameMasterIntegration.sol` in /interfaces).
contract ERC8004AIGameMasterAdapter is Ownable2Step, ReentrancyGuard {
    address public agent;
    AIGameMaster public gameMaster;

    event AgentUpdated(address indexed previousAgent, address indexed newAgent);
    event GameMasterUpdated(address indexed previousGameMaster, address indexed newGameMaster);
    event AIActionRelayed(uint256 indexed lobbyId, address indexed agent, string kind, string payload);

    constructor(address gameMasterAddress) Ownable(msg.sender) {
        gameMaster = AIGameMaster(gameMasterAddress);
    }

    function setAgent(address newAgent) external onlyOwner {
        require(newAgent != address(0), "Agent address required");
        emit AgentUpdated(agent, newAgent);
        agent = newAgent;
    }

    function setGameMaster(address newGameMaster) external onlyOwner {
        emit GameMasterUpdated(address(gameMaster), newGameMaster);
        gameMaster = AIGameMaster(newGameMaster);
    }

    function relayAgentAction(uint256 lobbyId, bytes calldata snapshot)
        external
        onlyOwner
        nonReentrant
        returns (uint256 logIndex, string memory kind, string memory payload)
    {
        require(agent != address(0), "Agent not set");
        require(IERC165(agent).supportsInterface(type(IERC8004Agent).interfaceId), "Agent missing ERC8004 interface");
        (kind, payload) = IERC8004Agent(agent).decideAction(lobbyId, snapshot);
        logIndex = gameMaster.logAction(lobbyId, kind, payload);
        emit AIActionRelayed(lobbyId, agent, kind, payload);
    }
}
