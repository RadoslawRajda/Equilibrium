const { expect } = require("chai");
const { ethers } = require("hardhat");

const TICKET_PRICE = ethers.parseEther("0.05");

describe("Frontend-contracts integration", function () {
  it("exposes a complete chain snapshot compatible with frontend LobbyRepository reads", async function () {
    const [host, player] = await ethers.getSigners();

    const LobbyManager = await ethers.getContractFactory("LobbyManager");
    const GameCore = await ethers.getContractFactory("GameCore");

    const lobbyManager = await LobbyManager.deploy();
    await lobbyManager.waitForDeployment();

    const gameCore = await GameCore.deploy();
    await gameCore.waitForDeployment();

    const lobbyId = 1n;
    const seed = 777n;
    const radius = 2;

    await lobbyManager.connect(host).createLobby("Integration Lobby", { value: TICKET_PRICE });
    await gameCore.connect(host).bootstrapLobby(lobbyId, host.address, seed, radius);

    await lobbyManager.connect(player).buyTicket(lobbyId, { value: TICKET_PRICE });
    await gameCore.connect(player).joinLobby(lobbyId);

    await lobbyManager.connect(host).startGame(lobbyId);
    await gameCore.connect(host).startGame(lobbyId, 300, 300);

    const lobbyCount = await lobbyManager.getLobbyCount();
    const lobbyData = await lobbyManager.getLobby(lobbyId);
    const lobbyPlayers = await lobbyManager.getLobbyPlayers(lobbyId);

    expect(lobbyCount).to.equal(1n);
    expect(lobbyData[0]).to.equal(host.address);
    expect(lobbyData[1]).to.equal("Integration Lobby");
    expect(lobbyData[5]).to.equal(2n);
    expect(lobbyPlayers).to.deep.equal([host.address, player.address]);

    const roundData = await gameCore.getLobbyRound(lobbyId);
    const mapConfig = await gameCore.getMapConfig(lobbyId);

    expect(roundData[3]).to.equal(1n); // zero-round
    expect(mapConfig[0]).to.equal(seed);
    expect(mapConfig[1]).to.equal(radius);

    const buildCost = await gameCore.getBuildCost();
    const upgradeCost = await gameCore.getUpgradeCost();
    const discoverCost = await gameCore.previewDiscoverCost(lobbyId, host.address);
    const hostResources = await gameCore.getPlayerResources(lobbyId, host.address);

    expect(buildCost[0]).to.equal(10n);
    expect(upgradeCost[0]).to.equal(30n);
    expect(discoverCost[0]).to.equal(40n);
    expect(hostResources[0]).to.equal(50n);
    expect(hostResources[4]).to.equal(100n);

    const hex = await gameCore.getHexTile(lobbyId, "0,0");
    expect(Number(hex[0])).to.equal(0);
    expect(Number(hex[1])).to.equal(0);
    expect(hex[3]).to.equal("0x0000000000000000000000000000000000000000");
    expect(hex[4]).to.equal(false);
  });
});
