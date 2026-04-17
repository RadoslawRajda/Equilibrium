const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ERC8004 player agents", function () {
  it("creates an on-chain ERC8004 identity per controller", async function () {
    const [controller] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ERC8004PlayerAgentRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    await expect(
      registry.connect(controller).createAndRegisterAgent("Aurora", "agent://aurora/11")
    ).to.emit(registry, "AgentRegistered");

    const agent = await registry.getAgentByController(controller.address);
    expect(agent).to.not.equal(ethers.ZeroAddress);

    const agentContract = await ethers.getContractAt("ERC8004PlayerAgentIdentity", agent);
    expect(await agentContract.controller()).to.equal(controller.address);
    expect(await agentContract.agentName()).to.equal("Aurora");
    expect(await agentContract.metadataURI()).to.equal("agent://aurora/11");
  });

  it("tracks played and won games via LobbyManager updates", async function () {
    const [owner, host, player1] = await ethers.getSigners();

    const LobbyManager = await ethers.getContractFactory("LobbyManager");
    const Registry = await ethers.getContractFactory("ERC8004PlayerAgentRegistry");

    const lobbyManager = await LobbyManager.deploy();
    await lobbyManager.waitForDeployment();
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    await registry.connect(owner).setStatsUpdater(await lobbyManager.getAddress());
    await lobbyManager.connect(owner).setAgentStatsRegistry(await registry.getAddress());

    await registry.connect(host).createAndRegisterAgent("HostBot", "agent://host/10");
    await registry.connect(player1).createAndRegisterAgent("Drift", "agent://drift/13");

    const ticketPrice = await lobbyManager.TICKET_PRICE();
    await lobbyManager.connect(host).createLobby("Arena", { value: ticketPrice });
    await lobbyManager.connect(player1).buyTicket(1, { value: ticketPrice });
    await lobbyManager.connect(host).startGame(1);
    await lobbyManager.connect(host).completeGame(1, host.address);

    const hostAgent = await registry.getAgentByController(host.address);
    const p1Agent = await registry.getAgentByController(player1.address);
    const hostStats = await registry.agentStats(hostAgent);
    const p1Stats = await registry.agentStats(p1Agent);

    expect(hostStats.gamesPlayed).to.equal(1n);
    expect(hostStats.gamesWon).to.equal(1n);
    expect(p1Stats.gamesPlayed).to.equal(1n);
    expect(p1Stats.gamesWon).to.equal(0n);
    expect(await registry.lobbyResultRecorded(1)).to.equal(true);
  });

  it("listAgents returns controller, agent, and name", async function () {
    const [a, b] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ERC8004PlayerAgentRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    await registry.connect(a).createAndRegisterAgent("N1", "m1");
    await registry.connect(b).createAndRegisterAgent("N2", "m2");

    const listed = await registry.listAgents(0, 10);
    expect(listed.length).to.equal(2);
    const byController = Object.fromEntries(listed.map((x) => [x.controller, x]));
    expect(byController[a.address].name).to.equal("N1");
    expect(byController[b.address].name).to.equal("N2");
    expect(await registry.getAgentByController(a.address)).to.equal(byController[a.address].agent);
  });

  it("host on-chain invite is visible and cleared when agent buys ticket", async function () {
    const [owner, host, bot] = await ethers.getSigners();
    const LobbyManager = await ethers.getContractFactory("LobbyManager");
    const Registry = await ethers.getContractFactory("ERC8004PlayerAgentRegistry");
    const lobbyManager = await LobbyManager.deploy();
    await lobbyManager.waitForDeployment();
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    await registry.connect(owner).setStatsUpdater(await lobbyManager.getAddress());
    await lobbyManager.connect(owner).setAgentStatsRegistry(await registry.getAddress());

    await registry.connect(bot).createAndRegisterAgent("Bot", "agent://b");

    const ticketPrice = await lobbyManager.TICKET_PRICE();
    await lobbyManager.connect(host).createLobby("L", { value: ticketPrice });

    await expect(lobbyManager.connect(host).inviteAgentToLobby(1, bot.address))
      .to.emit(lobbyManager, "LobbyAgentInvited")
      .withArgs(1, bot.address, host.address);

    expect(await lobbyManager.getLobbyAgentInvite(1, bot.address)).to.equal(true);

    await lobbyManager.connect(bot).buyTicket(1, { value: ticketPrice });
    expect(await lobbyManager.getLobbyAgentInvite(1, bot.address)).to.equal(false);
  });
});
