// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IERC8004PlayerAgent is IERC165 {
    function decideAction(uint256 lobbyId, bytes calldata snapshot)
        external
        returns (string memory kind, string memory payload);
}

/// @notice On-chain ERC-8004 identity controlled by one wallet (bot operator).
/// @dev `decideAction` is intentionally simple; real planning still happens off-chain.
contract ERC8004PlayerAgentIdentity is ERC165, IERC8004PlayerAgent {
    address public immutable controller;
    string public agentName;
    string public metadataURI;

    string private nextKind;
    string private nextPayload;

    event IdentityMetadataUpdated(string agentName, string metadataURI);
    event NextActionConfigured(string kind, string payload);

    modifier onlyController() {
        require(msg.sender == controller, "Only controller");
        _;
    }

    constructor(address controllerAddress, string memory name, string memory metadata) {
        require(controllerAddress != address(0), "Controller required");
        controller = controllerAddress;
        agentName = name;
        metadataURI = metadata;
    }

    function setMetadata(string calldata name, string calldata metadata) external onlyController {
        agentName = name;
        metadataURI = metadata;
        emit IdentityMetadataUpdated(name, metadata);
    }

    function configureNextAction(string calldata kind, string calldata payload) external onlyController {
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
        return interfaceId == type(IERC8004PlayerAgent).interfaceId || super.supportsInterface(interfaceId);
    }
}

contract ERC8004PlayerAgentRegistry is Ownable2Step {
    struct AgentStats {
        uint256 gamesPlayed;
        uint256 gamesWon;
        uint256 lastLobbyId;
        uint256 registeredAt;
        bool active;
    }

    mapping(address => address) public controllerToAgent;
    mapping(address => address) public agentToController;
    mapping(address => AgentStats) public agentStats;
    mapping(uint256 => bool) public lobbyResultRecorded;
    address[] private agentList;

    /// @notice Address allowed to write game outcomes (`LobbyManager`).
    address public statsUpdater;

    event StatsUpdaterUpdated(address indexed previousUpdater, address indexed newUpdater);
    event AgentRegistered(address indexed controller, address indexed agent, string name, string metadataURI);
    event AgentDeactivated(address indexed controller, address indexed agent);
    event AgentGameRecorded(address indexed agent, uint256 indexed lobbyId, bool won, uint256 gamesPlayed, uint256 gamesWon);

    modifier onlyStatsUpdater() {
        require(msg.sender == statsUpdater, "Only stats updater");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setStatsUpdater(address newUpdater) external onlyOwner {
        emit StatsUpdaterUpdated(statsUpdater, newUpdater);
        statsUpdater = newUpdater;
    }

    function createAndRegisterAgent(string calldata name, string calldata metadataURI) external returns (address agent) {
        require(controllerToAgent[msg.sender] == address(0), "Controller already registered");
        ERC8004PlayerAgentIdentity created = new ERC8004PlayerAgentIdentity(msg.sender, name, metadataURI);
        agent = address(created);
        _registerAgent(msg.sender, agent, name, metadataURI);
    }

    function registerExistingAgent(address agent, string calldata name, string calldata metadataURI) external {
        require(agent != address(0), "Agent required");
        require(controllerToAgent[msg.sender] == address(0), "Controller already registered");
        require(agentToController[agent] == address(0), "Agent already registered");
        require(IERC165(agent).supportsInterface(type(IERC8004PlayerAgent).interfaceId), "Missing ERC8004 interface");
        _registerAgent(msg.sender, agent, name, metadataURI);
    }

    function deactivateMyAgent() external {
        address agent = controllerToAgent[msg.sender];
        require(agent != address(0), "No registered agent");
        delete controllerToAgent[msg.sender];
        delete agentToController[agent];
        agentStats[agent].active = false;
        emit AgentDeactivated(msg.sender, agent);
    }

    function getAgentByController(address controller) external view returns (address) {
        return controllerToAgent[controller];
    }

    function getAgentCount() external view returns (uint256) {
        return agentList.length;
    }

    function getAgentAt(uint256 index) external view returns (address) {
        return agentList[index];
    }

    struct ListedAgent {
        address agent;
        address controller;
        string name;
    }

    /// @notice Paginated listing for UIs / bots (reads `agentName` from each identity contract).
    function listAgents(uint256 offset, uint256 max) external view returns (ListedAgent[] memory) {
        uint256 total = agentList.length;
        if (offset >= total) {
            return new ListedAgent[](0);
        }
        uint256 end = offset + max;
        if (end > total) {
            end = total;
        }
        uint256 n = end - offset;
        ListedAgent[] memory out = new ListedAgent[](n);
        for (uint256 i = 0; i < n; i++) {
            address agent = agentList[offset + i];
            address controller = agentToController[agent];
            string memory name;
            try ERC8004PlayerAgentIdentity(agent).agentName() returns (string memory nm) {
                name = nm;
            } catch {
                name = "";
            }
            out[i] = ListedAgent({ agent: agent, controller: controller, name: name });
        }
        return out;
    }

    function recordLobbyResult(uint256 lobbyId, address[] calldata players, address winner) external onlyStatsUpdater {
        require(!lobbyResultRecorded[lobbyId], "Lobby result already recorded");
        lobbyResultRecorded[lobbyId] = true;

        for (uint256 i = 0; i < players.length; i++) {
            address controller = players[i];
            address agent = controllerToAgent[controller];
            if (agent == address(0)) {
                continue;
            }
            AgentStats storage stats = agentStats[agent];
            stats.gamesPlayed += 1;
            stats.lastLobbyId = lobbyId;
            if (controller == winner) {
                stats.gamesWon += 1;
            }
            emit AgentGameRecorded(agent, lobbyId, controller == winner, stats.gamesPlayed, stats.gamesWon);
        }
    }

    function _registerAgent(address controller, address agent, string calldata name, string calldata metadataURI) internal {
        controllerToAgent[controller] = agent;
        agentToController[agent] = controller;
        AgentStats storage stats = agentStats[agent];
        if (stats.registeredAt == 0) {
            stats.registeredAt = block.timestamp;
            agentList.push(agent);
        }
        stats.active = true;
        emit AgentRegistered(controller, agent, name, metadataURI);
    }
}
