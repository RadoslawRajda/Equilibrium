const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const {
  TICKET_PRICE,
  DEFAULT_MAP_SEED,
  DEFAULT_MAP_RADIUS,
  ZERO_ROUND_SECONDS,
  ROUND_SECONDS
} = require("./gameplay.config.js");
const { getLinkedGameCoreFactory } = require("./helpers/deployGameCoreFactory.js");

/** LobbyManager.LobbyStatus */
const LM = { OPEN: 0, ACTIVE: 1, COMPLETED: 2, CANCELLED: 3 };

async function deployLobbyGame() {
  const [deployer, host, player1, player2, outsider] = await ethers.getSigners();
  const LobbyManager = await ethers.getContractFactory("LobbyManager");
  const GameCore = await getLinkedGameCoreFactory();
  const lobbyManager = await LobbyManager.deploy();
  await lobbyManager.waitForDeployment();
  const gameCore = await GameCore.deploy(await lobbyManager.getAddress());
  await gameCore.waitForDeployment();
  await lobbyManager.connect(deployer).setGameCore(await gameCore.getAddress());
  return { deployer, host, player1, player2, outsider, lobbyManager, gameCore };
}

describe("LobbyManager — settlement & sponsor pool", function () {
  describe("distributeSessionSponsorRemainder", function () {
    it("reverts when lobby is still OPEN", async function () {
      const { host, lobbyManager } = await deployLobbyGame();
      await lobbyManager.connect(host).createLobby("open", { value: TICKET_PRICE });
      expect((await lobbyManager.getLobby(1))[3]).to.equal(LM.OPEN);
      await expect(lobbyManager.distributeSessionSponsorRemainder(1)).to.be.revertedWith("Lobby not settled");
    });

    it("reverts when lobby is ACTIVE", async function () {
      const { host, player1, lobbyManager, gameCore } = await deployLobbyGame();
      await lobbyManager.connect(host).createLobby("active", { value: TICKET_PRICE });
      await gameCore.connect(host).bootstrapLobby(1, host.address, DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
      await lobbyManager.connect(player1).buyTicket(1, { value: TICKET_PRICE });
      await gameCore.connect(player1).joinLobby(1);
      await lobbyManager.connect(host).startGame(1);
      await gameCore
        .connect(host)
        .startGame(1, ZERO_ROUND_SECONDS, ROUND_SECONDS, await lobbyManager.getAddress());
      expect((await lobbyManager.getLobby(1))[3]).to.equal(LM.ACTIVE);
      await expect(lobbyManager.distributeSessionSponsorRemainder(1)).to.be.revertedWith("Lobby not settled");
    });

    it("after CANCELLED emits SessionSponsorRefunded and is idempotent on second call", async function () {
      const { host, player1, lobbyManager } = await deployLobbyGame();
      await lobbyManager.connect(host).createLobby("cancel", { value: TICKET_PRICE });
      await lobbyManager.connect(player1).buyTicket(1, { value: TICKET_PRICE });
      await lobbyManager.connect(host).cancelLobby(1);
      expect((await lobbyManager.getLobby(1))[3]).to.equal(LM.CANCELLED);

      await expect(lobbyManager.distributeSessionSponsorRemainder(1))
        .to.emit(lobbyManager, "SessionSponsorRefunded")
        .withArgs(1n, TICKET_PRICE * 2n);

      const h = await lobbyManager.getPlayerBalance(host.address);
      const p = await lobbyManager.getPlayerBalance(player1.address);
      expect(h).to.equal(TICKET_PRICE);
      expect(p).to.equal(TICKET_PRICE);
      expect(await lobbyManager.sessionSponsorPool(1)).to.equal(0n);

      await lobbyManager.distributeSessionSponsorRemainder(1);
      expect(await lobbyManager.getPlayerBalance(host.address)).to.equal(h);
      expect(await lobbyManager.getPlayerBalance(player1.address)).to.equal(p);
    });

    it("splits remainder correctly after partial consume (extra wei to first roster slot)", async function () {
      const { deployer, host, player1, outsider, lobbyManager } = await deployLobbyGame();
      await lobbyManager.connect(deployer).setSessionSponsorManager(deployer.address);

      await lobbyManager.connect(host).createLobby("partial", { value: TICKET_PRICE });
      await lobbyManager.connect(player1).buyTicket(1, { value: TICKET_PRICE });
      await lobbyManager.connect(host).cancelLobby(1);

      const poolBefore = TICKET_PRICE * 2n;
      expect(await lobbyManager.sessionSponsorPool(1)).to.equal(poolBefore);

      await lobbyManager.connect(deployer).consumeSessionSponsorPool(1, 1n, outsider.address);

      const poolRem = poolBefore - 1n;
      const per = poolRem / 2n;
      const rem = poolRem % 2n;
      expect(rem).to.equal(1n);

      await lobbyManager.distributeSessionSponsorRemainder(1);

      expect(await lobbyManager.getPlayerBalance(host.address)).to.equal(per + 1n);
      expect(await lobbyManager.getPlayerBalance(player1.address)).to.equal(per);
      expect(await lobbyManager.sessionSponsorPool(1)).to.equal(0n);
    });
  });

  describe("consumeSessionSponsorPool", function () {
    it("reverts when caller is not sessionSponsorManager", async function () {
      const { host, player1, lobbyManager } = await deployLobbyGame();
      await lobbyManager.connect(host).createLobby("x", { value: TICKET_PRICE });
      await lobbyManager.connect(player1).buyTicket(1, { value: TICKET_PRICE });
      await expect(
        lobbyManager.connect(host).consumeSessionSponsorPool(1, 1n, player1.address)
      ).to.be.revertedWith("Only session sponsor manager");
    });

    it("no-ops when amount is zero (pool unchanged)", async function () {
      const { deployer, host, player1, lobbyManager } = await deployLobbyGame();
      await lobbyManager.connect(deployer).setSessionSponsorManager(deployer.address);
      await lobbyManager.connect(host).createLobby("z", { value: TICKET_PRICE });
      await lobbyManager.connect(player1).buyTicket(1, { value: TICKET_PRICE });
      const pool = await lobbyManager.sessionSponsorPool(1);
      await lobbyManager.connect(deployer).consumeSessionSponsorPool(1, 0n, player1.address);
      expect(await lobbyManager.sessionSponsorPool(1)).to.equal(pool);
    });

    it("transfers at most the remaining pool when amount exceeds balance", async function () {
      const { deployer, host, outsider, lobbyManager } = await deployLobbyGame();
      await lobbyManager.connect(deployer).setSessionSponsorManager(deployer.address);
      await lobbyManager.connect(host).createLobby("cap", { value: TICKET_PRICE });
      const pool = await lobbyManager.sessionSponsorPool(1);
      const before = await ethers.provider.getBalance(outsider.address);
      await lobbyManager.connect(deployer).consumeSessionSponsorPool(1, pool + ethers.parseEther("999"), outsider.address);
      const after = await ethers.provider.getBalance(outsider.address);
      expect(after - before).to.equal(pool);
      expect(await lobbyManager.sessionSponsorPool(1)).to.equal(0n);
    });
  });

  describe("withdraw", function () {
    it("reverts when playerBalance is zero", async function () {
      const { outsider, lobbyManager } = await deployLobbyGame();
      await expect(lobbyManager.connect(outsider).withdraw()).to.be.revertedWith("No balance to withdraw");
    });
  });

  describe("notifyGameSettled", function () {
    it("leaves sessionSponsorPool unchanged until distribute (solo ACTIVE → COMPLETED)", async function () {
      const { host, lobbyManager, gameCore } = await deployLobbyGame();
      await lobbyManager.connect(host).createLobby("solo", { value: TICKET_PRICE });
      await gameCore.connect(host).bootstrapLobby(1, host.address, DEFAULT_MAP_SEED, DEFAULT_MAP_RADIUS);
      await lobbyManager.connect(host).startGame(1);
      await gameCore
        .connect(host)
        .startGame(1, ZERO_ROUND_SECONDS, ROUND_SECONDS, await lobbyManager.getAddress());

      expect((await lobbyManager.getLobby(1))[3]).to.equal(LM.ACTIVE);
      const poolBefore = await lobbyManager.sessionSponsorPool(1);
      expect(poolBefore).to.equal(TICKET_PRICE);

      const gcAddr = await gameCore.getAddress();
      await network.provider.send("hardhat_impersonateAccount", [gcAddr]);
      try {
        await network.provider.send("hardhat_setBalance", [gcAddr, "0x1000000000000000000"]);
        const gcSigner = await ethers.getSigner(gcAddr);
        await lobbyManager.connect(gcSigner).notifyGameSettled(1, host.address);

        expect((await lobbyManager.getLobby(1))[3]).to.equal(LM.COMPLETED);
        expect(await lobbyManager.sessionSponsorPool(1)).to.equal(poolBefore);
        expect(await lobbyManager.getPlayerBalance(host.address)).to.equal(0n);

        await lobbyManager.distributeSessionSponsorRemainder(1);
        expect(await lobbyManager.sessionSponsorPool(1)).to.equal(0n);
        expect(await lobbyManager.getPlayerBalance(host.address)).to.equal(TICKET_PRICE);
      } finally {
        await network.provider.send("hardhat_stopImpersonatingAccount", [gcAddr]).catch(() => {});
      }
    });
  });
});
