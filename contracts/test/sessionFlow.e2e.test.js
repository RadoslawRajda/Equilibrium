const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Session lobby E2E flow", function () {
  it("creates lobby and buys ticket with session policies, then sponsors from lobby pool", async function () {
    const [owner, host, player, recipient, sessionHost, sessionPlayer] = await ethers.getSigners();

    const EntryPoint = await ethers.getContractFactory("EntryPoint");
    const entryPoint = await EntryPoint.deploy();
    await entryPoint.waitForDeployment();

    const SessionForwarder = await ethers.getContractFactory("SessionForwarderActorAuthority");
    const LobbyManager = await ethers.getContractFactory("LobbyManager");

    const sessionForwarder = await SessionForwarder.deploy();
    await sessionForwarder.waitForDeployment();

    const lobbyManager = await LobbyManager.deploy();
    await lobbyManager.waitForDeployment();

    await sessionForwarder.setLobbyManager(await lobbyManager.getAddress());
    await sessionForwarder.setSponsorPool(await lobbyManager.getAddress());
    await lobbyManager.setEntryPoint(await entryPoint.getAddress());
    await lobbyManager.setSessionPolicyRegistry(await sessionForwarder.getAddress());
    await lobbyManager.setSessionSponsorManager(await sessionForwarder.getAddress());

    await lobbyManager
      .connect(host)
      .createLobbyWithSession(
        "Session Arena",
        sessionHost.address,
        ethers.parseEther("0.004"),
        3600,
        ethers.parseEther("0.01"),
        { value: ethers.parseEther("0.05") }
      );

    const hostPolicy = await sessionForwarder.sessionPolicies(sessionHost.address);
    expect(hostPolicy.actor).to.equal(host.address);
    expect(hostPolicy.lobbyId).to.equal(1n);
    expect(hostPolicy.active).to.equal(true);
    expect(await lobbyManager.sessionSponsorPool(1)).to.equal(ethers.parseEther("0.01"));

    await lobbyManager
      .connect(player)
      .buyTicketWithSession(
        1,
        sessionPlayer.address,
        ethers.parseEther("0.003"),
        3600,
        ethers.parseEther("0.005"),
        { value: ethers.parseEther("0.05") }
      );

    const playerPolicy = await sessionForwarder.sessionPolicies(sessionPlayer.address);
    expect(playerPolicy.actor).to.equal(player.address);
    expect(playerPolicy.lobbyId).to.equal(1n);
    expect(playerPolicy.active).to.equal(true);
    expect(await lobbyManager.sessionSponsorPool(1)).to.equal(ethers.parseEther("0.015"));

    const before = await ethers.provider.getBalance(recipient.address);
    await sessionForwarder.sponsorSessionAction(sessionPlayer.address, ethers.parseEther("0.002"), recipient.address);
    const after = await ethers.provider.getBalance(recipient.address);

    expect(after - before).to.equal(ethers.parseEther("0.002"));
    expect(await sessionForwarder.sessionSponsoredWei(sessionPlayer.address)).to.equal(ethers.parseEther("0.002"));
    expect(await lobbyManager.sessionSponsorPool(1)).to.equal(ethers.parseEther("0.013"));
  });
});
