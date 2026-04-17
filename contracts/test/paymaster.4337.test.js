const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Policy cap on cumulative sponsorship (wei) matching LobbyManager + createLobbyWithSession / buyTicketWithSession
 * when maxSponsoredWei is 0 (contract uses 20% of ticket price).
 */
async function sessionPolicyMaxWei(lobbyManager) {
  const tp = await lobbyManager.TICKET_PRICE();
  const bps = await lobbyManager.SESSION_SPONSOR_SHARE_BPS();
  return (tp * bps) / 10000n;
}

/**
 * How many equal-cost UserOps fit in policyMax (integer division; same logic as cumulative sessionSponsoredWei).
 */
function txCountAtAvgCostWei(policyMaxWei, avgCostWeiPerTx) {
  if (avgCostWeiPerTx === 0n) return 0n;
  return policyMaxWei / avgCostWeiPerTx;
}

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

      await lobbyManager.connect(host).createLobby("PM Test", { value: ethers.parseEther("5") });
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

      await lobbyManager.connect(host).createLobby("PM Cap", { value: ethers.parseEther("5") });
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

      await lobbyManager.connect(host).createLobby("EP gate", { value: ethers.parseEther("5") });
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

  describe("Sponsorship limit vs transaction count (simulation)", function () {
    it("derives policy cap from LobbyManager (20% of ticket) and estimates tx count at average cost", async function () {
      const LobbyManager = await ethers.getContractFactory("LobbyManager");
      const lm = await LobbyManager.deploy();
      await lm.waitForDeployment();

      const policyMax = await sessionPolicyMaxWei(lm);
      expect(policyMax).to.equal(ethers.parseEther("1"));

      const avgLow = ethers.parseEther("0.0004");
      const avgMid = ethers.parseEther("0.002");
      const avgHigh = ethers.parseEther("0.01");

      expect(txCountAtAvgCostWei(policyMax, avgLow)).to.equal(2500n);
      expect(txCountAtAvgCostWei(policyMax, avgMid)).to.equal(500n);
      expect(txCountAtAvgCostWei(policyMax, avgHigh)).to.equal(100n);
    });

    it("simulates sequential sponsorUserOperation until Session sponsor limit exceeded", async function () {
      const { hook, host, relayer, lobbyManager, entryPointSigner, sessionForwarder, owner } = await deployHookStack();

      await lobbyManager.connect(host).createLobby("Tx sim", { value: ethers.parseEther("5") });

      const policyMax = await sessionPolicyMaxWei(lobbyManager);
      const costPerTx = ethers.parseEther("0.1");
      const expectedOk = txCountAtAvgCostWei(policyMax, costPerTx);
      expect(expectedOk).to.equal(10n);

      await lobbyManager.connect(host).reserveSessionSponsorPool(1, policyMax);

      const expiresAt = BigInt((await ethers.provider.getBlock("latest")).timestamp + 7200);
      const sf = await ethers.getContractAt("SessionForwarderActorAuthority", await hook.sessionAuthority());
      await sf.connect(owner).setSessionPolicy(relayer.address, host.address, 1, expiresAt, policyMax, true);
      await sessionForwarder.transferOwnership(await hook.getAddress());

      const recipient = host.address;
      for (let i = 0; i < Number(expectedOk); i++) {
        await hook.connect(entryPointSigner).sponsorUserOperation(relayer.address, costPerTx, recipient);
        const preview = await hook.previewSponsorship(relayer.address, costPerTx);
        const remainingAfter = policyMax - costPerTx * BigInt(i + 1);
        expect(preview[3]).to.equal(remainingAfter);
      }

      await expect(
        hook.connect(entryPointSigner).sponsorUserOperation(relayer.address, costPerTx, recipient)
      ).to.be.revertedWith("Session sponsor limit exceeded");

      const previewExceed = await hook.previewSponsorship(relayer.address, 1n);
      expect(previewExceed[0]).to.equal(false);
    });

    it("previewSponsorship matches remaining budget after partial spend (same model as paymaster validate)", async function () {
      const { hook, host, relayer, lobbyManager, entryPointSigner, sessionForwarder, owner } = await deployHookStack();

      await lobbyManager.connect(host).createLobby("Preview sim", { value: ethers.parseEther("5") });
      const policyMax = await sessionPolicyMaxWei(lobbyManager);
      await lobbyManager.connect(host).reserveSessionSponsorPool(1, policyMax);

      const expiresAt = BigInt((await ethers.provider.getBlock("latest")).timestamp + 7200);
      const sf = await ethers.getContractAt("SessionForwarderActorAuthority", await hook.sessionAuthority());
      await sf.connect(owner).setSessionPolicy(relayer.address, host.address, 1, expiresAt, policyMax, true);
      await sessionForwarder.transferOwnership(await hook.getAddress());

      const chunk = ethers.parseEther("0.002");
      const n = 100;
      for (let i = 0; i < n; i++) {
        await hook.connect(entryPointSigner).sponsorUserOperation(relayer.address, chunk, host.address);
      }
      const spent = chunk * BigInt(n);
      const remaining = policyMax - spent;
      const p = await hook.previewSponsorship(relayer.address, chunk);
      expect(p[0]).to.equal(true);
      expect(p[3]).to.equal(remaining);

      const oneTooMany = remaining + 1n;
      const pReject = await hook.previewSponsorship(relayer.address, oneTooMany);
      expect(pReject[0]).to.equal(false);
    });
  });

  describe("SessionForwarder sponsorship accounting (4337 refund source)", function () {
    it("tracks cumulative sponsored wei per session key", async function () {
      const { hook, host, relayer, lobbyManager, entryPointSigner, sessionForwarder, owner } = await deployHookStack();

      await lobbyManager.connect(host).createLobby("Acc", { value: ethers.parseEther("5") });
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
