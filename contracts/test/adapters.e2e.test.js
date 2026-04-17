const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AA and ERC-8004 adapters", function () {
  it("sponsors a session user operation through paymaster hook", async function () {
    const [owner, host, entryPoint, relayer] = await ethers.getSigners();

    const LobbyManager = await ethers.getContractFactory("LobbyManager");
    const SessionForwarder = await ethers.getContractFactory("SessionForwarderActorAuthority");
    const PaymasterHook = await ethers.getContractFactory("LobbyPaymasterHook");

    const lobbyManager = await LobbyManager.deploy();
    await lobbyManager.waitForDeployment();

    const sessionForwarder = await SessionForwarder.deploy();
    await sessionForwarder.waitForDeployment();

    const paymasterHook = await PaymasterHook.deploy(await sessionForwarder.getAddress(), entryPoint.address);
    await paymasterHook.waitForDeployment();

    await sessionForwarder.setSponsorPool(await lobbyManager.getAddress());
    await lobbyManager.setSessionSponsorManager(await sessionForwarder.getAddress());

    await lobbyManager.connect(host).createLobby("AA Arena", { value: ethers.parseEther("0.05") });
    await lobbyManager.connect(host).reserveSessionSponsorPool(1, ethers.parseEther("0.01"));

    const expiresAt = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
    await sessionForwarder.setSessionPolicy(relayer.address, host.address, 1, expiresAt, ethers.parseEther("0.004"), true);

    await sessionForwarder.transferOwnership(await paymasterHook.getAddress());

    await expect(
      paymasterHook
        .connect(entryPoint)
        .sponsorUserOperation(relayer.address, ethers.parseEther("0.003"), host.address)
    ).to.emit(paymasterHook, "UserOperationSponsored");

    expect(await sessionForwarder.sessionSponsoredWei(relayer.address)).to.equal(ethers.parseEther("0.003"));
    expect(await lobbyManager.sessionSponsorPool(1)).to.equal(ethers.parseEther("0.007"));

    const preview = await paymasterHook.previewSponsorship(relayer.address, ethers.parseEther("0.002"));
    expect(preview[0]).to.equal(false);
  });

  it("relays ERC-8004 agent action into AI game master log", async function () {
    const [owner] = await ethers.getSigners();

    const AIGameMaster = await ethers.getContractFactory("AIGameMaster");
    const Adapter = await ethers.getContractFactory("ERC8004AIGameMasterAdapter");
    const Agent = await ethers.getContractFactory("MockERC8004Agent");

    const gameMaster = await AIGameMaster.deploy();
    await gameMaster.waitForDeployment();

    const agent = await Agent.deploy();
    await agent.waitForDeployment();
    await agent.configureNextAction("quake", '{"severity":2}');

    const adapter = await Adapter.deploy(await gameMaster.getAddress());
    await adapter.waitForDeployment();
    await adapter.setAgent(await agent.getAddress());

    await expect(adapter.relayAgentAction(7, "0x1234")).to.emit(adapter, "AIActionRelayed");

    expect(await gameMaster.eventsCount()).to.equal(1n);
    const entry = await gameMaster.eventsLog(0);
    expect(entry.name).to.equal("quake");
    expect(entry.payload).to.equal('{"severity":2}');
  });
});
