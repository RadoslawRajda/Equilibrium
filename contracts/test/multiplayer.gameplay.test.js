const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { TICKET_PRICE, DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS, ZERO_ROUND_SECONDS, ROUND_SECONDS } = require("./gameplay.config.js");

async function deploySystem() {
  const [deployer, host, player1, player2, player3, outsider] = await ethers.getSigners();
  const LobbyManager = await ethers.getContractFactory("LobbyManager");
  const GameCore = await ethers.getContractFactory("GameCore");
  const lobbyManager = await LobbyManager.deploy();
  await lobbyManager.waitForDeployment();
  const gameCore = await GameCore.deploy(await lobbyManager.getAddress());
  await gameCore.waitForDeployment();
  await lobbyManager.setGameCore(await gameCore.getAddress());
  return { deployer, host, player1, player2, player3, outsider, lobbyManager, gameCore };
}

function allTiles(seed, radius) {
  const within = (q, r, rad) => Math.abs(q) <= rad && Math.abs(r) <= rad && Math.abs(q + r) <= rad;
  const tiles = [];
  for (let q = -radius; q <= radius; q += 1) {
    for (let r = -radius; r <= radius; r += 1) {
      if (!within(q, r, radius)) continue;
      tiles.push({ q, r, hexId: `${q},${r}` });
    }
  }
  return tiles;
}

async function setupLobby({ playerCount = 0, seed = DEFAULT_MAP_SEED, radius = DEFAULT_MAP_RADIUS } = {}) {
  const system = await deploySystem();
  const { host, player1, player2, player3, lobbyManager, gameCore } = system;
  const extraPlayers = [player1, player2, player3].slice(0, playerCount);

  await lobbyManager.connect(host).createLobby("MP test", { value: TICKET_PRICE });
  await gameCore.connect(host).bootstrapLobby(1, host.address, seed, radius);

  for (const player of extraPlayers) {
    await lobbyManager.connect(player).buyTicket(1, { value: TICKET_PRICE });
    await gameCore.connect(player).joinLobby(1);
  }

  await lobbyManager.connect(host).startGame(1);
  await gameCore.connect(host).startGame(1, ZERO_ROUND_SECONDS, ROUND_SECONDS, await lobbyManager.getAddress());

  return { ...system, seed, radius, lobbyId: 1n };
}

async function mineSeconds(seconds) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

describe("Multiplayer GameCore", function () {
  it("keeps two players alive with starting resources after round 0 completes", async function () {
    const { gameCore, host, player1 } = await setupLobby({ playerCount: 1 });
    const tiles = allTiles(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    const a = tiles[0];
    const b = tiles[1];

    await gameCore.connect(host).pickStartingHex(1, a.hexId, a.q, a.r);
    await gameCore.connect(player1).pickStartingHex(1, b.hexId, b.q, b.r);

    const roundState = await gameCore.getLobbyRound(1);
    expect(roundState[0]).to.equal(1n);

    const gc = await gameCore.getLobbyPlayers(1);
    expect(gc.map((x) => x.toLowerCase())).to.deep.equal([host.address, player1.address].map((x) => x.toLowerCase()));

    for (const addr of [host.address, player1.address]) {
      expect(await gameCore.isPlayerAlive(1, addr)).to.equal(true);
      const res = await gameCore.getPlayerResources(1, addr);
      expect(res[0]).to.equal(18n);
      expect(res[1]).to.equal(18n);
      expect(res[2]).to.equal(18n);
      expect(res[3]).to.equal(18n);
      expect(res[4]).to.equal(36n);
    }
  });

  it("keeps three players registered and advances round after all picks", async function () {
    const { gameCore, host, player1, player2 } = await setupLobby({ playerCount: 2 });
    const tiles = allTiles(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);

    await gameCore.connect(host).pickStartingHex(1, tiles[0].hexId, tiles[0].q, tiles[0].r);
    await gameCore.connect(player1).pickStartingHex(1, tiles[1].hexId, tiles[1].q, tiles[1].r);
    await gameCore.connect(player2).pickStartingHex(1, tiles[2].hexId, tiles[2].q, tiles[2].r);

    const roundState = await gameCore.getLobbyRound(1);
    expect(roundState[0]).to.equal(1n);
    expect(roundState[3]).to.equal(2n); // Status.Running

    const gc = await gameCore.getLobbyPlayers(1);
    expect(gc.length).to.equal(3);
  });

  it("simulates short multi-player loop: collect after round advance, both still alive", async function () {
    const { gameCore, host, player1 } = await setupLobby({ playerCount: 1 });
    const tiles = allTiles(DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    const t0 = tiles[0];

    await gameCore.connect(host).pickStartingHex(1, tiles[0].hexId, tiles[0].q, tiles[0].r);
    await gameCore.connect(player1).pickStartingHex(1, tiles[1].hexId, tiles[1].q, tiles[1].r);

    await gameCore.connect(host).buildStructure(1, t0.hexId);

    await mineSeconds(300);
    await gameCore.connect(host).advanceRound(1, 300);

    expect(await gameCore.isPlayerAlive(1, host.address)).to.equal(true);
    expect(await gameCore.isPlayerAlive(1, player1.address)).to.equal(true);

    await expect(gameCore.connect(host).collect(1, t0.hexId, 30)).to.emit(gameCore, "ResourcesCollected");
  });
});
