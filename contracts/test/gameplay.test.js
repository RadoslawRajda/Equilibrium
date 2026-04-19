const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const {
  TICKET_PRICE,
  DEFAULT_MAP_SEED,
  DEFAULT_MAP_RADIUS,
  ZERO_ROUND_SECONDS,
  ROUND_SECONDS
} = require("./gameplay.config.js");
const { getLinkedGameCoreFactory } = require("./helpers/deployGameCoreFactory.js");
const { asResourceTuple } = require("./helpers/resourceTuple.js");
const BIOMES = ["Plains", "Forest", "Mountains", "Desert"];
const RESOURCE_BY_BIOME = {
  Plains: "food",
  Forest: "wood",
  Mountains: "stone",
  Desert: "ore"
};
const DIRECTIONS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1]
];

async function deploySystem() {
  const [deployer, host, player1, player2, player3, outsider] = await ethers.getSigners();

  const LobbyManager = await ethers.getContractFactory("LobbyManager");
  const GameCore = await getLinkedGameCoreFactory();

  const lobbyManager = await LobbyManager.deploy();
  await lobbyManager.waitForDeployment();

  const gameCore = await GameCore.deploy(await lobbyManager.getAddress());
  await gameCore.waitForDeployment();
  await lobbyManager.setGameCore(await gameCore.getAddress());

  return {
    deployer,
    host,
    player1,
    player2,
    player3,
    outsider,
    lobbyManager,
    gameCore
  };
}

function withinRadius(q, r, radius) {
  return Math.abs(q) <= radius && Math.abs(r) <= radius && Math.abs(q + r) <= radius;
}

function biomeAt(seed, q, r) {
  const hash = ethers.solidityPackedKeccak256(["uint256", "int256", "int256"], [seed, q, r]);
  return BIOMES[Number(BigInt(hash) % 4n)];
}

function allTiles(seed, radius) {
  const tiles = [];
  for (let q = -radius; q <= radius; q += 1) {
    for (let r = -radius; r <= radius; r += 1) {
      if (!withinRadius(q, r, radius)) continue;
      tiles.push({
        q,
        r,
        hexId: `${q},${r}`,
        biome: biomeAt(seed, q, r)
      });
    }
  }
  return tiles;
}

function firstTile(seed, radius) {
  const tiles = allTiles(seed, radius);
  if (!tiles.length) {
    throw new Error("No tiles found for map");
  }
  return tiles[0];
}

function firstPlainsTile(seed, radius) {
  const plains = allTiles(seed, radius).find((t) => t.biome === "Plains");
  return plains || firstTile(seed, radius);
}

function adjacentTile(seed, radius, sourceHex) {
  const tiles = allTiles(seed, radius);
  const target = tiles.find((tile) => DIRECTIONS.some(([dq, dr]) => tile.q === sourceHex.q + dq && tile.r === sourceHex.r + dr));
  if (!target) {
    throw new Error("No adjacent tile found");
  }
  return target;
}

async function mineSeconds(seconds) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

/** Aligns with `GameConfig.startingResources` / `basicResourceMax`. */
const START_FOOD = 2n;
const START_WOOD = 2n;
const START_STONE = 2n;
const START_ORE = 2n;
const START_ENERGY = 100n;

async function setPlayerResources(gameCore, lobbyId, playerAddress, target) {
  await gameCore.debugSetPlayerResources(lobbyId, playerAddress, target);
}

async function setupLobby({ playerCount = 0, seed = DEFAULT_MAP_SEED, radius = DEFAULT_MAP_RADIUS, zeroRoundSeconds = ZERO_ROUND_SECONDS, roundSeconds = ROUND_SECONDS } = {}) {
  const system = await deploySystem();
  const { host, player1, player2, player3, lobbyManager, gameCore } = system;
  const extraPlayers = [player1, player2, player3].slice(0, playerCount);

  await expect(lobbyManager.connect(host).createLobby("Season 0001", { value: TICKET_PRICE }))
    .to.emit(lobbyManager, "LobbyCreated")
    .withArgs(1n, host.address, "Season 0001");

  await expect(gameCore.connect(host).bootstrapLobby(1, host.address, seed, radius))
    .to.emit(gameCore, "LobbyBootstrapped")
    .withArgs(1n, host.address, seed, radius);

  for (const player of extraPlayers) {
    await expect(lobbyManager.connect(player).buyTicket(1, { value: TICKET_PRICE }))
      .to.emit(lobbyManager, "TicketBought")
      .withArgs(1n, player.address);
    await gameCore.connect(player).joinLobby(1);
  }

  await expect(lobbyManager.connect(host).startGame(1))
    .to.emit(lobbyManager, "GameStarted")
    .withArgs(1n);

  await gameCore.connect(host).startGame(1, zeroRoundSeconds, roundSeconds, await lobbyManager.getAddress());

  return {
    ...system,
    seed,
    radius,
    zeroRoundSeconds,
    roundSeconds,
    lobbyId: 1n
  };
}

describe("LobbyManager lifecycle", function () {
  it("creates a lobby, accepts tickets, starts with one player, completes the game, and allows withdrawal", async function () {
    const { host, player1, lobbyManager } = await deploySystem();

    await expect(lobbyManager.connect(host).createLobby("Alpha", { value: TICKET_PRICE }))
      .to.emit(lobbyManager, "LobbyCreated")
      .withArgs(1n, host.address, "Alpha");

    const lobbyAfterCreate = await lobbyManager.getLobby(1);
    expect(lobbyAfterCreate[0]).to.equal(host.address);
    expect(lobbyAfterCreate[1]).to.equal("Alpha");
    expect(lobbyAfterCreate[3]).to.equal(0n);
    expect(lobbyAfterCreate[4]).to.equal(0n);
    expect(lobbyAfterCreate[5]).to.equal(1n);
    expect(await lobbyManager.sessionSponsorPool(1)).to.equal(TICKET_PRICE);

    await expect(lobbyManager.connect(player1).buyTicket(1, { value: TICKET_PRICE }))
      .to.emit(lobbyManager, "TicketBought")
      .withArgs(1n, player1.address);

    const lobbyAfterSecondTicket = await lobbyManager.getLobby(1);
    expect(lobbyAfterSecondTicket[4]).to.equal(0n);
    expect(lobbyAfterSecondTicket[5]).to.equal(2n);
    expect(await lobbyManager.sessionSponsorPool(1)).to.equal(TICKET_PRICE * 2n);
    expect(await lobbyManager.hasTicket(1, player1.address)).to.equal(true);

    await expect(lobbyManager.connect(host).startGame(1))
      .to.emit(lobbyManager, "GameStarted")
      .withArgs(1n);

    const activeLobby = await lobbyManager.getLobby(1);
    expect(activeLobby[3]).to.equal(1n);

    await expect(lobbyManager.connect(host).completeGame(1, player1.address))
      .to.emit(lobbyManager, "GameCompleted")
      .withArgs(1n, player1.address, 0n);

    await lobbyManager.distributeSessionSponsorRemainder(1);
    expect(await lobbyManager.getPlayerBalance(host.address)).to.equal(TICKET_PRICE);
    expect(await lobbyManager.getPlayerBalance(player1.address)).to.equal(TICKET_PRICE);

    await lobbyManager.connect(host).withdraw();
    await lobbyManager.connect(player1).withdraw();

    expect(await lobbyManager.getPlayerBalance(host.address)).to.equal(0n);
    expect(await lobbyManager.getPlayerBalance(player1.address)).to.equal(0n);
    expect(await ethers.provider.getBalance(lobbyManager.target)).to.equal(0n);
  });

  it("cancels an open lobby and refunds all ticket holders", async function () {
    const { host, player1, lobbyManager } = await deploySystem();

    await lobbyManager.connect(host).createLobby("Refundable", { value: TICKET_PRICE });
    await lobbyManager.connect(player1).buyTicket(1, { value: TICKET_PRICE });

    await expect(lobbyManager.connect(host).cancelLobby(1))
      .to.emit(lobbyManager, "LobbyCancelled")
      .withArgs(1n);

    await lobbyManager.distributeSessionSponsorRemainder(1);
    expect(await lobbyManager.getPlayerBalance(host.address)).to.equal(TICKET_PRICE);
    expect(await lobbyManager.getPlayerBalance(player1.address)).to.equal(TICKET_PRICE);
    const canceledLobby = await lobbyManager.getLobby(1);
    expect(canceledLobby[3]).to.equal(3n);
  });

  it("lets a non-host leave an OPEN lobby with proportional pool refund", async function () {
    const { host, player1, lobbyManager } = await deploySystem();

    await lobbyManager.connect(host).createLobby("Leave me", { value: TICKET_PRICE });
    await lobbyManager.connect(player1).buyTicket(1, { value: TICKET_PRICE });

    const sponsorBefore = await lobbyManager.sessionSponsorPool(1);
    expect(sponsorBefore).to.equal(TICKET_PRICE * 2n);

    await expect(lobbyManager.connect(player1).leaveOpenLobby(1))
      .to.emit(lobbyManager, "PlayerLeftOpenLobby")
      .withArgs(1n, player1.address, sponsorBefore / 2n);

    expect(await lobbyManager.getPlayerBalance(player1.address)).to.equal(sponsorBefore / 2n);
    const after = await lobbyManager.getLobby(1);
    expect(after[5]).to.equal(1n); // playerCount — only host remains
    expect(await lobbyManager.hasTicket(1, player1.address)).to.equal(false);
    await expect(lobbyManager.connect(host).leaveOpenLobby(1)).to.be.revertedWith("Host must cancel lobby");
  });

  it("lets the host kick a non-host from an OPEN lobby with the same refund as voluntary leave", async function () {
    const { host, player1, lobbyManager } = await deploySystem();

    await lobbyManager.connect(host).createLobby("Kick me", { value: TICKET_PRICE });
    await lobbyManager.connect(player1).buyTicket(1, { value: TICKET_PRICE });

    const sponsorBeforeKick = await lobbyManager.sessionSponsorPool(1);
    expect(sponsorBeforeKick).to.equal(TICKET_PRICE * 2n);

    await expect(lobbyManager.connect(host).hostKickOpenLobbyPlayer(1, player1.address))
      .to.emit(lobbyManager, "PlayerKickedOpenLobby")
      .withArgs(1n, player1.address, sponsorBeforeKick / 2n);

    expect(await lobbyManager.getPlayerBalance(player1.address)).to.equal(sponsorBeforeKick / 2n);
    const after = await lobbyManager.getLobby(1);
    expect(after[5]).to.equal(1n);
    expect(await lobbyManager.hasTicket(1, player1.address)).to.equal(false);
    await expect(lobbyManager.connect(player1).hostKickOpenLobbyPlayer(1, host.address)).to.be.revertedWith("Only host");
  });
});

describe("GameCore gameplay", function () {
  it("stores on-chain map config and initializes round zero countdown", async function () {
    const seed = 555555555n;
    const radius = 6;
    const { gameCore, host } = await deploySystem();

    await gameCore.connect(host).bootstrapLobby(1, host.address, seed, radius);
    const mapConfig = await gameCore.getMapConfig(1);
    expect(mapConfig[0]).to.equal(seed);
    expect(mapConfig[1]).to.equal(radius);

    const startTx = await gameCore.connect(host).startGame(1, 240, 360, ethers.ZeroAddress);
    const startReceipt = await startTx.wait();
    const startBlock = await ethers.provider.getBlock(startReceipt.blockNumber);

    const roundState = await gameCore.getLobbyRound(1);
    expect(roundState[0]).to.equal(0n);
    expect(roundState[3]).to.equal(1n);
    expect(roundState[1]).to.equal(BigInt(startBlock.timestamp + 240));
    expect(roundState[2]).to.equal(BigInt(startBlock.timestamp + 240));
  });

  it("auto-advances from round zero after all players choose starting hexes", async function () {
    const { gameCore, host, player1 } = await setupLobby({ playerCount: 1 });
    const tiles = allTiles(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    const first = tiles[0];
    const second = tiles[1];

    await expect(gameCore.connect(host).pickStartingHex(1, first.hexId, first.q, first.r))
      .to.emit(gameCore, "HexPicked")
      .withArgs(1n, host.address, first.hexId);

    let roundState = await gameCore.getLobbyRound(1);
    expect(roundState[0]).to.equal(0n);
    expect(roundState[3]).to.equal(1n);

    await expect(gameCore.connect(player1).pickStartingHex(1, second.hexId, second.q, second.r))
      .to.emit(gameCore, "HexPicked")
      .withArgs(1n, player1.address, second.hexId)
      .and.to.emit(gameCore, "RoundAdvanced");

    roundState = await gameCore.getLobbyRound(1);
    expect(roundState[0]).to.equal(1n);
    expect(roundState[3]).to.equal(2n);

    const players = await gameCore.getLobbyPlayers(1);
    expect(players.length).to.equal(2);
  });

  it("lets one player start alone and then build, collect and upgrade a structure", async function () {
    const { gameCore, host, outsider } = await setupLobby({ playerCount: 0 });
    const tile = firstPlainsTile(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    const resourceKey = RESOURCE_BY_BIOME[tile.biome];
    const resourceIndex = ["food", "wood", "stone", "ore", "energy"].indexOf(resourceKey);

    await gameCore.connect(host).pickStartingHex(1, tile.hexId, tile.q, tile.r);

    const roundAfterPick = await gameCore.getLobbyRound(1);
    expect(roundAfterPick[0]).to.equal(1n);
    expect(roundAfterPick[3]).to.equal(2n);

    const beforeBuildResources = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    await expect(gameCore.connect(host).buildStructure(1, tile.hexId))
      .to.emit(gameCore, "StructureBuilt")
      .withArgs(1n, host.address, tile.hexId, 1n);
    const afterBuildResources = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    expect(afterBuildResources[0]).to.equal(beforeBuildResources[0] - 1n);
    expect(afterBuildResources[1]).to.equal(beforeBuildResources[1] - 1n);
    expect(afterBuildResources[2]).to.equal(beforeBuildResources[2] - 1n);

    await expect(gameCore.connect(outsider).buildStructure(1, tile.hexId))
      .to.be.revertedWith("Not owner");

    await expect(gameCore.connect(host).collect(1, tile.hexId))
      .to.be.revertedWith("Production starts next round");

    await mineSeconds(300);
    await expect(gameCore.connect(host).advanceRound(1, 300))
      .to.emit(gameCore, "RoundAdvanced");

    const beforeResources = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    const yieldAmt = 1n;
    await expect(gameCore.connect(host).collect(1, tile.hexId))
      .to.emit(gameCore, "ResourcesCollected")
      .withArgs(1n, host.address, tile.hexId, resourceKey, yieldAmt);

    const afterResources = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    expect(afterResources[resourceIndex]).to.equal(beforeResources[resourceIndex] + yieldAmt);
    expect(afterResources[4]).to.equal(beforeResources[4] - 10n);

    await setPlayerResources(gameCore, 1, host.address, {
      food: 20n,
      wood: 20n,
      stone: 20n,
      ore: 20n,
      energy: 100n
    });

    const beforeUpgradeResources = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    await expect(gameCore.connect(host).upgradeStructure(1, tile.hexId))
      .to.emit(gameCore, "StructureUpgraded")
      .withArgs(1n, host.address, tile.hexId, 2n);
    const afterUpgradeResources = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    expect(afterUpgradeResources[0]).to.equal(beforeUpgradeResources[0] - 2n);
    expect(afterUpgradeResources[2]).to.equal(beforeUpgradeResources[2] - 3n);
    expect(afterUpgradeResources[4]).to.equal(beforeUpgradeResources[4] - 25n);

    await expect(gameCore.connect(host).upgradeStructure(1, tile.hexId))
      .to.be.revertedWith("Already max");
  });

  it("claims only adjacent hexes and charges discovery cost", async function () {
    const { gameCore, host } = await setupLobby({ playerCount: 0 });
    const start = firstTile(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    const target = adjacentTile(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS, start);
    const farTile = allTiles(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS).find((tile) => tile.hexId !== start.hexId && !DIRECTIONS.some(([dq, dr]) => tile.q === start.q + dq && tile.r === start.r + dr));

    await gameCore.connect(host).pickStartingHex(1, start.hexId, start.q, start.r);

    const roundAfterPick = await gameCore.getLobbyRound(1);
    expect(roundAfterPick[0]).to.equal(1n);

    if (farTile) {
      await expect(gameCore.connect(host).discoverHex(1, farTile.hexId, farTile.q, farTile.r)).to.be.revertedWith("Must be adjacent");
    }

    const beforeResources = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    await expect(gameCore.connect(host).discoverHex(1, target.hexId, target.q, target.r))
      .to.emit(gameCore, "HexDiscovered")
      .withArgs(1n, host.address, target.hexId);

    const afterResources = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    expect(afterResources[0]).to.equal(beforeResources[0] - 0n);
    expect(afterResources[1]).to.equal(beforeResources[1] - 1n);
    expect(afterResources[2]).to.equal(beforeResources[2] - 0n);
    expect(afterResources[3]).to.equal(beforeResources[3] - 1n);

    const discoveredTile = await gameCore.getHexTile(1, target.hexId);
    expect(discoveredTile[3]).to.equal(host.address);
    expect(discoveredTile[4]).to.equal(true);
  });

  it("skips multiple rounds when the timeout is exceeded by more than one interval", async function () {
    const { gameCore, host } = await setupLobby({ playerCount: 0 });
    const start = firstTile(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    const target = adjacentTile(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS, start);

    await gameCore.connect(host).pickStartingHex(1, start.hexId, start.q, start.r);

    const roundBeforeTimeout = await gameCore.getLobbyRound(1);
    expect(roundBeforeTimeout[0]).to.equal(1n);

    await mineSeconds(ROUND_SECONDS * 2 + 5);

    await expect(gameCore.connect(host).discoverHex(1, target.hexId, target.q, target.r))
      .to.emit(gameCore, "RoundAdvanced")
      .and.to.emit(gameCore, "HexDiscovered");

    const roundAfterTimeout = await gameCore.getLobbyRound(1);
    expect(roundAfterTimeout[0]).to.equal(3n);
    expect(roundAfterTimeout[3]).to.equal(2n);
  });

  it("exposes the discovery cost curve from the contract", async function () {
    const { gameCore, host } = await setupLobby({ playerCount: 0 });
    const start = firstTile(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    const target = adjacentTile(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS, start);

    await gameCore.connect(host).pickStartingHex(1, start.hexId, start.q, start.r);

    const initialCost = asResourceTuple(await gameCore.previewDiscoverCost(1, host.address));
    expect(initialCost[0]).to.equal(0n);
    expect(initialCost[1]).to.equal(1n);
    expect(initialCost[2]).to.equal(0n);
    expect(initialCost[3]).to.equal(1n);

    await gameCore.connect(host).discoverHex(1, target.hexId, target.q, target.r);

    const afterFirstDiscoverCost = asResourceTuple(await gameCore.previewDiscoverCost(1, host.address));
    expect(afterFirstDiscoverCost[0]).to.equal(0n);
    expect(afterFirstDiscoverCost[1]).to.equal(1n);
    expect(afterFirstDiscoverCost[2]).to.equal(0n);
    expect(afterFirstDiscoverCost[3]).to.equal(1n);
  });

  it("exposes build and upgrade costs from the contract", async function () {
    const { gameCore } = await deploySystem();

    const buildCost = asResourceTuple(await gameCore.getBuildCost());
    expect(buildCost[0]).to.equal(1n);
    expect(buildCost[1]).to.equal(1n);
    expect(buildCost[2]).to.equal(1n);
    expect(buildCost[3]).to.equal(0n);
    expect(buildCost[4]).to.equal(0n);

    const upgradeCost = asResourceTuple(await gameCore.getUpgradeCost());
    expect(upgradeCost[0]).to.equal(2n);
    expect(upgradeCost[1]).to.equal(0n);
    expect(upgradeCost[2]).to.equal(3n);
    expect(upgradeCost[3]).to.equal(0n);
    expect(upgradeCost[4]).to.equal(25n);
  });

  it("exposes basic resource cap from GameConfig", async function () {
    const { gameCore } = await deploySystem();
    expect(await gameCore.getBasicResourceMax()).to.equal(20n);
  });

  it("assigns the configured starting resources to new players", async function () {
    const { gameCore, host, player1 } = await setupLobby({ playerCount: 1 });

    const hostResources = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    expect(hostResources[0]).to.equal(START_FOOD);
    expect(hostResources[1]).to.equal(START_WOOD);
    expect(hostResources[2]).to.equal(START_STONE);
    expect(hostResources[3]).to.equal(START_ORE);
    expect(hostResources[4]).to.equal(START_ENERGY);

    const playerResources = asResourceTuple(await gameCore.getPlayerResources(1, player1.address));
    expect(playerResources[0]).to.equal(START_FOOD);
    expect(playerResources[1]).to.equal(START_WOOD);
    expect(playerResources[2]).to.equal(START_STONE);
    expect(playerResources[3]).to.equal(START_ORE);
    expect(playerResources[4]).to.equal(START_ENERGY);
  });

  it("regenerates energy on each round advance and caps at configured max", async function () {
    const { gameCore, host } = await setupLobby({ playerCount: 0 });
    const start = firstTile(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    const target = adjacentTile(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS, start);

    const energyCfg = await gameCore.getEnergyConfig();
    expect(energyCfg[0]).to.equal(100n);
    expect(energyCfg[1]).to.equal(50n);
    expect(await gameCore.getTradingEnergyCost()).to.equal(0n);

    await gameCore.connect(host).pickStartingHex(1, start.hexId, start.q, start.r);
    const afterStart = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    expect(afterStart[4]).to.equal(START_ENERGY);

    await mineSeconds(ROUND_SECONDS + 5);
    await gameCore.connect(host).discoverHex(1, target.hexId, target.q, target.r);

    const afterTimeoutAction = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    expect(afterTimeoutAction[4]).to.equal(START_ENERGY);
  });

  it("exposes the collection energy cost by structure level", async function () {
    const { gameCore } = await deploySystem();

    expect(await gameCore.previewCollectionEnergyCost(1)).to.equal(10n);
    expect(await gameCore.previewCollectionEnergyCost(2)).to.equal(10n);
  });

  it("exposes the collection resource yield by structure level", async function () {
    const { gameCore } = await deploySystem();

    expect(await gameCore.previewCollectionResourceYield(1)).to.equal(1n);
    expect(await gameCore.previewCollectionResourceYield(2)).to.equal(2n);
  });

  it("supports unanimous end-round voting and advances the round immediately", async function () {
    const { gameCore, host, player1 } = await setupLobby({ playerCount: 1 });
    const tiles = allTiles(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);

    await gameCore.connect(host).pickStartingHex(1, tiles[0].hexId, tiles[0].q, tiles[0].r);
    await gameCore.connect(player1).pickStartingHex(1, tiles[1].hexId, tiles[1].q, tiles[1].r);

    const beforeRound = await gameCore.getLobbyRound(1);
    expect(beforeRound[0]).to.equal(1n);

    await expect(gameCore.connect(host).createProposal(1, "End round", "__END_ROUND__", 999))
      .to.emit(gameCore, "ProposalCreated")
      .withArgs(1n, 0n, "End round", "__END_ROUND__");

    await expect(gameCore.connect(host).vote(1, 0, true))
      .to.emit(gameCore, "ProposalVoted")
      .withArgs(1n, 0n, host.address, true);

    await expect(gameCore.connect(player1).vote(1, 0, true))
      .to.emit(gameCore, "ProposalVoted")
      .withArgs(1n, 0n, player1.address, true)
      .and.to.emit(gameCore, "ProposalResolved")
      .withArgs(1n, 0n, true)
      .and.to.emit(gameCore, "RoundAdvanced");

    const afterRound = await gameCore.getLobbyRound(1);
    expect(afterRound[0]).to.equal(2n);
    expect(afterRound[3]).to.equal(2n);

    const proposal = await gameCore.getProposal(1, 0);
    expect(proposal[4]).to.equal(true);
    expect(proposal[5]).to.equal(true);
  });

  it("advances rounds lazily on the next transaction after timer timeout", async function () {
    const { gameCore, host } = await setupLobby({ playerCount: 0 });
    const tile = firstTile(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    const adjacent = adjacentTile(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS, tile);

    await gameCore.connect(host).pickStartingHex(1, tile.hexId, tile.q, tile.r);

    const roundBeforeTimeout = await gameCore.getLobbyRound(1);
    expect(roundBeforeTimeout[0]).to.equal(1n);

    await mineSeconds(ROUND_SECONDS + 5);

    await expect(gameCore.connect(host).discoverHex(1, adjacent.hexId, adjacent.q, adjacent.r))
      .to.emit(gameCore, "RoundAdvanced")
      .and.to.emit(gameCore, "HexDiscovered");

    const roundAfterNextTx = await gameCore.getLobbyRound(1);
    expect(roundAfterNextTx[0]).to.equal(2n);
    expect(roundAfterNextTx[3]).to.equal(2n);
  });

  it("resolves a normal proposal after votes at close round", async function () {
    const { gameCore, host, player1 } = await setupLobby({ playerCount: 1 });
    const tiles = allTiles(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);

    await gameCore.connect(host).pickStartingHex(1, tiles[0].hexId, tiles[0].q, tiles[0].r);
    await gameCore.connect(player1).pickStartingHex(1, tiles[1].hexId, tiles[1].q, tiles[1].r);

    const currentRound = await gameCore.getLobbyRound(1);
    expect(currentRound[0]).to.equal(1n);

    await expect(gameCore.connect(host).createProposal(1, "Food subsidy", "foodBoost", 3))
      .to.emit(gameCore, "ProposalCreated")
      .withArgs(1n, 0n, "Food subsidy", "foodBoost");

    await gameCore.connect(host).vote(1, 0, true);
    await gameCore.connect(player1).vote(1, 0, false);

    let proposal = await gameCore.getProposal(1, 0);
    expect(proposal[4]).to.equal(false);

    await mineSeconds(300);
    await gameCore.connect(host).advanceRound(1, 300);

    proposal = await gameCore.getProposal(1, 0);
    expect(proposal[4]).to.equal(false);

    await mineSeconds(300);
    await expect(gameCore.connect(host).advanceRound(1, 300)).to.emit(gameCore, "ProposalResolved").withArgs(1n, 0n, false);

    proposal = await gameCore.getProposal(1, 0);
    expect(proposal[4]).to.equal(true);
    expect(proposal[5]).to.equal(false);
  });

  it("creates and accepts trades between multiple players", async function () {
    const { gameCore, host, player1 } = await setupLobby({ playerCount: 1 });
    const tiles = allTiles(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);

    await gameCore.connect(host).pickStartingHex(1, tiles[0].hexId, tiles[0].q, tiles[0].r);
    await gameCore.connect(player1).pickStartingHex(1, tiles[1].hexId, tiles[1].q, tiles[1].r);

    const offer = [1n, 0n, 0n, 0n, 0n];
    const request = [0n, 1n, 0n, 0n, 0n];

    await expect(gameCore.connect(host).createTrade(1, player1.address, offer, request, 2))
      .to.emit(gameCore, "TradeCreated")
      .withArgs(1n, 0n, host.address, player1.address);

    const tradeBefore = await gameCore.getTrade(1, 0);
    expect(tradeBefore[0]).to.equal(host.address);
    expect(tradeBefore[1]).to.equal(player1.address);
    expect(tradeBefore[2]).to.equal(false);

    await expect(gameCore.connect(player1).acceptTrade(1, 0))
      .to.emit(gameCore, "TradeAccepted")
      .withArgs(1n, 0n, player1.address);

    const tradeAfter = await gameCore.getTrade(1, 0);
    expect(tradeAfter[2]).to.equal(true);

    const hostAfter = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    const p1After = asResourceTuple(await gameCore.getPlayerResources(1, player1.address));
    expect(hostAfter[0]).to.equal(1n);
    expect(hostAfter[1]).to.equal(3n);
    expect(p1After[0]).to.equal(3n);
    expect(p1After[1]).to.equal(1n);
  });

  it("trades four basic resources with the bank for one other", async function () {
    const { gameCore, host } = await setupLobby({ playerCount: 0 });
    const tile = firstTile(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    await gameCore.connect(host).pickStartingHex(1, tile.hexId, tile.q, tile.r);

    await setPlayerResources(gameCore, 1, host.address, {
      food: 20n,
      wood: 20n,
      stone: 20n,
      ore: 20n,
      energy: 100n
    });

    const before = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    await expect(gameCore.connect(host).tradeWithBank(1, 0, 1)).to.emit(gameCore, "BankTrade");
    const after = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    expect(after[0]).to.equal(before[0] - 4n);
    /** Wood was already at `basicResourceMax`; extra from bank is clamped on-chain. */
    expect(after[1]).to.equal(20n);
  });

  it("applies multiple 4:1 bank lots in one bulk transaction", async function () {
    const { gameCore, host } = await setupLobby({ playerCount: 0 });
    const tile = firstTile(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    await gameCore.connect(host).pickStartingHex(1, tile.hexId, tile.q, tile.r);

    await setPlayerResources(gameCore, 1, host.address, {
      food: 20n,
      wood: 20n,
      stone: 20n,
      ore: 20n,
      energy: 100n
    });

    const lots = 3n;
    const before = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    await expect(gameCore.connect(host).tradeWithBankBulk(1, 0, 1, lots)).to.emit(gameCore, "BankTrade");
    const after = asResourceTuple(await gameCore.getPlayerResources(1, host.address));
    expect(after[0]).to.equal(before[0] - 4n * lots);
    expect(after[1]).to.equal(20n);
  });

  it("exposes bulk bank trade lot cap", async function () {
    const { gameCore } = await deploySystem();
    expect(await gameCore.getBankTradeBulkMaxLots()).to.equal(48n);
  });

  it("ends the game by unanimous vote during zero round", async function () {
    const { gameCore, host, player1 } = await setupLobby({ playerCount: 1 });
    await expect(gameCore.connect(host).createProposal(1, "Abort", "__END_GAME__", 0))
      .to.emit(gameCore, "ProposalCreated")
      .withArgs(1n, 0n, "Abort", "__END_GAME__");

    await gameCore.connect(host).vote(1, 0, true);
    await expect(gameCore.connect(player1).vote(1, 0, true))
      .to.emit(gameCore, "GameEnded")
      .withArgs(1n, 0n);

    const round = await gameCore.getLobbyRound(1);
    expect(round[3]).to.equal(3n);
  });

  it("rejects a second vote from the same player", async function () {
    const { gameCore, host, player1 } = await setupLobby({ playerCount: 1 });
    const tiles = allTiles(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    await gameCore.connect(host).pickStartingHex(1, tiles[0].hexId, tiles[0].q, tiles[0].r);
    await gameCore.connect(player1).pickStartingHex(1, tiles[1].hexId, tiles[1].q, tiles[1].r);

    await gameCore.connect(host).createProposal(1, "End round", "__END_ROUND__", 99);
    await gameCore.connect(host).vote(1, 0, true);
    await expect(gameCore.connect(host).vote(1, 0, true)).to.be.revertedWith("Already voted");
  });

  it("allows game master executor to adjust resources with caps", async function () {
    const { gameCore, host, player1 } = await setupLobby({ playerCount: 1 });
    const tiles = allTiles(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    await gameCore.connect(host).pickStartingHex(1, tiles[0].hexId, tiles[0].q, tiles[0].r);
    await gameCore.connect(player1).pickStartingHex(1, tiles[1].hexId, tiles[1].q, tiles[1].r);

    const grant = { food: 5n, wood: 0n, stone: 0n, ore: 0n, energy: 0n };
    await setPlayerResources(gameCore, 1, player1.address, {
      food: START_FOOD + grant.food,
      wood: START_WOOD,
      stone: START_STONE,
      ore: START_ORE,
      energy: START_ENERGY
    });

    const res = asResourceTuple(await gameCore.getPlayerResources(1, player1.address));
    expect(res[0]).to.equal(START_FOOD + 5n);
  });

  it("allows a player to destroy and rebuild their own structure", async function () {
    const { gameCore, host, outsider } = await setupLobby({ playerCount: 0 });
    const tile = firstPlainsTile(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);

    await gameCore.connect(host).pickStartingHex(1, tile.hexId, tile.q, tile.r);
    await gameCore.connect(host).buildStructure(1, tile.hexId);

    await expect(gameCore.connect(outsider).destroyStructure(1, tile.hexId))
      .to.be.revertedWith("Not owner");

    await expect(gameCore.connect(host).destroyStructure(1, tile.hexId))
      .to.emit(gameCore, "StructureDestroyed")
      .withArgs(1n, host.address, tile.hexId);

    await expect(gameCore.connect(host).buildStructure(1, tile.hexId))
      .to.emit(gameCore, "StructureBuilt")
      .withArgs(1n, host.address, tile.hexId, 1n);
  });
});
