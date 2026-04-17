// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./ActorAware.sol";

interface IEntryPointDeposits {
    function depositTo(address account) external payable;
}

contract LobbyManager is ActorAware {
    uint256 public constant TICKET_PRICE = 5 ether;
    /// @notice Share of each ticket (basis points) carved out for AA: half to EntryPoint deposit on session account, half to sessionSponsorPool for paymaster reimbursements.
    uint256 public constant SESSION_SPONSOR_SHARE_BPS = 2000;
    uint256 public constant MIN_PLAYERS = 1;
    uint256 public constant MAX_PLAYERS = 4;

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
    uint128 public defaultSessionMaxSponsoredWei = uint128((uint256(TICKET_PRICE) * SESSION_SPONSOR_SHARE_BPS) / 10000);
    uint64 public defaultSessionTtlSeconds = 7 days;

    /// @dev Set once after GameCore deployment; only that contract may call `notifyGameWinner`.
    address public gameCore;

    event LobbyCreated(uint256 indexed lobbyId, address indexed host, string name);
    event TicketBought(uint256 indexed lobbyId, address indexed player);
    event GameStarted(uint256 indexed lobbyId);
    event GameCompleted(uint256 indexed lobbyId, address indexed winner, uint256 prizeAmount);
    event LobbyCancelled(uint256 indexed lobbyId);
    event PlayerLeftOpenLobby(uint256 indexed lobbyId, address indexed player, uint256 creditedWei);
    event PrizeWithdrawn(uint256 indexed lobbyId, address indexed winner, uint256 amount);
    event SessionSponsorManagerUpdated(address indexed previousManager, address indexed newManager);
    event SessionPolicyRegistryUpdated(address indexed previousRegistry, address indexed newRegistry);
    event EntryPointUpdated(address indexed previousEntryPoint, address indexed newEntryPoint);
    event SessionSponsorPoolReserved(uint256 indexed lobbyId, uint256 amount);
    event SessionSponsorPoolConsumed(uint256 indexed lobbyId, uint256 amount, address indexed receiver);
    event SessionEntryPointFunded(uint256 indexed lobbyId, address indexed sessionKey, uint256 amount);
    event SessionPolicyProvisioned(
        uint256 indexed lobbyId,
        address indexed actor,
        address indexed sessionKey,
        uint64 expiresAt,
        uint128 maxSponsoredWei
    );

    function setGameCore(address _gameCore) external onlyOwner {
        require(gameCore == address(0) && _gameCore != address(0), "GameCore already set");
        gameCore = _gameCore;
    }

    function setSessionPolicyRegistry(address newRegistry) external onlyOwner {
        emit SessionPolicyRegistryUpdated(sessionPolicyRegistry, newRegistry);
        sessionPolicyRegistry = newRegistry;
    }

    function setEntryPoint(address newEntryPoint) external onlyOwner {
        emit EntryPointUpdated(entryPoint, newEntryPoint);
        entryPoint = newEntryPoint;
    }

    function setDefaultSessionPolicy(uint128 maxSponsoredWei, uint64 ttlSeconds) external onlyOwner {
        require(ttlSeconds > 0, "Session ttl must be > 0");
        defaultSessionMaxSponsoredWei = maxSponsoredWei;
        defaultSessionTtlSeconds = ttlSeconds;
    }

    function setSessionSponsorManager(address newManager) external onlyOwner {
        emit SessionSponsorManagerUpdated(sessionSponsorManager, newManager);
        sessionSponsorManager = newManager;
    }

    function reserveSessionSponsorPool(uint256 _lobbyId, uint256 amount) external {
        Lobby storage lobby = lobbies[_lobbyId];
        address player = _actor();
        require(player == lobby.host, "Only host can reserve sponsor pool");
        require(lobby.status == LobbyStatus.OPEN || lobby.status == LobbyStatus.ACTIVE, "Lobby not sponsorable");
        require(amount <= lobby.prizePool, "Insufficient lobby pool");

        lobby.prizePool -= amount;
        sessionSponsorPool[_lobbyId] += amount;

        emit SessionSponsorPoolReserved(_lobbyId, amount);
    }

    function consumeSessionSponsorPool(uint256 _lobbyId, uint256 amount, address payable receiver) external {
        require(msg.sender == sessionSponsorManager, "Only session sponsor manager");
        require(amount <= sessionSponsorPool[_lobbyId], "Insufficient session sponsor pool");

        sessionSponsorPool[_lobbyId] -= amount;
        (bool success, ) = receiver.call{value: amount}("");
        require(success, "Session sponsor transfer failed");

        emit SessionSponsorPoolConsumed(_lobbyId, amount, receiver);
    }

    /// @return totalWei 20% of ticket (SESSION_SPONSOR_SHARE_BPS / 10000 * TICKET_PRICE); perBranchWei half for EP, half for sponsor pool
    function _sessionSponsorAmounts() internal pure returns (uint256 totalWei, uint256 perBranchWei) {
        totalWei = (TICKET_PRICE * SESSION_SPONSOR_SHARE_BPS) / 10000;
        perBranchWei = totalWei / 2;
    }

    // Tworzenie lobby: właściciel od razu kupuje bilet
    function createLobby(string memory _name) external payable returns (uint256) {
        require(msg.value == TICKET_PRICE, "Must send exact ticket price");
        address player = _actor();

        return _createLobbyInternal(_name, player);
    }

    function createLobbyWithSession(
        string memory _name,
        address sessionKey,
        uint128 maxSponsoredWei,
        uint64 ttlSeconds
    ) external payable returns (uint256) {
        require(msg.value == TICKET_PRICE, "Must send exact ticket price");
        address player = _actor();

        uint256 lobbyId = _createLobbyInternal(_name, player);
        (uint256 sponsorTotal, uint256 perBranch) = _sessionSponsorAmounts();
        if (sponsorTotal > 0 && perBranch > 0) {
            _fundSessionEntryPoint(lobbyId, sessionKey, perBranch);
            _mirrorSessionSponsorPool(lobbyId, perBranch);
        }

        uint128 policyMax = maxSponsoredWei == 0 ? uint128(sponsorTotal) : maxSponsoredWei;
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
        lobby.prizePool = TICKET_PRICE;

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
    }

    function buyTicketWithSession(
        uint256 _lobbyId,
        address sessionKey,
        uint128 maxSponsoredWei,
        uint64 ttlSeconds
    ) external payable {
        require(msg.value == TICKET_PRICE, "Must send exact ticket price");
        address player = _actor();

        _buyTicketInternal(_lobbyId, player);
        (uint256 sponsorTotal, uint256 perBranch) = _sessionSponsorAmounts();
        if (sponsorTotal > 0 && perBranch > 0) {
            _fundSessionEntryPoint(_lobbyId, sessionKey, perBranch);
            _mirrorSessionSponsorPool(_lobbyId, perBranch);
        }

        uint128 policyMax = maxSponsoredWei == 0 ? uint128(sponsorTotal) : maxSponsoredWei;
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
        lobby.prizePool += TICKET_PRICE;

        emit TicketBought(_lobbyId, player);
    }

    function _reserveSessionSponsorPool(uint256 _lobbyId, uint256 amount) internal {
        Lobby storage lobby = lobbies[_lobbyId];
        require(lobby.status == LobbyStatus.OPEN || lobby.status == LobbyStatus.ACTIVE, "Lobby not sponsorable");
        require(amount <= lobby.prizePool, "Insufficient lobby pool");

        lobby.prizePool -= amount;
        sessionSponsorPool[_lobbyId] += amount;

        emit SessionSponsorPoolReserved(_lobbyId, amount);
    }

    function _fundSessionEntryPoint(uint256 _lobbyId, address sessionKey, uint256 amount) internal {
        Lobby storage lobby = lobbies[_lobbyId];
        require(lobby.status == LobbyStatus.OPEN || lobby.status == LobbyStatus.ACTIVE, "Lobby not sponsorable");
        require(sessionKey != address(0), "Session key missing");
        require(entryPoint != address(0), "EntryPoint missing");
        require(amount <= lobby.prizePool, "Insufficient lobby pool");

        lobby.prizePool -= amount;
        IEntryPointDeposits(entryPoint).depositTo{value: amount}(sessionKey);

        emit SessionEntryPointFunded(_lobbyId, sessionKey, amount);
    }

    /// @dev Moves the same `amount` from prize pool into `sessionSponsorPool` so ERC-4337 paymasters can be reimbursed in postOp.
    function _mirrorSessionSponsorPool(uint256 _lobbyId, uint256 amount) internal {
        Lobby storage lobby = lobbies[_lobbyId];
        require(amount <= lobby.prizePool, "Insufficient lobby pool for sponsor pool");
        lobby.prizePool -= amount;
        sessionSponsorPool[_lobbyId] += amount;
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

    /// @notice Called by GameCore when a winner is determined (alloy win, last player standing). Credits `playerBalance` immediately.
    function notifyGameWinner(uint256 _lobbyId, address winner) external {
        require(msg.sender == gameCore, "Only GameCore");
        Lobby storage lobby = lobbies[_lobbyId];
        require(lobby.status == LobbyStatus.ACTIVE, "Game not active");
        require(winner != address(0), "No winner");
        require(lobby.hasTicket[winner], "Winner must have ticket");

        uint256 payout = lobby.prizePool;
        lobby.status = LobbyStatus.COMPLETED;
        lobby.winner = winner;
        playerBalance[winner] += payout;

        emit GameCompleted(_lobbyId, winner, payout);
    }

    // Właściciel kończy grę i deklaruje zwycięzcę
    // Cała pula idzie do zwycięzcy
    function completeGame(uint256 _lobbyId, address _winner) external {
        Lobby storage lobby = lobbies[_lobbyId];
        address player = _actor();
        require(player == lobby.host, "Only host can complete game");
        require(lobby.status == LobbyStatus.ACTIVE, "Game not active");
        require(lobby.hasTicket[_winner], "Winner must be in lobby");

        lobby.status = LobbyStatus.COMPLETED;
        lobby.winner = _winner;
        playerBalance[_winner] += lobby.prizePool;

        emit GameCompleted(_lobbyId, _winner, lobby.prizePool);
    }

    /// @notice While lobby is OPEN, a non-host player may leave and reclaim their equal share of `prizePool` and
    ///         `sessionSponsorPool` still held by this contract. Funds already sent to the ERC-4337 EntryPoint for the
    ///         player's session account are not clawed back here (recover via account-abstraction / that depositor).
    function leaveOpenLobby(uint256 _lobbyId) external {
        Lobby storage lobby = lobbies[_lobbyId];
        address player = _actor();
        require(lobby.status == LobbyStatus.OPEN, "Lobby not open");
        require(lobby.hasTicket[player], "No ticket");
        require(player != lobby.host, "Host must cancel lobby");

        uint256 n = lobby.players.length;
        require(n > 1, "Cannot leave as sole participant");

        uint256 prizeShare = lobby.prizePool / n;
        uint256 sponsorShare = sessionSponsorPool[_lobbyId] / n;
        require(prizeShare + sponsorShare > 0, "Nothing to refund");

        lobby.prizePool -= prizeShare;
        sessionSponsorPool[_lobbyId] -= sponsorShare;

        uint256 credited = prizeShare + sponsorShare;
        playerBalance[player] += credited;

        _removeOpenLobbyPlayer(lobby, player);
        lobby.hasTicket[player] = false;

        emit PlayerLeftOpenLobby(_lobbyId, player, credited);
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
    // Wszyscy gracze dostają zwrot puli / lub inny mechanizm
    function cancelLobby(uint256 _lobbyId) external {
        Lobby storage lobby = lobbies[_lobbyId];
        address player = _actor();
        require(player == lobby.host, "Only host can cancel lobby");
        require(lobby.status == LobbyStatus.OPEN, "Can only cancel open lobbies");

        lobby.status = LobbyStatus.CANCELLED;

        uint256 n = lobby.players.length;
        require(n > 0, "No players");
        uint256 prize = lobby.prizePool;
        uint256 sponsor = sessionSponsorPool[_lobbyId];
        lobby.prizePool = 0;
        sessionSponsorPool[_lobbyId] = 0;

        // Split both prize pool and AA sponsor reserve (same idea as leaveOpenLobby per-player shares).
        uint256 combined = prize + sponsor;
        uint256 per = combined / n;
        uint256 rem = combined % n;
        for (uint256 i = 0; i < n; i++) {
            uint256 extra = i < rem ? 1 : 0;
            playerBalance[lobby.players[i]] += per + extra;
        }

        emit LobbyCancelled(_lobbyId);
    }

    // Zwycięzca/gracz wypłaca swoje saldo
    function withdraw() external {
        address player = _actor();
        uint256 amount = playerBalance[player];
        require(amount > 0, "No balance to withdraw");

        playerBalance[player] = 0;
        (bool success, ) = payable(player).call{value: amount}("");
        require(success, "Withdraw failed");
    }

    // ===== VIEW FUNCTIONS =====

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
