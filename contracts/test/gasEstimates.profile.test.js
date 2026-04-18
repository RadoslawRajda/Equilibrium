const { expect } = require("chai");
const { ethers } = require("hardhat");
const { TICKET_PRICE } = require("./gameplay.config.js");
const { getLinkedGameCoreFactory } = require("./helpers/deployGameCoreFactory.js");

/**
 * Execution-layer gas only (GameCore / LobbyManager call inside `execute`).
 * Real ERC-4337 UserOp cost on-chain is higher: account validation + paymaster validation + postOp
 * + overhead; bundlers set callGasLimit / verificationGasLimit — use ~1.3–2.5× this number as a
 * pessimistic budget multiplier for `maxCost` / policy planning unless you simulate the full UserOp.
 */
function gasCostWei(executionGas, feeGwei) {
  return BigInt(executionGas) * BigInt(feeGwei) * 10n ** 9n;
}

function formatEth(wei) {
  return ethers.formatEther(wei);
}

/** Typical L1/L2 fee scenarios (integer gwei) */
const FEE_GWEI_SCENARIOS = [0, 1, 10, 30, 100];

describe("Gas profile (estimateGas) — pessimistic planning", function () {
  it("records GameCore.bootstrapLobby gas vs map radius (heaviest cold path)", async function () {
    const LobbyManager = await ethers.getContractFactory("LobbyManager");
    const GameCore = await getLinkedGameCoreFactory();
    const [host] = await ethers.getSigners();
    const seed = 777888999n;

    const radii = [3, 4, 5, 6];
    const gasByRadius = {};

    for (const r of radii) {
      const lm2 = await LobbyManager.deploy();
      await lm2.waitForDeployment();
      const gc2 = await GameCore.deploy(await lm2.getAddress());
      await gc2.waitForDeployment();
      await lm2.setGameCore(await gc2.getAddress());
      await lm2.connect(host).createLobby(`R${r}`, { value: TICKET_PRICE });
      const g = await gc2.connect(host).bootstrapLobby.estimateGas(1n, host.address, seed, r);
      gasByRadius[r] = g;
    }

    // Lazy map: bootstrap no longer materializes every hex; gas should be nearly flat vs radius.
    let minG = gasByRadius[radii[0]];
    let maxG = gasByRadius[radii[0]];
    for (const r of radii) {
      const g = gasByRadius[r];
      if (g < minG) minG = g;
      if (g > maxG) maxG = g;
    }
    expect(maxG - minG).to.be.lt(60_000n);

    const pessimisticGas = gasByRadius[6];
    console.log("\n[bootstrapLobby] estimated gas by radius:", gasByRadius);
    console.log("[bootstrapLobby] pessimistic (r=6) execution gas:", pessimisticGas.toString());

    console.log("\nExecution cost (GameCore only) for bootstrap r=6 at fee gwei:");
    for (const gwei of FEE_GWEI_SCENARIOS) {
      const w = gasCostWei(pessimisticGas, gwei);
      console.log(`  ${gwei} gwei → ${formatEth(w)} ETH`);
    }
  });

  it("compares steady-state txs after game is Running (single player, radius=4)", async function () {
    const LobbyManager = await ethers.getContractFactory("LobbyManager");
    const GameCore = await getLinkedGameCoreFactory();
    const lobbyManager = await LobbyManager.deploy();
    await lobbyManager.waitForDeployment();
    const gameCore = await GameCore.deploy(await lobbyManager.getAddress());
    await gameCore.waitForDeployment();
    await lobbyManager.setGameCore(await gameCore.getAddress());

    const [host] = await ethers.getSigners();
    const seed = 111222333n;
    const radius = 4;

    await lobbyManager.connect(host).createLobby("Play", { value: TICKET_PRICE });
    await gameCore.connect(host).bootstrapLobby(1n, host.address, seed, radius);
    await lobbyManager.connect(host).startGame(1);
    await gameCore.connect(host).startGame(1, 300, 300, await lobbyManager.getAddress());

    const center = "0,0";
    const gPick = await gameCore.connect(host).pickStartingHex.estimateGas(1n, center, 0, 0);
    await gameCore.connect(host).pickStartingHex(1n, center, 0, 0);

    await gameCore.debugSetPlayerResources(1n, host.address, {
      food: 100n,
      wood: 100n,
      stone: 100n,
      ore: 100n,
      energy: 100n
    });

    const gProp = await gameCore.connect(host).createProposal.estimateGas(
      1n,
      "End round early",
      "__END_ROUND__",
      999n
    );
    const gAdv = await gameCore.connect(host).advanceRound.estimateGas(1n, 300n);
    const gBank = await gameCore.connect(host).tradeWithBank.estimateGas(1n, 0, 1);

    console.log("\n[steady-state Running] pickStartingHex:", gPick.toString());
    console.log("[steady-state Running] createProposal __END_ROUND__:", gProp.toString());
    console.log("[steady-state Running] advanceRound:", gAdv.toString());
    console.log("[steady-state Running] tradeWithBank:", gBank.toString());

    let winner = gPick;
    if (gProp > winner) winner = gProp;
    if (gAdv > winner) winner = gAdv;
    if (gBank > winner) winner = gBank;

    console.log("\nMax among sampled steady-state (execution gas):", winner.toString());
    console.log("Cost at 1 gwei:", formatEth(gasCostWei(winner, 1)));
    console.log("Cost at 30 gwei:", formatEth(gasCostWei(winner, 30)));

    expect(gProp).to.be.gt(0n);
    expect(gAdv).to.be.gt(0n);
  });
});
