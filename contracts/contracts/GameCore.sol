// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/Strings.sol";

import "./ActorAware.sol";
import "./GameConfig.sol";

contract GameCore is ActorAware {
    using Strings for uint256;

    enum Status {
        Waiting,
        ZeroRound,
        Running,
        Ended
    }

    enum Biome {
        Plains,
        Forest,
        Mountains,
        Desert
    }

    struct Resources {
        uint256 food;
        uint256 wood;
        uint256 stone;
        uint256 ore;
        uint256 energy;
    }

    struct Player {
        bool exists;
        bool hasTicket;
        bool alive;
        uint256 bankruptRounds;
        uint256 ownedHexCount;
        Resources resources;
    }

    struct Structure {
        address owner;
        uint8 level;
        bool exists;
        uint256 builtAtRound;
        uint256 collectedAtRound;
    }

    struct HexTile {
        int256 q;
        int256 r;
        Biome biome;
        address owner;
        bool discovered;
        Structure structure;
    }

    struct TradeOffer {
        address maker;
        address taker;
        bool exists;
        bool accepted;
        uint256 createdAtRound;
        uint256 expiresAtRound;
        Resources offer;
        Resources request;
    }

    struct Proposal {
        string title;
        string effectKey;
        uint256 startRound;
        uint256 closeRound;
        uint256 yesVotes;
        uint256 noVotes;
        bool resolved;
        bool passed;
    }

    struct Lobby {
        address host;
        Status status;
        uint256 mapSeed;
        uint8 mapRadius;
        uint256 roundIndex;
        uint256 roundStartedAt;
        uint256 roundDurationSeconds;
        uint256 roundEndsAt;
        uint256 zeroRoundEndsAt;
        address[] players;
        mapping(address => Player) playerState;
        mapping(address => bool) zeroRoundPicked;
        mapping(bytes32 => HexTile) hexes;
        mapping(bytes32 => bool) hexExists;
        TradeOffer[] trades;
        Proposal[] proposals;
    }

    mapping(uint256 => Lobby) private lobbies;
    uint256 public lobbyCount;

    event LobbyBootstrapped(uint256 indexed lobbyId, address indexed host, uint256 mapSeed, uint8 mapRadius);
    event LobbyStarted(uint256 indexed lobbyId, uint256 roundIndex, uint256 roundEndsAt);
    event RoundAdvanced(uint256 indexed lobbyId, uint256 roundIndex, uint256 roundEndsAt);
    event HexPicked(uint256 indexed lobbyId, address indexed player, string hexId);
    event HexDiscovered(uint256 indexed lobbyId, address indexed player, string hexId);
    event StructureBuilt(uint256 indexed lobbyId, address indexed player, string hexId, uint8 level);
    event StructureUpgraded(uint256 indexed lobbyId, address indexed player, string hexId, uint8 level);
    event StructureDestroyed(uint256 indexed lobbyId, address indexed player, string hexId);
    event ResourcesCollected(uint256 indexed lobbyId, address indexed player, string hexId, string resourceKey, uint256 amount);
    event TradeCreated(uint256 indexed lobbyId, uint256 indexed tradeId, address indexed maker, address taker);
    event TradeAccepted(uint256 indexed lobbyId, uint256 indexed tradeId, address indexed taker);
    event ProposalCreated(uint256 indexed lobbyId, uint256 indexed proposalId, string title, string effectKey);
    event ProposalVoted(uint256 indexed lobbyId, uint256 indexed proposalId, address indexed voter, bool support);
    event ProposalResolved(uint256 indexed lobbyId, uint256 indexed proposalId, bool passed);

    constructor() {}

    function _abs(int256 value) internal pure returns (uint256) {
        return uint256(value >= 0 ? value : -value);
    }

    function _isWithinRadius(int256 q, int256 r, uint8 radius) internal pure returns (bool) {
        uint256 limit = uint256(radius);
        return _abs(q) <= limit && _abs(r) <= limit && _abs(q + r) <= limit;
    }

    function _biomeAt(uint256 seed, int256 q, int256 r) internal pure returns (Biome) {
        uint256 value = uint256(keccak256(abi.encodePacked(seed, q, r)));
        return Biome(value % 4);
    }

    function _resourceKeyForBiome(Biome biome) internal pure returns (string memory) {
        if (biome == Biome.Plains) return "food";
        if (biome == Biome.Forest) return "wood";
        if (biome == Biome.Mountains) return "stone";
        return "ore";
    }

    function _intToString(int256 value) internal pure returns (string memory) {
        if (value < 0) {
            return string.concat("-", uint256(-value).toString());
        }

        return uint256(value).toString();
    }

    function _hexId(int256 q, int256 r) internal pure returns (string memory) {
        return string.concat(_intToString(q), ",", _intToString(r));
    }

    function _exploreCost(uint256 ownedCount) internal pure returns (Resources memory cost) {
        (cost.food, cost.wood, cost.stone, cost.ore, cost.energy) = GameConfig.discoverCost(ownedCount);
    }

    function _hasAdjacentOwnedHex(Lobby storage lobby, int256 q, int256 r, address owner) internal view returns (bool) {
        int256[2][6] memory directions = [
            [int256(1), int256(0)],
            [int256(1), int256(-1)],
            [int256(0), int256(-1)],
            [int256(-1), int256(0)],
            [int256(-1), int256(1)],
            [int256(0), int256(1)]
        ];

        for (uint256 i = 0; i < directions.length; i++) {
            int256 neighborQ = q + directions[i][0];
            int256 neighborR = r + directions[i][1];
            HexTile storage neighbor = lobby.hexes[keccak256(bytes(_hexId(neighborQ, neighborR)))];
            if (neighbor.owner == owner) {
                return true;
            }
        }

        return false;
    }

    function _initializeMap(Lobby storage lobby) internal {
        int256 radius = int256(uint256(lobby.mapRadius));
        for (int256 q = -radius; q <= radius; q++) {
            int256 rMin = -radius > -q - radius ? -radius : -q - radius;
            int256 rMax = radius < -q + radius ? radius : -q + radius;
            for (int256 r = rMin; r <= rMax; r++) {
                bytes32 key = keccak256(bytes(_hexId(q, r)));
                if (!lobby.hexExists[key]) {
                    HexTile storage tile = lobby.hexes[key];
                    tile.q = q;
                    tile.r = r;
                    tile.biome = _biomeAt(lobby.mapSeed, q, r);
                    lobby.hexExists[key] = true;
                }
            }
        }
    }

    function _resolveMaturedProposals(uint256 lobbyId) internal {
        Lobby storage lobby = lobbies[lobbyId];
        for (uint256 i = 0; i < lobby.proposals.length; i++) {
            Proposal storage proposal = lobby.proposals[i];
            if (!proposal.resolved && lobby.roundIndex >= proposal.closeRound) {
                proposal.resolved = true;
                proposal.passed = proposal.yesVotes > proposal.noVotes;
                emit ProposalResolved(lobbyId, i, proposal.passed);
            }
        }
    }

    function _syncRoundFromTimestamp(uint256 lobbyId) internal {
        Lobby storage lobby = lobbies[lobbyId];

        if (lobby.status == Status.ZeroRound && block.timestamp >= lobby.zeroRoundEndsAt) {
            lobby.status = Status.Running;
            lobby.roundIndex = 1;
            lobby.roundStartedAt = lobby.zeroRoundEndsAt;
            lobby.roundEndsAt = lobby.roundStartedAt + lobby.roundDurationSeconds;
            _resolveMaturedProposals(lobbyId);
            emit RoundAdvanced(lobbyId, lobby.roundIndex, lobby.roundEndsAt);
        }

        if (lobby.status != Status.Running || lobby.roundDurationSeconds == 0) {
            return;
        }

        if (block.timestamp < lobby.roundEndsAt) {
            return;
        }

        uint256 elapsedFromRoundEnd = block.timestamp - lobby.roundEndsAt;
        uint256 skippedRounds = (elapsedFromRoundEnd / lobby.roundDurationSeconds) + 1;
        lobby.roundIndex += skippedRounds;
        lobby.roundEndsAt += skippedRounds * lobby.roundDurationSeconds;
        lobby.roundStartedAt = lobby.roundEndsAt - lobby.roundDurationSeconds;
        _resolveMaturedProposals(lobbyId);
        emit RoundAdvanced(lobbyId, lobby.roundIndex, lobby.roundEndsAt);
    }

    function _payBuildCost(Player storage player) internal {
        (uint256 foodCost, uint256 woodCost, uint256 stoneCost,,) = GameConfig.buildCost();
        require(player.resources.food >= foodCost, "Not enough food");
        require(player.resources.wood >= woodCost, "Not enough wood");
        require(player.resources.stone >= stoneCost, "Not enough stone");
        player.resources.food -= foodCost;
        player.resources.wood -= woodCost;
        player.resources.stone -= stoneCost;
    }

    function _payUpgradeCost(Player storage player) internal {
        (uint256 foodCost,, uint256 stoneCost, uint256 oreCost,) = GameConfig.upgradeCost();
        require(player.resources.food >= foodCost, "Not enough food");
        require(player.resources.stone >= stoneCost, "Not enough stone");
        require(player.resources.ore >= oreCost, "Not enough ore");
        player.resources.food -= foodCost;
        player.resources.stone -= stoneCost;
        player.resources.ore -= oreCost;
    }

    function getBuildCost() external pure returns (Resources memory) {
        (Resources memory cost) = Resources(0, 0, 0, 0, 0);
        (cost.food, cost.wood, cost.stone, cost.ore, cost.energy) = GameConfig.buildCost();
        return cost;
    }

    function getUpgradeCost() external pure returns (Resources memory) {
        (Resources memory cost) = Resources(0, 0, 0, 0, 0);
        (cost.food, cost.wood, cost.stone, cost.ore, cost.energy) = GameConfig.upgradeCost();
        return cost;
    }

    function previewDiscoverCost(uint256 lobbyId, address playerAddress) external view returns (Resources memory) {
        Lobby storage lobby = lobbies[lobbyId];
        (Resources memory cost) = Resources(0, 0, 0, 0, 0);
        (cost.food, cost.wood, cost.stone, cost.ore, cost.energy) = GameConfig.discoverCost(lobby.playerState[playerAddress].ownedHexCount);
        return cost;
    }

    function previewCollectionEnergyCost(uint8 structureLevel) external pure returns (uint256) {
        return GameConfig.collectionEnergyCost(structureLevel);
    }

    function _startingResources() internal pure returns (Resources memory startingResources) {
        (startingResources.food, startingResources.wood, startingResources.stone, startingResources.ore, startingResources.energy) = GameConfig.startingResources();
    }

    function _createPlayerState() internal pure returns (Player memory) {
        return Player({exists: true, hasTicket: true, alive: true, bankruptRounds: 0, ownedHexCount: 0, resources: _startingResources()});
    }

    function bootstrapLobby(uint256 lobbyId, address host, uint256 mapSeed, uint8 mapRadius) external {
        Lobby storage lobby = lobbies[lobbyId];
        address actor = _actor();
        require(lobby.host == address(0), "Lobby exists");
        require(actor == host, "Only host");
        lobby.host = host;
        lobby.status = Status.Waiting;
        lobby.mapSeed = mapSeed;
        lobby.mapRadius = mapRadius;
        _initializeMap(lobby);
        lobby.players.push(host);
        lobby.playerState[host] = _createPlayerState();
        lobbyCount += 1;
        emit LobbyBootstrapped(lobbyId, host, lobby.mapSeed, lobby.mapRadius);
    }

    function startGame(uint256 lobbyId, uint256 zeroRoundSeconds, uint256 roundSeconds) external {
        Lobby storage lobby = lobbies[lobbyId];
        address actor = _actor();
        if (lobby.host == address(0)) {
            lobby.host = actor;
            lobby.players.push(actor);
            lobby.playerState[actor] = _createPlayerState();
        }
        require(actor == lobby.host, "Only host");
        require(lobby.status == Status.Waiting, "Already started");
        lobby.status = Status.ZeroRound;
        lobby.roundStartedAt = block.timestamp;
        lobby.roundDurationSeconds = roundSeconds;
        lobby.zeroRoundEndsAt = block.timestamp + zeroRoundSeconds;
        lobby.roundEndsAt = block.timestamp + zeroRoundSeconds;
        lobby.roundIndex = 0;
        emit LobbyStarted(lobbyId, 0, lobby.roundEndsAt);
    }

    function joinLobby(uint256 lobbyId) external {
        Lobby storage lobby = lobbies[lobbyId];
        require(lobby.host != address(0), "Lobby not found");
        address player = _actor();
        if (!lobby.playerState[player].exists) {
            lobby.players.push(player);
            lobby.playerState[player] = _createPlayerState();
        }
    }

    function pickStartingHex(uint256 lobbyId, string calldata hexId, int256 q, int256 r) external {
        _syncRoundFromTimestamp(lobbyId);
        Lobby storage lobby = lobbies[lobbyId];
        address player = _actor();
        require(lobby.status == Status.ZeroRound, "Not zero round");
        require(!lobby.zeroRoundPicked[player], "Starting hex already chosen");
        require(_isWithinRadius(q, r, lobby.mapRadius), "Hex outside map");
        bytes32 key = keccak256(bytes(hexId));
        HexTile storage tile = lobby.hexes[key];
        Biome expectedBiome = _biomeAt(lobby.mapSeed, q, r);
        if (!lobby.hexExists[key]) {
            tile.q = q;
            tile.r = r;
            tile.biome = expectedBiome;
            lobby.hexExists[key] = true;
        } else {
            require(tile.q == q && tile.r == r, "Hex mismatch");
            require(tile.biome == expectedBiome, "Biome mismatch");
        }
        require(tile.owner == address(0), "Hex already owned");
        tile.owner = player;
        tile.discovered = true;
        lobby.playerState[player].ownedHexCount += 1;
        lobby.zeroRoundPicked[player] = true;
        emit HexPicked(lobbyId, player, hexId);

        if (_allPlayersPicked(lobby)) {
            _advanceRound(lobbyId, lobby.roundDurationSeconds);
        }
    }

    function _allPlayersPicked(Lobby storage lobby) internal view returns (bool) {
        for (uint256 i = 0; i < lobby.players.length; i++) {
            if (!lobby.zeroRoundPicked[lobby.players[i]]) {
                return false;
            }
        }
        return lobby.players.length > 0;
    }

    function discoverHex(uint256 lobbyId, string calldata hexId) external {
        _syncRoundFromTimestamp(lobbyId);
        Lobby storage lobby = lobbies[lobbyId];
        address playerAddress = _actor();
        require(lobby.status == Status.Running, "Game not running");

        HexTile storage tile = lobby.hexes[keccak256(bytes(hexId))];
        Player storage player = lobby.playerState[playerAddress];
        require(player.exists && player.alive, "Player not active");
        require(tile.owner == address(0), "Hex occupied");
        require(player.ownedHexCount > 0, "No owned hexes");
        require(_hasAdjacentOwnedHex(lobby, tile.q, tile.r, playerAddress), "Must be adjacent");

        Resources memory cost;
        (cost.food, cost.wood, cost.stone, cost.ore, cost.energy) = GameConfig.discoverCost(player.ownedHexCount);
        require(player.resources.food >= cost.food, "Not enough resources for discovery");
        require(player.resources.wood >= cost.wood, "Not enough resources for discovery");
        require(player.resources.stone >= cost.stone, "Not enough resources for discovery");
        require(player.resources.ore >= cost.ore, "Not enough resources for discovery");

        player.resources.food -= cost.food;
        player.resources.wood -= cost.wood;
        player.resources.stone -= cost.stone;
        player.resources.ore -= cost.ore;

        tile.owner = playerAddress;
        tile.discovered = true;
        player.ownedHexCount += 1;

        emit HexDiscovered(lobbyId, playerAddress, hexId);
    }

    function buildStructure(uint256 lobbyId, string calldata hexId) external {
        _syncRoundFromTimestamp(lobbyId);
        Lobby storage lobby = lobbies[lobbyId];
        address playerAddress = _actor();
        HexTile storage tile = lobby.hexes[keccak256(bytes(hexId))];
        Player storage player = lobby.playerState[playerAddress];
        require(tile.owner == playerAddress, "Not owner");
        require(!tile.structure.exists, "Structure exists");
        _payBuildCost(player);
        tile.structure = Structure({owner: playerAddress, level: 1, exists: true, builtAtRound: lobby.roundIndex, collectedAtRound: 0});
        emit StructureBuilt(lobbyId, playerAddress, hexId, 1);
    }

    function upgradeStructure(uint256 lobbyId, string calldata hexId) external {
        _syncRoundFromTimestamp(lobbyId);
        Lobby storage lobby = lobbies[lobbyId];
        address playerAddress = _actor();
        HexTile storage tile = lobby.hexes[keccak256(bytes(hexId))];
        Player storage player = lobby.playerState[playerAddress];
        require(tile.owner == playerAddress, "Not owner");
        require(tile.structure.exists, "No structure");
        require(tile.structure.level == 1, "Already max");
        _payUpgradeCost(player);
        tile.structure.level = 2;
        emit StructureUpgraded(lobbyId, playerAddress, hexId, 2);
    }

    function destroyStructure(uint256 lobbyId, string calldata hexId) external {
        _syncRoundFromTimestamp(lobbyId);
        Lobby storage lobby = lobbies[lobbyId];
        address playerAddress = _actor();
        HexTile storage tile = lobby.hexes[keccak256(bytes(hexId))];
        require(tile.owner == playerAddress, "Not owner");
        require(tile.structure.exists, "No structure");
        tile.structure = Structure({owner: address(0), level: 0, exists: false, builtAtRound: 0, collectedAtRound: 0});
        emit StructureDestroyed(lobbyId, playerAddress, hexId);
    }

    function collect(uint256 lobbyId, string calldata hexId, uint256 amount) external {
        _syncRoundFromTimestamp(lobbyId);
        Lobby storage lobby = lobbies[lobbyId];
        address playerAddress = _actor();
        HexTile storage tile = lobby.hexes[keccak256(bytes(hexId))];
        require(tile.owner == playerAddress, "Not owner");
        require(tile.structure.exists, "No structure");
        require(tile.structure.builtAtRound < lobby.roundIndex, "Production starts next round");
        require(tile.structure.collectedAtRound != lobby.roundIndex, "Already collected this round");
        tile.structure.collectedAtRound = lobby.roundIndex;
        Player storage player = lobby.playerState[playerAddress];
        uint256 energyCost = GameConfig.collectionEnergyCost(tile.structure.level);
        require(player.resources.energy >= energyCost, "Not enough energy");
        player.resources.energy -= energyCost;
        string memory resourceKey = _resourceKeyForBiome(tile.biome);
        if (keccak256(bytes(resourceKey)) == keccak256(bytes("food"))) player.resources.food += amount;
        else if (keccak256(bytes(resourceKey)) == keccak256(bytes("wood"))) player.resources.wood += amount;
        else if (keccak256(bytes(resourceKey)) == keccak256(bytes("stone"))) player.resources.stone += amount;
        else if (keccak256(bytes(resourceKey)) == keccak256(bytes("ore"))) player.resources.ore += amount;
        emit ResourcesCollected(lobbyId, playerAddress, hexId, resourceKey, amount);
    }

    function createTrade(uint256 lobbyId, address taker, Resources calldata offer, Resources calldata request, uint256 expiryRounds) external returns (uint256) {
        _syncRoundFromTimestamp(lobbyId);
        Lobby storage lobby = lobbies[lobbyId];
        address playerAddress = _actor();
        lobby.trades.push(TradeOffer({
            maker: playerAddress,
            taker: taker,
            exists: true,
            accepted: false,
            createdAtRound: lobby.roundIndex,
            expiresAtRound: lobby.roundIndex + expiryRounds,
            offer: offer,
            request: request
        }));
        uint256 tradeId = lobby.trades.length - 1;
        emit TradeCreated(lobbyId, tradeId, playerAddress, taker);
        return tradeId;
    }

    function acceptTrade(uint256 lobbyId, uint256 tradeId) external {
        _syncRoundFromTimestamp(lobbyId);
        Lobby storage lobby = lobbies[lobbyId];
        address playerAddress = _actor();
        TradeOffer storage trade = lobby.trades[tradeId];
        require(trade.exists, "Trade missing");
        require(!trade.accepted, "Trade accepted");
        require(trade.taker == address(0) || trade.taker == playerAddress, "Not target");
        trade.accepted = true;
        emit TradeAccepted(lobbyId, tradeId, playerAddress);
    }

    function createProposal(uint256 lobbyId, string calldata title, string calldata effectKey, uint256 closeRound) external returns (uint256) {
        _syncRoundFromTimestamp(lobbyId);
        Lobby storage lobby = lobbies[lobbyId];
        lobby.proposals.push(Proposal({
            title: title,
            effectKey: effectKey,
            startRound: lobby.roundIndex,
            closeRound: closeRound,
            yesVotes: 0,
            noVotes: 0,
            resolved: false,
            passed: false
        }));
        uint256 proposalId = lobby.proposals.length - 1;
        emit ProposalCreated(lobbyId, proposalId, title, effectKey);
        return proposalId;
    }

    function vote(uint256 lobbyId, uint256 proposalId, bool support) external {
        _syncRoundFromTimestamp(lobbyId);
        Lobby storage lobby = lobbies[lobbyId];
        address playerAddress = _actor();
        Proposal storage proposal = lobby.proposals[proposalId];
        require(lobby.status == Status.Running, "Round not running");
        require(!proposal.resolved, "Resolved");
        if (support) proposal.yesVotes += 1;
        else proposal.noVotes += 1;
        emit ProposalVoted(lobbyId, proposalId, playerAddress, support);

        if (
            keccak256(bytes(proposal.effectKey)) == keccak256(bytes("__END_ROUND__")) &&
            proposal.yesVotes == lobby.players.length &&
            proposal.noVotes == 0
        ) {
            proposal.resolved = true;
            proposal.passed = true;
            emit ProposalResolved(lobbyId, proposalId, true);
            _advanceRound(lobbyId, GameConfig.endRoundAdvanceSeconds());
        }
    }

    function resolveProposal(uint256 lobbyId, uint256 proposalId) external returns (bool passed) {
        _syncRoundFromTimestamp(lobbyId);
        Lobby storage lobby = lobbies[lobbyId];
        Proposal storage proposal = lobby.proposals[proposalId];
        require(!proposal.resolved, "Resolved");
        require(lobby.roundIndex >= proposal.closeRound, "Voting active");
        proposal.resolved = true;
        proposal.passed = proposal.yesVotes > proposal.noVotes;
        emit ProposalResolved(lobbyId, proposalId, proposal.passed);
        return proposal.passed;
    }

    function _advanceRound(uint256 lobbyId, uint256 roundSeconds) internal {
        Lobby storage lobby = lobbies[lobbyId];
        require(lobby.status == Status.ZeroRound || lobby.status == Status.Running, "Not active");
        if (roundSeconds > 0) {
            lobby.roundDurationSeconds = roundSeconds;
        }
        if (lobby.status == Status.ZeroRound) {
            lobby.status = Status.Running;
            lobby.roundIndex = 1;
        } else {
            lobby.roundIndex += 1;
        }
        _resolveMaturedProposals(lobbyId);

        lobby.roundStartedAt = block.timestamp;
        lobby.roundEndsAt = block.timestamp + lobby.roundDurationSeconds;
        emit RoundAdvanced(lobbyId, lobby.roundIndex, lobby.roundEndsAt);
    }

    function advanceRound(uint256 lobbyId, uint256 roundSeconds) external {
        _advanceRound(lobbyId, roundSeconds);
    }

    function getLobbyRound(uint256 lobbyId)
        external
        view
        returns (
            uint256 roundIndex,
            uint256 roundEndsAt,
            uint256 zeroRoundEndsAt,
            Status status,
            uint256 roundStartedAt,
            uint256 roundDurationSeconds
        )
    {
        Lobby storage lobby = lobbies[lobbyId];
        return (
            lobby.roundIndex,
            lobby.roundEndsAt,
            lobby.zeroRoundEndsAt,
            lobby.status,
            lobby.roundStartedAt,
            lobby.roundDurationSeconds
        );
    }

    function getMapConfig(uint256 lobbyId) external view returns (uint256 mapSeed, uint8 mapRadius) {
        Lobby storage lobby = lobbies[lobbyId];
        return (lobby.mapSeed, lobby.mapRadius);
    }

    function getHexTile(uint256 lobbyId, string calldata hexId) external view returns (
        int256 q,
        int256 r,
        Biome biome,
        address owner,
        bool discovered,
        bool structureExists,
        uint8 structureLevel,
        uint256 builtAtRound,
        uint256 collectedAtRound
    ) {
        HexTile storage tile = lobbies[lobbyId].hexes[keccak256(bytes(hexId))];
        return (
            tile.q,
            tile.r,
            tile.biome,
            tile.owner,
            tile.discovered,
            tile.structure.exists,
            tile.structure.level,
            tile.structure.builtAtRound,
            tile.structure.collectedAtRound
        );
    }

    function getLobbyPlayers(uint256 lobbyId) external view returns (address[] memory) {
        return lobbies[lobbyId].players;
    }

    function getPlayerResources(uint256 lobbyId, address player) external view returns (uint256 food, uint256 wood, uint256 stone, uint256 ore, uint256 energy) {
        Resources storage resources = lobbies[lobbyId].playerState[player].resources;
        return (resources.food, resources.wood, resources.stone, resources.ore, resources.energy);
    }

    function getPlayerOwnedHexCount(uint256 lobbyId, address player) external view returns (uint256) {
        return lobbies[lobbyId].playerState[player].ownedHexCount;
    }

    function getTrade(
        uint256 lobbyId,
        uint256 tradeId
    ) external view returns (
        address maker,
        address taker,
        bool accepted,
        uint256 createdAtRound,
        uint256 expiresAtRound,
        uint256 offerFood,
        uint256 offerWood,
        uint256 offerStone,
        uint256 offerOre,
        uint256 offerEnergy,
        uint256 requestFood,
        uint256 requestWood,
        uint256 requestStone,
        uint256 requestOre,
        uint256 requestEnergy
    ) {
        TradeOffer storage trade = lobbies[lobbyId].trades[tradeId];
        return (
            trade.maker,
            trade.taker,
            trade.accepted,
            trade.createdAtRound,
            trade.expiresAtRound,
            trade.offer.food,
            trade.offer.wood,
            trade.offer.stone,
            trade.offer.ore,
            trade.offer.energy,
            trade.request.food,
            trade.request.wood,
            trade.request.stone,
            trade.request.ore,
            trade.request.energy
        );
    }

    function getProposal(uint256 lobbyId, uint256 proposalId) external view returns (string memory title, string memory effectKey, uint256 yesVotes, uint256 noVotes, bool resolved, bool passed, uint256 closeRound) {
        Proposal storage proposal = lobbies[lobbyId].proposals[proposalId];
        return (proposal.title, proposal.effectKey, proposal.yesVotes, proposal.noVotes, proposal.resolved, proposal.passed, proposal.closeRound);
    }
}
