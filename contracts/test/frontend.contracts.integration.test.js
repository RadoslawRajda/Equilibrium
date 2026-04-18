const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getLinkedGameCoreFactory } = require("./helpers/deployGameCoreFactory.js");
const { asResourceTuple } = require("./helpers/resourceTuple.js");

const TICKET_PRICE = ethers.parseEther("1");

describe("Frontend-contracts integration", function () {
  it("exposes a complete chain snapshot compatible with frontend LobbyRepository reads", async function () {
    const [host, player] = await ethers.getSigners();

    const LobbyManager = await ethers.getContractFactory("LobbyManager");
    const GameCore = await getLinkedGameCoreFactory();

    const lobbyManager = await LobbyManager.deploy();
    await lobbyManager.waitForDeployment();

    const gameCore = await GameCore.deploy(await lobbyManager.getAddress());
    await gameCore.waitForDeployment();
    await lobbyManager.setGameCore(await gameCore.getAddress());

    const lobbyId = 1n;
    const seed = 777n;
    const radius = 2;

    await lobbyManager.connect(host).createLobby("Integration Lobby", { value: TICKET_PRICE });
    await gameCore.connect(host).bootstrapLobby(lobbyId, host.address, seed, radius);

    await lobbyManager.connect(player).buyTicket(lobbyId, { value: TICKET_PRICE });
    await gameCore.connect(player).joinLobby(lobbyId);

    await lobbyManager.connect(host).startGame(lobbyId);
    await gameCore.connect(host).startGame(lobbyId, 300, 300, await lobbyManager.getAddress());

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

    const buildCost = asResourceTuple(await gameCore.getBuildCost());
    const upgradeCost = asResourceTuple(await gameCore.getUpgradeCost());
    const discoverCost = asResourceTuple(await gameCore.previewDiscoverCost(lobbyId, host.address));
    const hostResources = asResourceTuple(await gameCore.getPlayerResources(lobbyId, host.address));

    expect(buildCost[0]).to.equal(1n);
    expect(upgradeCost[0]).to.equal(2n);
    expect(discoverCost[0]).to.equal(0n);
    expect(discoverCost[1]).to.equal(1n);
    expect(hostResources[0]).to.equal(2n);
    expect(hostResources[1]).to.equal(2n);
    expect(hostResources[2]).to.equal(2n);
    expect(hostResources[3]).to.equal(2n);
    expect(hostResources[4]).to.equal(100n);

    const gcPlayers = await gameCore.getLobbyPlayers(lobbyId);
    expect(gcPlayers).to.deep.equal([host.address, player.address]);

    const hex = await gameCore.getHexTile(lobbyId, "0,0");
    expect(Number(hex[0])).to.equal(0);
    expect(Number(hex[1])).to.equal(0);
    expect(hex[3]).to.equal("0x0000000000000000000000000000000000000000");
    expect(hex[4]).to.equal(false);
  });
});
