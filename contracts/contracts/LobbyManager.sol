// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

contract LobbyManager is Ownable {
    uint256 public constant TICKET_PRICE = 0.05 ether;
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

    event LobbyCreated(uint256 indexed lobbyId, address indexed host, string name);
    event TicketBought(uint256 indexed lobbyId, address indexed player);
    event GameStarted(uint256 indexed lobbyId);
    event GameCompleted(uint256 indexed lobbyId, address indexed winner, uint256 prizeAmount);
    event LobbyCancelled(uint256 indexed lobbyId);
    event PrizeWithdrawn(uint256 indexed lobbyId, address indexed winner, uint256 amount);

    // Tworzenie lobby: właściciel od razu kupuje bilet za 0.05 ETH
    function createLobby(string memory _name) external payable returns (uint256) {
        require(msg.value == TICKET_PRICE, "Must send exactly 0.05 ETH");

        uint256 lobbyId = nextLobbyId++;
        Lobby storage lobby = lobbies[lobbyId];

        lobby.host = msg.sender;
        lobby.name = _name;
        lobby.createdAt = block.timestamp;
        lobby.status = LobbyStatus.OPEN;
        lobby.prizePool = TICKET_PRICE;

        // Właściciel dostaje bilet automatycznie
        lobby.players.push(msg.sender);
        lobby.hasTicket[msg.sender] = true;

        emit LobbyCreated(lobbyId, msg.sender, _name);
        return lobbyId;
    }

    // Kupowanie biletu do istniejącego lobby
    function buyTicket(uint256 _lobbyId) external payable {
        require(msg.value == TICKET_PRICE, "Must send exactly 0.05 ETH");

        Lobby storage lobby = lobbies[_lobbyId];
        require(lobby.status == LobbyStatus.OPEN, "Lobby not open");
        require(!lobby.hasTicket[msg.sender], "Already have ticket to this lobby");
        require(lobby.players.length < MAX_PLAYERS, "Lobby is full");

        lobby.players.push(msg.sender);
        lobby.hasTicket[msg.sender] = true;
        lobby.prizePool += TICKET_PRICE;

        emit TicketBought(_lobbyId, msg.sender);
    }

    // Właściciel (host) uruchamia grę
    function startGame(uint256 _lobbyId) external {
        Lobby storage lobby = lobbies[_lobbyId];
        require(msg.sender == lobby.host, "Only host can start game");
        require(lobby.status == LobbyStatus.OPEN, "Lobby not open");
        require(lobby.players.length >= MIN_PLAYERS, "Not enough players");

        lobby.status = LobbyStatus.ACTIVE;
        emit GameStarted(_lobbyId);
    }

    // Właściciel kończy grę i deklaruje zwycięzcę
    // Cała pula idzie do zwycięzcy
    function completeGame(uint256 _lobbyId, address _winner) external {
        Lobby storage lobby = lobbies[_lobbyId];
        require(msg.sender == lobby.host, "Only host can complete game");
        require(lobby.status == LobbyStatus.ACTIVE, "Game not active");
        require(lobby.hasTicket[_winner], "Winner must be in lobby");

        lobby.status = LobbyStatus.COMPLETED;
        lobby.winner = _winner;
        playerBalance[_winner] += lobby.prizePool;

        emit GameCompleted(_lobbyId, _winner, lobby.prizePool);
    }

    // Właściciel anuluje lobby (np. brak wystarczającej ilości graczy)
    // Wszyscy gracze dostają zwrot puli / lub inny mechanizm
    function cancelLobby(uint256 _lobbyId) external {
        Lobby storage lobby = lobbies[_lobbyId];
        require(msg.sender == lobby.host, "Only host can cancel lobby");
        require(lobby.status == LobbyStatus.OPEN, "Can only cancel open lobbies");

        lobby.status = LobbyStatus.CANCELLED;

        // Zwrot pieniędzy wszystkim graczom
        uint256 refundPerPlayer = lobby.prizePool / lobby.players.length;
        for (uint256 i = 0; i < lobby.players.length; i++) {
            playerBalance[lobby.players[i]] += refundPerPlayer;
        }

        emit LobbyCancelled(_lobbyId);
    }

    // Zwycięzca/gracz wypłaca swoje saldo
    function withdraw() external {
        uint256 amount = playerBalance[msg.sender];
        require(amount > 0, "No balance to withdraw");

        playerBalance[msg.sender] = 0;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
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
