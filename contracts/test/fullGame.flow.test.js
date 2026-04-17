const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const {
  TICKET_PRICE,
  DEFAULT_MAP_SEED,
  DEFAULT_MAP_RADIUS,
  ZERO_ROUND_SECONDS,
  ROUND_SECONDS
} = require("./gameplay.config.js");

/** GameCore.Status: Waiting=0, ZeroRound=1, Running=2, Ended=3 */
const GC = { Waiting: 0, ZeroRound: 1, Running: 2, Ended: 3 };
/** LobbyManager.LobbyStatus: OPEN=0, ACTIVE=1, COMPLETED=2, CANCELLED=3 */
const LM = { OPEN: 0, ACTIVE: 1, COMPLETED: 2, CANCELLED: 3 };

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

async function mineSeconds(seconds) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

async function setupRunningLobby({ playerCount = 0, seed = DEFAULT_MAP_SEED, radius = DEFAULT_MAP_RADIUS } = {}) {
  const system = await deploySystem();
  const { host, player1, player2, lobbyManager, gameCore } = system;
  const extras = [player1, player2].slice(0, playerCount);

  await lobbyManager.connect(host).createLobby("Full flow", { value: TICKET_PRICE });
  await gameCore.connect(host).bootstrapLobby(1, host.address, seed, radius);

  for (const p of extras) {
    await lobbyManager.connect(p).buyTicket(1, { value: TICKET_PRICE });
    await gameCore.connect(p).joinLobby(1);
  }

  await lobbyManager.connect(host).startGame(1);
  await gameCore.connect(host).startGame(1, ZERO_ROUND_SECONDS, ROUND_SECONDS, await lobbyManager.getAddress());

  const tiles = allTiles(seed, radius);
  return { ...system, lobbyId: 1n, tiles };
}

describe("Full game flow — status, victory, cancel, payout", function () {
  it("registers every LobbyManager ticket holder in GameCore when host starts (even without prior joinLobby)", async function () {
    const { host, player1, lobbyManager, gameCore } = await deploySystem();
    await lobbyManager.connect(host).createLobby("Sync tickets", { value: TICKET_PRICE });
    await gameCore.connect(host).bootstrapLobby(1, host.address, DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    await lobbyManager.connect(player1).buyTicket(1, { value: TICKET_PRICE });

    await lobbyManager.connect(host).startGame(1);
    await gameCore.connect(host).startGame(1, ZERO_ROUND_SECONDS, ROUND_SECONDS, await lobbyManager.getAddress());

    const gc = await gameCore.getLobbyPlayers(1);
    expect(gc.length).to.equal(2);
    const lower = gc.map((a) => a.toLowerCase());
    expect(lower).to.include(host.address.toLowerCase());
    expect(lower).to.include(player1.address.toLowerCase());
    expect(await gameCore.isPlayerAlive(1, player1.address)).to.equal(true);
  });

  it("advances GameCore status Waiting → ZeroRound → Running → Ended on alloy victory (solo)", async function () {
    const { gameCore, host, tiles } = await setupRunningLobby({ playerCount: 0 });
    const t = tiles[0];

    let r = await gameCore.getLobbyRound(1);
    expect(r[3]).to.equal(GC.ZeroRound);

    await gameCore.connect(host).pickStartingHex(1, t.hexId, t.q, t.r);

    r = await gameCore.getLobbyRound(1);
    expect(r[3]).to.equal(GC.Running);
    expect(r[0]).to.equal(1n);

    const threshold = await gameCore.getVictoryGoodsThreshold();
    expect(threshold).to.equal(5n);

    for (let i = 0; i < Number(threshold); i += 1) {
      await gameCore.connect(host).craftAlloy(1);
    }

    r = await gameCore.getLobbyRound(1);
    expect(r[3]).to.equal(GC.Ended);

    const goods = await gameCore.getPlayerCraftedGoods(1, host.address);
    expect(goods).to.equal(threshold);
  });

  it("credits prize pool to playerBalance automatically when GameCore reports a winner", async function () {
    const { gameCore, host, lobbyManager, tiles } = await setupRunningLobby({ playerCount: 0 });
    const t = tiles[0];
    await gameCore.connect(host).pickStartingHex(1, t.hexId, t.q, t.r);

    const poolBefore = (await lobbyManager.getLobby(1))[4];

    const threshold = await gameCore.getVictoryGoodsThreshold();
    for (let i = 0; i < Number(threshold); i += 1) {
      await gameCore.connect(host).craftAlloy(1);
    }

    const lmAfter = await lobbyManager.getLobby(1);
    expect(lmAfter[3]).to.equal(LM.COMPLETED);
    expect(await lobbyManager.getPlayerBalance(host.address)).to.equal(poolBefore);

    await expect(lobbyManager.connect(host).completeGame(1, host.address)).to.be.revertedWith("Game not active");
  });

  it("cancels an OPEN lobby with refunds and rejects cancel after the match is ACTIVE", async function () {
    const { host, player1, lobbyManager, gameCore } = await deploySystem();

    await lobbyManager.connect(host).createLobby("Cancel me", { value: TICKET_PRICE });
    await gameCore.connect(host).bootstrapLobby(1, host.address, DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    await lobbyManager.connect(player1).buyTicket(1, { value: TICKET_PRICE });
    await gameCore.connect(player1).joinLobby(1);

    const poolBefore = (await lobbyManager.getLobby(1))[4];
    expect(poolBefore).to.equal(TICKET_PRICE * 2n);

    await expect(lobbyManager.connect(host).cancelLobby(1)).to.emit(lobbyManager, "LobbyCancelled").withArgs(1n);

    const lm = await lobbyManager.getLobby(1);
    expect(lm[3]).to.equal(LM.CANCELLED);
    expect(await lobbyManager.getPlayerBalance(host.address)).to.equal(TICKET_PRICE);
    expect(await lobbyManager.getPlayerBalance(player1.address)).to.equal(TICKET_PRICE);

    await expect(lobbyManager.connect(host).cancelLobby(1)).to.be.reverted;

    const fresh = await deploySystem();
    await fresh.lobbyManager.connect(fresh.host).createLobby("Active", { value: TICKET_PRICE });
    await fresh.gameCore.connect(fresh.host).bootstrapLobby(1, fresh.host.address, DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
    await fresh.lobbyManager.connect(fresh.host).startGame(1);

    await expect(fresh.lobbyManager.connect(fresh.host).cancelLobby(1)).to.be.revertedWith("Can only cancel open lobbies");
  });

  it("ends a two-player match with Victory when one player concedes", async function () {
    const { gameCore, host, player1, lobbyManager, tiles } = await setupRunningLobby({ playerCount: 1 });
    const a = tiles[0];
    const b = tiles[1];

    await gameCore.connect(host).pickStartingHex(1, a.hexId, a.q, a.r);
    await gameCore.connect(player1).pickStartingHex(1, b.hexId, b.q, b.r);

    const pool = (await lobbyManager.getLobby(1))[4];

    await expect(gameCore.connect(host).concede(1))
      .to.emit(gameCore, "PlayerConceded")
      .withArgs(1n, host.address)
      .and.to.emit(gameCore, "Victory")
      .withArgs(1n, player1.address)
      .and.to.emit(lobbyManager, "GameCompleted")
      .withArgs(1n, player1.address, pool);

    const r = await gameCore.getLobbyRound(1);
    expect(r[3]).to.equal(GC.Ended);
    expect(await gameCore.isPlayerAlive(1, host.address)).to.equal(false);
    expect(await gameCore.isPlayerAlive(1, player1.address)).to.equal(true);
    expect((await lobbyManager.getLobby(1))[3]).to.equal(2n);
    expect(await lobbyManager.getPlayerBalance(player1.address)).to.equal(pool);
  });

  it("abandons a solo match when the only player concedes", async function () {
    const { gameCore, host, tiles } = await setupRunningLobby({ playerCount: 0 });
    const t = tiles[0];
    await gameCore.connect(host).pickStartingHex(1, t.hexId, t.q, t.r);

    await expect(gameCore.connect(host).concede(1))
      .to.emit(gameCore, "PlayerConceded")
      .withArgs(1n, host.address)
      .and.to.emit(gameCore, "GameAbandoned")
      .withArgs(1n);

    const r = await gameCore.getLobbyRound(1);
    expect(r[3]).to.equal(GC.Ended);
  });

  it("resolves unanimous __END_GAME__ vote during Running and sets status to Ended", async function () {
    const { gameCore, host, player1, tiles } = await setupRunningLobby({ playerCount: 1 });
    await gameCore.connect(host).pickStartingHex(1, tiles[0].hexId, tiles[0].q, tiles[0].r);
    await gameCore.connect(player1).pickStartingHex(1, tiles[1].hexId, tiles[1].q, tiles[1].r);

    await expect(gameCore.connect(host).createProposal(1, "Stop", "__END_GAME__", 5))
      .to.emit(gameCore, "ProposalCreated")
      .withArgs(1n, 0n, "Stop", "__END_GAME__");

    await gameCore.connect(host).vote(1, 0, true);
    await expect(gameCore.connect(player1).vote(1, 0, true))
      .to.emit(gameCore, "ProposalResolved")
      .and.to.emit(gameCore, "GameEnded");

    const r = await gameCore.getLobbyRound(1);
    expect(r[3]).to.equal(GC.Ended);

    const prop = await gameCore.getProposal(1, 0);
    expect(prop[5]).to.equal(true);
  });

  it("rejects gameplay actions after GameCore has ended", async function () {
    const { gameCore, host, tiles } = await setupRunningLobby({ playerCount: 0 });
    const t = tiles[0];
    await gameCore.connect(host).pickStartingHex(1, t.hexId, t.q, t.r);

    const threshold = await gameCore.getVictoryGoodsThreshold();
    for (let i = 0; i < Number(threshold); i += 1) {
      await gameCore.connect(host).craftAlloy(1);
    }

    await expect(gameCore.connect(host).craftAlloy(1)).to.be.revertedWith("Game ended");
    await expect(gameCore.connect(host).tradeWithBank(1, 0, 1)).to.be.revertedWith("Game ended");
  });

  it("allows advanceRound only while the game is active (not after Ended)", async function () {
    const { gameCore, host, tiles } = await setupRunningLobby({ playerCount: 0 });
    const t = tiles[0];
    await gameCore.connect(host).pickStartingHex(1, t.hexId, t.q, t.r);

    await mineSeconds(ROUND_SECONDS + 1);
    await gameCore.connect(host).advanceRound(1, ROUND_SECONDS);

    const threshold = await gameCore.getVictoryGoodsThreshold();
    for (let i = 0; i < Number(threshold); i += 1) {
      await gameCore.connect(host).craftAlloy(1);
    }

    await expect(gameCore.connect(host).advanceRound(1, ROUND_SECONDS)).to.be.reverted;
  });
});
