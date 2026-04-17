const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ActorAware authorities", function () {
  async function deployHarness() {
    const [owner, alice, bob, sessionKey, forwarder] = await ethers.getSigners();

    const Harness = await ethers.getContractFactory("ActorAwareHarness");
    const Direct = await ethers.getContractFactory("DirectActorAuthority");
    const SessionForwarder = await ethers.getContractFactory("SessionForwarderActorAuthority");

    const harness = await Harness.deploy();
    await harness.waitForDeployment();

    const direct = await Direct.deploy();
    await direct.waitForDeployment();

    const sessionForwarder = await SessionForwarder.deploy();
    await sessionForwarder.waitForDeployment();

    return { owner, alice, bob, sessionKey, forwarder, harness, direct, sessionForwarder };
  }

  it("uses msg.sender when no authority is configured", async function () {
    const { harness, alice } = await deployHarness();
    expect(await harness.connect(alice).resolvedActor()).to.equal(alice.address);
  });

  it("supports the direct authority strategy", async function () {
    const { harness, direct, bob } = await deployHarness();
    await harness.setActorAuthority(await direct.getAddress());
    expect(await harness.connect(bob).resolvedActor()).to.equal(bob.address);
  });

  it("resolves session keys to canonical actors", async function () {
    const { harness, sessionForwarder, alice, sessionKey } = await deployHarness();

    await harness.setActorAuthority(await sessionForwarder.getAddress());
    const latest = await ethers.provider.getBlock("latest");
    const expiresAt = BigInt(latest.timestamp + 3600);
    await sessionForwarder.setSessionPolicy(sessionKey.address, alice.address, 1, expiresAt, ethers.parseEther("0.01"), true);

    expect(await harness.connect(sessionKey).resolvedActor()).to.equal(alice.address);
  });

  it("falls back to caller when session key policy is inactive", async function () {
    const { harness, sessionForwarder, alice, sessionKey } = await deployHarness();

    await harness.setActorAuthority(await sessionForwarder.getAddress());
    const latest = await ethers.provider.getBlock("latest");
    const expiresAt = BigInt(latest.timestamp + 3600);
    await sessionForwarder.setSessionPolicy(sessionKey.address, alice.address, 1, expiresAt, ethers.parseEther("0.01"), false);

    expect(await harness.connect(sessionKey).resolvedActor()).to.equal(sessionKey.address);
  });

  it("resolves actor from trusted forwarder appended calldata", async function () {
    const { harness, sessionForwarder, alice, forwarder } = await deployHarness();

    await harness.setActorAuthority(await sessionForwarder.getAddress());
    await sessionForwarder.setTrustedForwarder(forwarder.address);

    const iface = new ethers.Interface(["function resolvedActor() view returns (address)"]);
    const baseData = iface.encodeFunctionData("resolvedActor", []);
    const data = baseData + alice.address.slice(2);

    const raw = await ethers.provider.call({
      from: forwarder.address,
      to: await harness.getAddress(),
      data
    });

    const [resolved] = iface.decodeFunctionResult("resolvedActor", raw);
    expect(resolved).to.equal(alice.address);
  });

  it("sponsors a session action from lobby pool", async function () {
    const { owner, alice, bob, sessionKey, sessionForwarder } = await deployHarness();

    const LobbyManager = await ethers.getContractFactory("LobbyManager");
    const lobbyManager = await LobbyManager.deploy();
    await lobbyManager.waitForDeployment();

    await lobbyManager.connect(alice).createLobby("Sponsored", { value: ethers.parseEther("5") });
    await lobbyManager.connect(alice).reserveSessionSponsorPool(1, ethers.parseEther("0.01"));

    await sessionForwarder.setSponsorPool(await lobbyManager.getAddress());
    await lobbyManager.setSessionSponsorManager(await sessionForwarder.getAddress());

    const latest = await ethers.provider.getBlock("latest");
    const expiresAt = BigInt(latest.timestamp + 3600);
    await sessionForwarder.setSessionPolicy(sessionKey.address, alice.address, 1, expiresAt, ethers.parseEther("0.004"), true);

    const beforeBalance = await ethers.provider.getBalance(bob.address);
    await sessionForwarder.sponsorSessionAction(sessionKey.address, ethers.parseEther("0.003"), bob.address);
    const afterBalance = await ethers.provider.getBalance(bob.address);

    expect(afterBalance - beforeBalance).to.equal(ethers.parseEther("0.003"));
    expect(await sessionForwarder.sessionSponsoredWei(sessionKey.address)).to.equal(ethers.parseEther("0.003"));
    expect(await lobbyManager.sessionSponsorPool(1)).to.equal(ethers.parseEther("0.007"));
    await expect(
      sessionForwarder.sponsorSessionAction(sessionKey.address, ethers.parseEther("0.002"), bob.address)
    ).to.be.revertedWith("Session sponsor limit exceeded");
  });
});
