const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getLinkedGameCoreFactory } = require("./helpers/deployGameCoreFactory.js");
const {
  TICKET_PRICE,
  DEFAULT_MAP_SEED,
  DEFAULT_MAP_RADIUS,
  ZERO_ROUND_SECONDS,
  ROUND_SECONDS
} = require("./gameplay.config.js");

describe("ExperienceStats integration", function () {
  async function deployFixture() {
    const [owner, host, player] = await ethers.getSigners();

    const LobbyManager = await ethers.getContractFactory("LobbyManager");
    const ExperienceStats = await ethers.getContractFactory("ExperienceStats");
    const GameCore = await getLinkedGameCoreFactory();

    const lobbyManager = await LobbyManager.deploy();
    await lobbyManager.waitForDeployment();

    const gameCore = await GameCore.deploy(await lobbyManager.getAddress());
    await gameCore.waitForDeployment();

    const experienceStats = await ExperienceStats.deploy();
    await experienceStats.waitForDeployment();

    await lobbyManager.connect(owner).setGameCore(await gameCore.getAddress());
    await experienceStats.connect(owner).setStatsUpdater(await lobbyManager.getAddress());
    await lobbyManager
      .connect(owner)
      .setExperienceStatsRegistry(await experienceStats.getAddress());

    return { owner, host, player, lobbyManager, gameCore, experienceStats };
  }

  async function createActiveLobby({ host, player, lobbyManager, gameCore }, lobbyId) {
    await lobbyManager.connect(host).createLobby(`Lobby ${lobbyId}`, { value: TICKET_PRICE });
    await gameCore
      .connect(host)
      .bootstrapLobby(lobbyId, host.address, DEFAULT_MAP_SEED + BigInt(lobbyId), DEFAULT_MAP_RADIUS);
    await lobbyManager.connect(player).buyTicket(lobbyId, { value: TICKET_PRICE });
    await gameCore.connect(player).joinLobby(lobbyId);
    await lobbyManager.connect(host).startGame(lobbyId);
    await gameCore
      .connect(host)
      .startGame(lobbyId, ZERO_ROUND_SECONDS, ROUND_SECONDS, await lobbyManager.getAddress());
  }

  it("records +10 for winner and +1 for non-winner finisher on completeGame", async function () {
    const { host, player, lobbyManager, gameCore, experienceStats } = await deployFixture();

    await createActiveLobby({ host, player, lobbyManager, gameCore }, 1n);
    await lobbyManager.connect(host).completeGame(1n, host.address);

    const hostStats = await experienceStats.playerStats(host.address);
    const playerStats = await experienceStats.playerStats(player.address);

    expect(hostStats.experiencePoints).to.equal(10n);
    expect(hostStats.gamesPlayed).to.equal(1n);
    expect(hostStats.gamesWon).to.equal(1n);

    expect(playerStats.experiencePoints).to.equal(1n);
    expect(playerStats.gamesPlayed).to.equal(1n);
    expect(playerStats.gamesWon).to.equal(0n);

    expect(await experienceStats.lobbyResultRecorded(1n)).to.equal(true);
  });

  it("records -1 exit (without going below zero) when player leaves open lobby", async function () {
    const { host, player, lobbyManager, experienceStats } = await deployFixture();

    await lobbyManager.connect(host).createLobby("Open Lobby", { value: TICKET_PRICE });
    await lobbyManager.connect(player).buyTicket(1n, { value: TICKET_PRICE });

    await lobbyManager.connect(player).leaveOpenLobby(1n);

    const playerStats = await experienceStats.playerStats(player.address);
    expect(playerStats.gamesLeft).to.equal(1n);
    expect(playerStats.experiencePoints).to.equal(0n);
    expect(await experienceStats.lobbyExitRecorded(1n, player.address)).to.equal(true);
  });

  it("records -1 exit automatically when player concedes", async function () {
    const { host, player, lobbyManager, gameCore, experienceStats } = await deployFixture();

    await createActiveLobby({ host, player, lobbyManager, gameCore }, 1n);
    await gameCore.connect(host).pickStartingHex(1n, "0,0", 0, 0);
    await gameCore.connect(player).pickStartingHex(1n, "1,0", 1, 0);

    await gameCore.connect(player).concede(1n);

    const playerStats = await experienceStats.playerStats(player.address);
    expect(playerStats.gamesLeft).to.equal(1n);
    expect(playerStats.experiencePoints).to.equal(0n);
    expect(playerStats.gamesPlayed).to.equal(0n);
    expect(await experienceStats.lobbyExitRecorded(1n, player.address)).to.equal(true);

    const hostStats = await experienceStats.playerStats(host.address);
    expect(hostStats.experiencePoints).to.equal(10n);
  });
});
