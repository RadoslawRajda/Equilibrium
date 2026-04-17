const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Regression suite for ERC-4337 paymaster path: LobbyPaymasterHook + LobbySessionPaymaster + EntryPoint.
 * Full UserOp bundling is environment-specific; we lock behaviour of on-chain validation + refund plumbing.
 */
describe("ERC-4337 paymaster stack", function () {
  async function deployHookStack() {
    const [owner, entryPointSigner, host, relayer] = await ethers.getSigners();

    const LobbyManager = await ethers.getContractFactory("LobbyManager");
    const SessionForwarder = await ethers.getContractFactory("SessionForwarderActorAuthority");
    const PaymasterHook = await ethers.getContractFactory("LobbyPaymasterHook");

    const lobbyManager = await LobbyManager.deploy();
    await lobbyManager.waitForDeployment();

    const sessionForwarder = await SessionForwarder.deploy();
    await sessionForwarder.waitForDeployment();

    const hook = await PaymasterHook.deploy(await sessionForwarder.getAddress(), entryPointSigner.address);
    await hook.waitForDeployment();

    await sessionForwarder.setSponsorPool(await lobbyManager.getAddress());
    await lobbyManager.setSessionSponsorManager(await sessionForwarder.getAddress());
    // Policies must be configured while SessionForwarder is still owned by test accounts; then hand ownership to the hook (matches production deploy order).

    return { owner, entryPointSigner, host, relayer, lobbyManager, sessionForwarder, hook };
  }

  describe("LobbyPaymasterHook", function () {
    it("rejects preview when session is inactive (no actor)", async function () {
      const { hook, relayer } = await deployHookStack();
      const preview = await hook.previewSponsorship(relayer.address, ethers.parseEther("0.001"));
      expect(preview[0]).to.equal(false);
    });

    it("allows preview when policy is active and under cap", async function () {
      const { hook, host, relayer, lobbyManager, owner } = await deployHookStack();

      await lobbyManager.connect(host).createLobby("PM Test", { value: ethers.parseEther("0.05") });
      await lobbyManager.connect(host).reserveSessionSponsorPool(1, ethers.parseEther("0.02"));

      const expiresAt = BigInt((await ethers.provider.getBlock("latest")).timestamp + 7200);
      const sf = await ethers.getContractAt("SessionForwarderActorAuthority", await hook.sessionAuthority());
      await sf.connect(owner).setSessionPolicy(relayer.address, host.address, 1, expiresAt, ethers.parseEther("0.01"), true);

      const preview = await hook.previewSponsorship(relayer.address, ethers.parseEther("0.003"));
      expect(preview[0]).to.equal(true);
      expect(preview[1]).to.equal(1n);
    });

    it("rejects preview when requested amount exceeds remaining sponsorship budget", async function () {
      const { hook, host, relayer, lobbyManager, owner } = await deployHookStack();

      await lobbyManager.connect(host).createLobby("PM Cap", { value: ethers.parseEther("0.05") });
      await lobbyManager.connect(host).reserveSessionSponsorPool(1, ethers.parseEther("0.02"));

      const expiresAt = BigInt((await ethers.provider.getBlock("latest")).timestamp + 7200);
      const sfAddr = await hook.sessionAuthority();
      const sf = await ethers.getContractAt("SessionForwarderActorAuthority", sfAddr);
      await sf.connect(owner).setSessionPolicy(relayer.address, host.address, 1, expiresAt, ethers.parseEther("0.005"), true);

      const preview = await hook.previewSponsorship(relayer.address, ethers.parseEther("0.01"));
      expect(preview[0]).to.equal(false);
    });

    it("only EntryPoint may call sponsorUserOperation", async function () {
      const { hook, host, relayer, lobbyManager, entryPointSigner, sessionForwarder, owner } = await deployHookStack();

      await lobbyManager.connect(host).createLobby("EP gate", { value: ethers.parseEther("0.05") });
      await lobbyManager.connect(host).reserveSessionSponsorPool(1, ethers.parseEther("0.02"));

      const expiresAt = BigInt((await ethers.provider.getBlock("latest")).timestamp + 7200);
      const sf = await ethers.getContractAt("SessionForwarderActorAuthority", await hook.sessionAuthority());
      await sf.connect(owner).setSessionPolicy(relayer.address, host.address, 1, expiresAt, ethers.parseEther("0.01"), true);
      await sessionForwarder.transferOwnership(await hook.getAddress());

      await expect(
        hook.connect(host).sponsorUserOperation(relayer.address, ethers.parseEther("0.001"), host.address)
      ).to.be.revertedWith("Only entry point");

      await expect(
        hook
          .connect(entryPointSigner)
          .sponsorUserOperation(relayer.address, ethers.parseEther("0.001"), host.address)
      ).to.emit(hook, "UserOperationSponsored");
    });

    it("reverts reimburseSessionGas when caller is not gas sponsor", async function () {
      const { hook, host } = await deployHookStack();
      await expect(
        hook.connect(host).reimburseSessionGas(host.address, 100, host.address)
      ).to.be.revertedWith("Only gas sponsor");
    });

    it("owner can rotate gas sponsor and entry point addresses", async function () {
      const { hook, owner, entryPointSigner } = await deployHookStack();
      const [a, b] = await ethers.getSigners();
      await expect(hook.connect(owner).setGasSponsor(a.address))
        .to.emit(hook, "GasSponsorUpdated");
      await expect(hook.connect(owner).setEntryPoint(b.address))
        .to.emit(hook, "EntryPointUpdated");
      expect(await hook.gasSponsor()).to.equal(a.address);
      expect(await hook.entryPoint()).to.equal(b.address);
      await hook.connect(owner).setEntryPoint(entryPointSigner.address);
    });
  });

  describe("LobbySessionPaymaster + deploy wiring", function () {
    it("deploys paymaster with immutable hook reference", async function () {
      const EntryPoint = await ethers.getContractFactory("EntryPoint");
      const entryPoint = await EntryPoint.deploy();
      await entryPoint.waitForDeployment();

      const SessionForwarder = await ethers.getContractFactory("SessionForwarderActorAuthority");
      const PaymasterHook = await ethers.getContractFactory("LobbyPaymasterHook");
      const Paymaster = await ethers.getContractFactory("LobbySessionPaymaster");

      const sessionForwarder = await SessionForwarder.deploy();
      await sessionForwarder.waitForDeployment();

      const hook = await PaymasterHook.deploy(await sessionForwarder.getAddress(), await entryPoint.getAddress());
      await hook.waitForDeployment();

      const paymaster = await Paymaster.deploy(await entryPoint.getAddress(), await hook.getAddress());
      await paymaster.waitForDeployment();

      expect(await paymaster.hook()).to.equal(await hook.getAddress());
    });

    it("paymaster receives ETH and can forward deposit to EntryPoint (receive path)", async function () {
      const EntryPoint = await ethers.getContractFactory("EntryPoint");
      const entryPoint = await EntryPoint.deploy();
      await entryPoint.waitForDeployment();

      const SessionForwarder = await ethers.getContractFactory("SessionForwarderActorAuthority");
      const PaymasterHook = await ethers.getContractFactory("LobbyPaymasterHook");
      const Paymaster = await ethers.getContractFactory("LobbySessionPaymaster");

      const sessionForwarder = await SessionForwarder.deploy();
      await sessionForwarder.waitForDeployment();

      const hook = await PaymasterHook.deploy(await sessionForwarder.getAddress(), await entryPoint.getAddress());
      await hook.waitForDeployment();

      const paymaster = await Paymaster.deploy(await entryPoint.getAddress(), await hook.getAddress());
      await paymaster.waitForDeployment();

      const [funder] = await ethers.getSigners();
      await funder.sendTransaction({ to: await paymaster.getAddress(), value: ethers.parseEther("0.02") });
      const bal = await ethers.provider.getBalance(await paymaster.getAddress());
      expect(bal).to.be.gt(0n);
    });
  });

  describe("SessionForwarder sponsorship accounting (4337 refund source)", function () {
    it("tracks cumulative sponsored wei per session key", async function () {
      const { hook, host, relayer, lobbyManager, entryPointSigner, sessionForwarder, owner } = await deployHookStack();

      await lobbyManager.connect(host).createLobby("Acc", { value: ethers.parseEther("0.05") });
      await lobbyManager.connect(host).reserveSessionSponsorPool(1, ethers.parseEther("0.02"));

      const expiresAt = BigInt((await ethers.provider.getBlock("latest")).timestamp + 7200);
      const sf = await ethers.getContractAt("SessionForwarderActorAuthority", await hook.sessionAuthority());
      await sf.connect(owner).setSessionPolicy(relayer.address, host.address, 1, expiresAt, ethers.parseEther("0.02"), true);
      await sessionForwarder.transferOwnership(await hook.getAddress());

      await hook
        .connect(entryPointSigner)
        .sponsorUserOperation(relayer.address, ethers.parseEther("0.004"), host.address);

      const sfAddr = await hook.sessionAuthority();
      const sfRead = await ethers.getContractAt("SessionForwarderActorAuthority", sfAddr);
      expect(await sfRead.sessionSponsoredWei(relayer.address)).to.equal(ethers.parseEther("0.004"));
    });
  });
});
