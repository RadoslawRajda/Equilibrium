const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ExperienceStats", function () {
  async function deployFixture() {
    const [owner, updater, p1, p2, outsider] = await ethers.getSigners();
    const ExperienceStats = await ethers.getContractFactory("ExperienceStats");
    const stats = await ExperienceStats.deploy();
    await stats.waitForDeployment();
    await stats.connect(owner).setStatsUpdater(updater.address);
    return { owner, updater, p1, p2, outsider, stats };
  }

  it("awards +10 to winner and +1 to non-winners who finished", async function () {
    const { updater, p1, p2, stats } = await deployFixture();

    await stats
      .connect(updater)
      .recordGameResult(11n, [p1.address, p2.address], p1.address);

    const p1Stats = await stats.playerStats(p1.address);
    const p2Stats = await stats.playerStats(p2.address);

    expect(p1Stats.experiencePoints).to.equal(10n);
    expect(p1Stats.gamesPlayed).to.equal(1n);
    expect(p1Stats.gamesWon).to.equal(1n);

    expect(p2Stats.experiencePoints).to.equal(1n);
    expect(p2Stats.gamesPlayed).to.equal(1n);
    expect(p2Stats.gamesWon).to.equal(0n);
  });

  it("prevents double result recording for one lobby", async function () {
    const { updater, p1, stats } = await deployFixture();

    await stats.connect(updater).recordGameResult(12n, [p1.address], p1.address);
    await expect(
      stats.connect(updater).recordGameResult(12n, [p1.address], p1.address)
    ).to.be.revertedWith("Lobby result already recorded");
  });

  it("deduplicates players and requires winner to belong to players", async function () {
    const { updater, p1, p2, outsider, stats } = await deployFixture();

    await stats
      .connect(updater)
      .recordGameResult(13n, [p1.address, p1.address, p2.address], p2.address);

    const p1Stats = await stats.playerStats(p1.address);
    const p2Stats = await stats.playerStats(p2.address);
    expect(p1Stats.gamesPlayed).to.equal(1n);
    expect(p2Stats.gamesPlayed).to.equal(1n);
    expect(p2Stats.gamesWon).to.equal(1n);

    await expect(
      stats
        .connect(updater)
        .recordGameResult(14n, [p1.address, p2.address], outsider.address)
    ).to.be.revertedWith("Winner must be in players");
  });

  it("applies -1 exit penalty only once per player/lobby and never below zero", async function () {
    const { updater, p1, stats } = await deployFixture();

    await stats.connect(updater).recordLobbyExit(21n, p1.address);
    let p1Stats = await stats.playerStats(p1.address);
    expect(p1Stats.experiencePoints).to.equal(0n);
    expect(p1Stats.gamesLeft).to.equal(1n);

    await stats.connect(updater).recordLobbyExit(21n, p1.address);
    p1Stats = await stats.playerStats(p1.address);
    expect(p1Stats.experiencePoints).to.equal(0n);
    expect(p1Stats.gamesLeft).to.equal(1n);

    await stats.connect(updater).recordGameResult(22n, [p1.address], p1.address);
    await stats.connect(updater).recordLobbyExit(22n, p1.address);
    p1Stats = await stats.playerStats(p1.address);
    expect(p1Stats.experiencePoints).to.equal(9n);
    expect(p1Stats.gamesLeft).to.equal(2n);
  });

  it("does not grant +1 participation to players marked as exited", async function () {
    const { updater, p1, p2, stats } = await deployFixture();

    await stats.connect(updater).recordLobbyExit(23n, p2.address);
    await stats
      .connect(updater)
      .recordGameResult(23n, [p1.address, p2.address], p1.address);

    const p1Stats = await stats.playerStats(p1.address);
    const p2Stats = await stats.playerStats(p2.address);

    expect(p1Stats.experiencePoints).to.equal(10n);
    expect(p1Stats.gamesPlayed).to.equal(1n);
    expect(p2Stats.experiencePoints).to.equal(0n);
    expect(p2Stats.gamesPlayed).to.equal(0n);
    expect(p2Stats.gamesLeft).to.equal(1n);
  });

  it("allows only owner to set updater and only updater to write stats", async function () {
    const { owner, updater, p1, outsider, stats } = await deployFixture();

    await expect(
      stats.connect(outsider).setStatsUpdater(outsider.address)
    ).to.be.revertedWithCustomError(stats, "OwnableUnauthorizedAccount");

    await expect(
      stats.connect(owner).setStatsUpdater(ethers.ZeroAddress)
    ).to.be.revertedWith("Updater address required");

    await expect(
      stats.connect(outsider).recordGameResult(31n, [p1.address], p1.address)
    ).to.be.revertedWith("Only stats updater");

    await expect(
      stats.connect(outsider).recordLobbyExit(31n, p1.address)
    ).to.be.revertedWith("Only stats updater");

    await expect(
      stats.connect(updater).recordGameResult(31n, [p1.address], p1.address)
    ).to.not.be.reverted;
  });
});
