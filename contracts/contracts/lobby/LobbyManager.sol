// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../access/ActorAware.sol";
import "./ILobbyManagerPrize.sol";
import "./ILobbyManagerSync.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";

interface IAgentStatsRegistry {
    function recordLobbyResult(uint256 lobbyId, address[] calldata players, address winner) external;
}

interface IExperienceStatsRegistry {
    function recordGameResult(uint256 lobbyId, address[] calldata players, address winner) external;

    function recordLobbyExit(uint256 lobbyId, address player) external;
    function recordLobbyExits(uint256 lobbyId, address[] calldata players) external;
}

interface IRegisteredAgentLookup {
    function getAgentByController(address controller) external view returns (address);
}

interface IGameCorePlayerStatus {
    function isPlayerAlive(uint256 lobbyId, address player) external view returns (bool);
    function getAliveStatus(uint256 lobbyId, address[] calldata players) external view returns (bool[] memory);
}

contract LobbyManager is ActorAware, ReentrancyGuard, ILobbySessionSponsorPool, ILobbyManagerPrize, ILobbyManagerSync {
    uint256 public constant TICKET_PRICE = 1 ether;
    uint256 public constant MIN_PLAYERS = 1;
    uint256 public constant MAX_PLAYERS = 8;

    enum LobbyStatus {
        OPEN,      // Przyjmuje graczy
        ACTIVE,    // Gra w toku
        COMPLETED, // Gra skończyła się
        CANCELLED  // Anulowana
    }

    struct Lobby {
        address host;
        string name;
        uint256 createdAt;
        LobbyStatus status;
        uint256 prizePool;
        address[] players;
        mapping(address => bool) hasTicket;
        address winner;
        uint256 withdrawnAmount;
    }

    mapping(uint256 => Lobby) public lobbies;
    uint256 public nextLobbyId = 1;
    mapping(address => uint256) public playerBalance;
    mapping(uint256 => uint256) public sessionSponsorPool;
    address public sessionSponsorManager;
    address public sessionPolicyRegistry;
    address public entryPoint;
    uint128 public defaultSessionMaxSponsoredWei = uint128(TICKET_PRICE);
    uint64 public defaultSessionTtlSeconds = 7 days;

    /// @dev Set once after GameCore deployment; only that contract may call `notifyGameSettled`.
    address public gameCore;
    address public agentStatsRegistry;
    address public experienceStatsRegistry;

    event LobbyCreated(uint256 indexed lobbyId, address indexed host, string name);
    event TicketBought(uint256 indexed lobbyId, address indexed player);
    event GameStarted(uint256 indexed lobbyId);
    event GameCompleted(uint256 indexed lobbyId, address indexed winner, uint256 prizeAmount);
    event LobbyCancelled(uint256 indexed lobbyId);
    event PlayerLeftOpenLobby(uint256 indexed lobbyId, address indexed player, uint256 creditedWei);
    event PlayerKickedOpenLobby(uint256 indexed lobbyId, address indexed kicked, uint256 creditedWei);
    event SessionSponsorManagerUpdated(address indexed previousManager, address indexed newManager);
    event SessionPolicyRegistryUpdated(address indexed previousRegistry, address indexed newRegistry);
    event EntryPointUpdated(address indexed previousEntryPoint, address indexed newEntryPoint);
    event SessionSponsorPoolConsumed(uint256 indexed lobbyId, uint256 amount, address indexed receiver);
    event SessionSponsorRefunded(uint256 indexed lobbyId, uint256 weiTotal);
    event DefaultSessionPolicyUpdated(uint128 maxSponsoredWei, uint64 ttlSeconds);
    event SessionPolicyProvisioned(
        uint256 indexed lobbyId,
        address indexed actor,
        address indexed sessionKey,
        uint64 expiresAt,
        uint128 maxSponsoredWei
    );
    event AgentStatsRegistryUpdated(address indexed previousRegistry, address indexed newRegistry);
    event ExperienceStatsRegistryUpdated(address indexed previousRegistry, address indexed newRegistry);
    event LobbyAgentInvited(uint256 indexed lobbyId, address indexed controller, address indexed host);
    event LobbyAgentInviteCleared(uint256 indexed lobbyId, address indexed controller);

    /// @dev Controller wallet of a registered ERC-8004 player agent; host sets this so the bot can discover the lobby on-chain.
    mapping(uint256 => mapping(address => bool)) public lobbyAgentInvite;

    function setGameCore(address _gameCore) external onlyOwner {
        require(gameCore == address(0) && _gameCore != address(0), "GameCore already set");
        gameCore = _gameCore;
    }

    function setAgentStatsRegistry(address newRegistry) external onlyOwner {
        require(newRegistry != address(0), "Registry address required");
        emit AgentStatsRegistryUpdated(agentStatsRegistry, newRegistry);
        agentStatsRegistry = newRegistry;
    }

    function setExperienceStatsRegistry(address newRegistry) external onlyOwner {
        require(newRegistry != address(0), "Registry address required");
        emit ExperienceStatsRegistryUpdated(experienceStatsRegistry, newRegistry);
        experienceStatsRegistry = newRegistry;
    }

    function setSessionPolicyRegistry(address newRegistry) external onlyOwner {
        require(newRegistry != address(0), "Registry address required");
        emit SessionPolicyRegistryUpdated(sessionPolicyRegistry, newRegistry);
        sessionPolicyRegistry = newRegistry;
    }

    function setEntryPoint(address newEntryPoint) external onlyOwner {
        require(newEntryPoint != address(0), "EntryPoint address required");
        emit EntryPointUpdated(entryPoint, newEntryPoint);
        entryPoint = newEntryPoint;
    }

    function setDefaultSessionPolicy(uint128 maxSponsoredWei, uint64 ttlSeconds) external onlyOwner {
        require(ttlSeconds > 0, "Session ttl must be > 0");
        defaultSessionMaxSponsoredWei = maxSponsoredWei;
        defaultSessionTtlSeconds = ttlSeconds;
        emit DefaultSessionPolicyUpdated(maxSponsoredWei, ttlSeconds);
    }

    function setSessionSponsorManager(address newManager) external onlyOwner {
        require(newManager != address(0), "Manager address required");
        emit SessionSponsorManagerUpdated(sessionSponsorManager, newManager);
        sessionSponsorManager = newManager;
    }

    /// @notice Pulls up to `amount` wei from the lobby sponsor pool (never reverts for "too little" — used after UserOp `execute` when `postOp` still needs reimbursement).
    function consumeSessionSponsorPool(uint256 _lobbyId, uint256 amount, address payable receiver) external nonReentrant {
        require(msg.sender == sessionSponsorManager, "Only session sponsor manager");
        require(receiver != address(0), "Receiver address required");
        if (amount == 0) {
            return;
        }
        uint256 bal = sessionSponsorPool[_lobbyId];
        if (bal == 0) {
            return;
        }
        uint256 take = amount <= bal ? amount : bal;
        sessionSponsorPool[_lobbyId] = bal - take;
        emit SessionSponsorPoolConsumed(_lobbyId, take, receiver);
        Address.sendValue(receiver, take);
    }

    /// @notice Full ticket is credited to `sessionSponsorPool` so cancel/leave/refunds return everything still on this contract (gas is only tx fees). AA / paymaster pulls from this pool; no ticket ETH is sent to EntryPoint here.
    function _routeTicketToSponsors(uint256 lobbyId, address /* sessionKey */) internal {
        sessionSponsorPool[lobbyId] += TICKET_PRICE;
    }

    /// @dev Splits remaining `sessionSponsorPool` equally across current `lobby.players` into `playerBalance` for `withdraw()`.
    function _splitSessionSponsorToPlayerBalances(uint256 _lobbyId) internal {
        Lobby storage lobby = lobbies[_lobbyId];
        uint256 sponsor = sessionSponsorPool[_lobbyId];
        if (sponsor == 0) {
            return;
        }
        sessionSponsorPool[_lobbyId] = 0;
        uint256 n = lobby.players.length;
        require(n > 0, "No players");
        uint256 per = sponsor / n;
        uint256 rem = sponsor % n;
        for (uint256 i = 0; i < n; i++) {
            uint256 extra = i < rem ? 1 : 0;
            playerBalance[lobby.players[i]] += per + extra;
        }
        emit SessionSponsorRefunded(_lobbyId, sponsor);
    }

    // Tworzenie lobby: właściciel od razu kupuje bilet
    function createLobby(string memory _name) external payable returns (uint256) {
        require(msg.value == TICKET_PRICE, "Must send exact ticket price");
        address player = _actor();

        uint256 lobbyId = _createLobbyInternal(_name, player);
        _routeTicketToSponsors(lobbyId, address(0));
        return lobbyId;
    }

    function createLobbyWithSession(
        string memory _name,
        address sessionKey,
        uint128 maxSponsoredWei,
        uint64 ttlSeconds
    ) external payable nonReentrant returns (uint256) {
        require(msg.value == TICKET_PRICE, "Must send exact ticket price");
        address player = _actor();

        uint256 lobbyId = _createLobbyInternal(_name, player);
        _routeTicketToSponsors(lobbyId, sessionKey);

        uint128 policyMax = maxSponsoredWei == 0 ? uint128(TICKET_PRICE) : maxSponsoredWei;
        _provisionSessionPolicy(
            lobbyId,
            player,
            sessionKey,
            policyMax,
            ttlSeconds == 0 ? defaultSessionTtlSeconds : ttlSeconds
        );

        return lobbyId;
    }

    function _createLobbyInternal(string memory _name, address player) internal returns (uint256) {

        uint256 lobbyId = nextLobbyId++;
        Lobby storage lobby = lobbies[lobbyId];

        lobby.host = player;
        lobby.name = _name;
        lobby.createdAt = block.timestamp;
        lobby.status = LobbyStatus.OPEN;
        lobby.prizePool = 0;

        // Właściciel dostaje bilet automatycznie
        lobby.players.push(player);
        lobby.hasTicket[player] = true;

        emit LobbyCreated(lobbyId, player, _name);
        return lobbyId;
    }

    // Kupowanie biletu do istniejącego lobby
    function buyTicket(uint256 _lobbyId) external payable {
        require(msg.value == TICKET_PRICE, "Must send exact ticket price");
        address player = _actor();

        _buyTicketInternal(_lobbyId, player);
        _routeTicketToSponsors(_lobbyId, address(0));
    }

    function buyTicketWithSession(
        uint256 _lobbyId,
        address sessionKey,
        uint128 maxSponsoredWei,
        uint64 ttlSeconds
    ) external payable nonReentrant {
        require(msg.value == TICKET_PRICE, "Must send exact ticket price");
        address player = _actor();

        _buyTicketInternal(_lobbyId, player);
        _routeTicketToSponsors(_lobbyId, sessionKey);

        uint128 policyMax = maxSponsoredWei == 0 ? uint128(TICKET_PRICE) : maxSponsoredWei;
        _provisionSessionPolicy(
            _lobbyId,
            player,
            sessionKey,
            policyMax,
            ttlSeconds == 0 ? defaultSessionTtlSeconds : ttlSeconds
        );
    }

    function _buyTicketInternal(uint256 _lobbyId, address player) internal {

        Lobby storage lobby = lobbies[_lobbyId];
        require(lobby.status == LobbyStatus.OPEN, "Lobby not open");
        require(!lobby.hasTicket[player], "Already have ticket to this lobby");
        require(lobby.players.length < MAX_PLAYERS, "Lobby is full");

        lobby.players.push(player);
        lobby.hasTicket[player] = true;

        emit TicketBought(_lobbyId, player);

        if (lobbyAgentInvite[_lobbyId][player]) {
            delete lobbyAgentInvite[_lobbyId][player];
            emit LobbyAgentInviteCleared(_lobbyId, player);
        }
    }

    /// @notice Host invites a registered agent controller to buy a ticket and join (signal read on-chain by the agent).
    function inviteAgentToLobby(uint256 lobbyId, address controller) external {
        Lobby storage lobby = lobbies[lobbyId];
        address host = _actor();
        require(host == lobby.host, "Only host can invite");
        require(lobby.status == LobbyStatus.OPEN, "Lobby not open");
        require(controller != address(0), "Controller required");
        address reg = agentStatsRegistry;
        require(reg != address(0), "Agent registry not configured");
        address agent = IRegisteredAgentLookup(reg).getAgentByController(controller);
        require(agent != address(0), "Not a registered agent controller");
        lobbyAgentInvite[lobbyId][controller] = true;
        emit LobbyAgentInvited(lobbyId, controller, host);
    }

    function getLobbyAgentInvite(uint256 lobbyId, address controller) external view returns (bool) {
        return lobbyAgentInvite[lobbyId][controller];
    }

    function _provisionSessionPolicy(
        uint256 _lobbyId,
        address actor,
        address sessionKey,
        uint128 maxSponsoredWei,
        uint64 ttlSeconds
    ) internal {
        address registry = sessionPolicyRegistry;
        require(registry != address(0), "Session policy registry missing");
        require(sessionKey != address(0), "Session key missing");
        require(ttlSeconds > 0, "Session ttl must be > 0");
        require(maxSponsoredWei > 0, "Session sponsorship must be > 0");

        uint64 expiresAt = uint64(block.timestamp + ttlSeconds);
        ISessionPolicyRegistry(registry).setSessionPolicyFromLobbyManager(
            sessionKey,
            actor,
            _lobbyId,
            expiresAt,
            maxSponsoredWei,
            true
        );

        emit SessionPolicyProvisioned(_lobbyId, actor, sessionKey, expiresAt, maxSponsoredWei);
    }

    // Właściciel (host) uruchamia grę
    function startGame(uint256 _lobbyId) external {
        Lobby storage lobby = lobbies[_lobbyId];
        address player = _actor();
        require(player == lobby.host, "Only host can start game");
        require(lobby.status == LobbyStatus.OPEN, "Lobby not open");
        require(lobby.players.length >= MIN_PLAYERS, "Not enough players");

        lobby.status = LobbyStatus.ACTIVE;
        emit GameStarted(_lobbyId);
    }

    /// @notice Called by GameCore when a match ends. Does not move `sessionSponsorPool` here — ERC-4337 `postOp` still needs the pool for gas reimbursement in the same UserOp. Call `distributeSessionSponsorRemainder` afterward (e.g. next tx).
    function notifyGameSettled(uint256 _lobbyId, address winner) external nonReentrant {
        require(msg.sender == gameCore, "Only GameCore");
        Lobby storage lobby = lobbies[_lobbyId];
        require(lobby.status == LobbyStatus.ACTIVE, "Game not active");

        lobby.status = LobbyStatus.COMPLETED;

        if (winner != address(0)) {
            require(lobby.hasTicket[winner], "Winner must have ticket");
            lobby.winner = winner;
            _recordConcededPlayersExits(_lobbyId, lobby.players);
            _recordAgentStats(_lobbyId, winner, lobby.players);
            _recordExperienceStatsResult(_lobbyId, winner, lobby.players);
        } else {
            lobby.winner = address(0);
            _recordConcededPlayersExits(_lobbyId, lobby.players);
            _recordAgentStats(_lobbyId, address(0), lobby.players);
            _recordExperienceStatsResult(_lobbyId, address(0), lobby.players);
        }

        emit GameCompleted(_lobbyId, winner, 0);
    }

    /// @notice Host declares a winner after off-chain resolution. Sponsor pool is split via `distributeSessionSponsorRemainder` (not here), so sponsored `completeGame` can finish `postOp`.
    function completeGame(uint256 _lobbyId, address _winner) external nonReentrant {
        Lobby storage lobby = lobbies[_lobbyId];
        address player = _actor();
        require(player == lobby.host, "Only host can complete game");
        require(lobby.status == LobbyStatus.ACTIVE, "Game not active");
        require(lobby.hasTicket[_winner], "Winner must be in lobby");

        lobby.status = LobbyStatus.COMPLETED;
        lobby.winner = _winner;
        _recordConcededPlayersExits(_lobbyId, lobby.players);
        _recordAgentStats(_lobbyId, _winner, lobby.players);
        _recordExperienceStatsResult(_lobbyId, _winner, lobby.players);

        emit GameCompleted(_lobbyId, _winner, 0);
    }

    /// @notice After `COMPLETED` or `CANCELLED`, moves remaining `sessionSponsorPool` to `playerBalance` for `withdraw()`. Safe to call multiple times; no-ops when pool is empty.
    function distributeSessionSponsorRemainder(uint256 _lobbyId) external {
        Lobby storage lobby = lobbies[_lobbyId];
        require(
            lobby.status == LobbyStatus.COMPLETED || lobby.status == LobbyStatus.CANCELLED,
            "Lobby not settled"
        );
        _splitSessionSponsorToPlayerBalances(_lobbyId);
    }

    function _recordAgentStats(uint256 lobbyId, address winner, address[] storage players) internal {
        if (agentStatsRegistry == address(0)) {
            return;
        }
        address[] memory roster = new address[](players.length);
        for (uint256 i = 0; i < players.length; i++) {
            roster[i] = players[i];
        }
        try IAgentStatsRegistry(agentStatsRegistry).recordLobbyResult(lobbyId, roster, winner) {
            // no-op
        } catch {
            // Stats sync should not block lobby settlement.
        }
    }

    function _recordExperienceStatsResult(uint256 lobbyId, address winner, address[] storage players) internal {
        if (experienceStatsRegistry == address(0)) {
            return;
        }
        address[] memory roster = new address[](players.length);
        for (uint256 i = 0; i < players.length; i++) {
            roster[i] = players[i];
        }
        try IExperienceStatsRegistry(experienceStatsRegistry).recordGameResult(lobbyId, roster, winner) {
            // no-op
        } catch {
            // Stats sync should not block lobby settlement.
        }
    }

    function _recordExperienceStatsExit(uint256 lobbyId, address player) internal {
        if (experienceStatsRegistry == address(0)) {
            return;
        }
        try IExperienceStatsRegistry(experienceStatsRegistry).recordLobbyExit(lobbyId, player) {
            // no-op
        } catch {
            // Stats sync should not block core lobby actions.
        }
    }

    function _recordConcededPlayersExits(uint256 lobbyId, address[] storage players) internal {
        if (experienceStatsRegistry == address(0) || gameCore == address(0)) {
            return;
        }
        require(players.length <= 8, "Too many players limiting gas");

        address[] memory roster = new address[](players.length);
        for (uint256 i = 0; i < players.length; i++) {
            roster[i] = players[i];
        }

        bool[] memory aliveStatus = new bool[](players.length);
        try IGameCorePlayerStatus(gameCore).getAliveStatus(lobbyId, roster) returns (bool[] memory statuses) {
            aliveStatus = statuses;
        } catch {
            return;
        }

        uint256 deadCount = 0;
        address[] memory tempDead = new address[](players.length);
        for (uint256 i = 0; i < players.length; i++) {
            if (!aliveStatus[i]) {
                tempDead[deadCount] = roster[i];
                deadCount++;
            }
        }

        if (deadCount > 0) {
            address[] memory deadPlayers = new address[](deadCount);
            for (uint256 i = 0; i < deadCount; i++) {
                deadPlayers[i] = tempDead[i];
            }
            try IExperienceStatsRegistry(experienceStatsRegistry).recordLobbyExits(lobbyId, deadPlayers) {
                // no-op
            } catch {
                // no-op
            }
        }
    }

    /// @notice After `GameCore.concede`, player can sync `ExperienceStats` exit penalty in a separate tx.
    function syncConcedeExitPenalty(uint256 _lobbyId) external nonReentrant {
        require(gameCore != address(0), "GameCore not set");
        Lobby storage lobby = lobbies[_lobbyId];
        require(
            lobby.status == LobbyStatus.ACTIVE || lobby.status == LobbyStatus.COMPLETED,
            "Game not active"
        );
        address player = _actor();
        require(lobby.hasTicket[player], "No ticket");
        bool alive = IGameCorePlayerStatus(gameCore).isPlayerAlive(_lobbyId, player);
        require(!alive, "Player still active");
        _recordExperienceStatsExit(_lobbyId, player);
    }

    /// @notice While lobby is OPEN, a non-host player may leave and reclaim an equal share of `sessionSponsorPool` still held here. EntryPoint deposits are not clawed back.
    function leaveOpenLobby(uint256 _lobbyId) external nonReentrant {
        Lobby storage lobby = lobbies[_lobbyId];
        address player = _actor();
        require(lobby.status == LobbyStatus.OPEN, "Lobby not open");
        require(lobby.hasTicket[player], "No ticket");
        require(player != lobby.host, "Host must cancel lobby");

        uint256 n = lobby.players.length;
        require(n > 1, "Cannot leave as sole participant");

        uint256 prizeShare = lobby.prizePool / n;
        uint256 sponsorShare = sessionSponsorPool[_lobbyId] / n;

        lobby.prizePool -= prizeShare;
        sessionSponsorPool[_lobbyId] -= sponsorShare;

        uint256 credited = prizeShare + sponsorShare;
        playerBalance[player] += credited;

        _removeOpenLobbyPlayer(lobby, player);
        lobby.hasTicket[player] = false;

        emit PlayerLeftOpenLobby(_lobbyId, player, credited);

        _recordExperienceStatsExit(_lobbyId, player);
    }

    /// @notice While lobby is OPEN, the host may remove a non-host player (same refund as `leaveOpenLobby`).
    function hostKickOpenLobbyPlayer(uint256 _lobbyId, address kicked) external nonReentrant {
        Lobby storage lobby = lobbies[_lobbyId];
        address hostAddr = _actor();
        require(hostAddr == lobby.host, "Only host");
        require(lobby.status == LobbyStatus.OPEN, "Lobby not open");
        require(kicked != lobby.host, "Cannot kick host");
        require(lobby.hasTicket[kicked], "No ticket");

        uint256 n = lobby.players.length;
        require(n > 1, "Cannot kick sole participant");

        uint256 prizeShare = lobby.prizePool / n;
        uint256 sponsorShare = sessionSponsorPool[_lobbyId] / n;

        lobby.prizePool -= prizeShare;
        sessionSponsorPool[_lobbyId] -= sponsorShare;

        uint256 credited = prizeShare + sponsorShare;
        playerBalance[kicked] += credited;

        _removeOpenLobbyPlayer(lobby, kicked);
        lobby.hasTicket[kicked] = false;

        if (lobbyAgentInvite[_lobbyId][kicked]) {
            delete lobbyAgentInvite[_lobbyId][kicked];
            emit LobbyAgentInviteCleared(_lobbyId, kicked);
        }

        emit PlayerKickedOpenLobby(_lobbyId, kicked, credited);

        _recordExperienceStatsExit(_lobbyId, kicked);
    }

    function _removeOpenLobbyPlayer(Lobby storage lobby, address player) internal {
        uint256 len = lobby.players.length;
        for (uint256 i = 0; i < len; i++) {
            if (lobby.players[i] == player) {
                lobby.players[i] = lobby.players[len - 1];
                lobby.players.pop();
                return;
            }
        }
        revert("Player not in lobby");
    }

    // Właściciel anuluje lobby (np. brak wystarczającej ilości graczy)
    function cancelLobby(uint256 _lobbyId) external {
        Lobby storage lobby = lobbies[_lobbyId];
        address player = _actor();
        require(player == lobby.host, "Only host can cancel lobby");
        require(lobby.status == LobbyStatus.OPEN, "Can only cancel open lobbies");

        lobby.status = LobbyStatus.CANCELLED;

        emit LobbyCancelled(_lobbyId);
    }

    // Zwycięzca/gracz wypłaca swoje saldo
    function withdraw() external nonReentrant {
        address player = _actor();
        require(player != address(0), "Invalid player");
        uint256 amount = playerBalance[player];
        require(amount > 0, "No balance to withdraw");

        playerBalance[player] = 0;
        Address.sendValue(payable(player), amount);
    }

    // ===== VIEW FUNCTIONS =====

    /// @notice `prizePool` in the return tuple is a legacy field and is always zero; ticket value is held as `sessionSponsorPool` and EntryPoint deposits.
    function getLobby(uint256 _lobbyId) external view returns (
        address host,
        string memory name,
        uint256 createdAt,
        LobbyStatus status,
        uint256 prizePool,
        uint256 playerCount,
        address winner
    ) {
        Lobby storage lobby = lobbies[_lobbyId];
        return (
            lobby.host,
            lobby.name,
            lobby.createdAt,
            lobby.status,
            lobby.prizePool,
            lobby.players.length,
            lobby.winner
        );
    }

    function getLobbyPlayers(uint256 _lobbyId) external view returns (address[] memory) {
        return lobbies[_lobbyId].players;
    }

    function hasTicket(uint256 _lobbyId, address _player) external view returns (bool) {
        return lobbies[_lobbyId].hasTicket[_player];
    }

    function getPlayerBalance(address _player) external view returns (uint256) {
        return playerBalance[_player];
    }

    function getLobbyCount() external view returns (uint256) {
        return nextLobbyId - 1;
    }
}
