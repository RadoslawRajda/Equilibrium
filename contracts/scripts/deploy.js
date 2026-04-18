const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

/** Matches viem `entryPoint08Address` — Alto detects v0.8 only for this prefix. */
const CANONICAL_ENTRY_POINT_V08 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
const DETERMINISTIC_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c";
/** Runtime code of Arachnid EIP-2470 CREATE2 singleton (etch on Anvil if missing). */
const DETERMINISTIC_DEPLOYER_CODE =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

/**
 * On Anvil/Foundry: etch deployer + replay official CREATE2 initcode from eth-infinitism v0.8.0.
 * On plain Hardhat: deploy EntryPoint with a normal transaction (bundlers will mis-detect v0.7).
 */
async function resolveEntryPoint(deployer) {
  const { ethers } = hre;
  const provider = ethers.provider;
  const artifact = await hre.artifacts.readArtifact("EntryPoint");

  const existing = await provider.getCode(CANONICAL_ENTRY_POINT_V08);
  if (existing && existing !== "0x") {
    console.log("EntryPoint v0.8 already at canonical address", CANONICAL_ENTRY_POINT_V08);
    return { address: CANONICAL_ENTRY_POINT_V08, abi: artifact.abi };
  }

  try {
    await provider.send("anvil_setCode", [DETERMINISTIC_DEPLOYER, DETERMINISTIC_DEPLOYER_CODE]);
  } catch {
    console.warn(
      "No anvil_setCode — deploying EntryPoint with a regular tx (use Anvil in Docker for canonical 0x433708… / Alto)."
    );
    const Factory = await ethers.getContractFactory("EntryPoint");
    const contract = await Factory.deploy();
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log("EntryPoint deployed at", address);
    return { address, abi: artifact.abi };
  }

  // Salt + initcode; must match mainnet deploy tx to 0x4e59… (e.g. 0xae4eafd1… on Ethereum).
  const createCallPath = path.join(__dirname, "data", "entryPointV08.createcall.hex");
  const createCall = fs.readFileSync(createCallPath, "utf8").trim();
  console.log("Deploying EntryPoint v0.8 at canonical address via CREATE2…");
  const tx = await deployer.sendTransaction({
    to: DETERMINISTIC_DEPLOYER,
    data: createCall,
    gasLimit: 10_000_000n
  });
  await tx.wait();

  const after = await provider.getCode(CANONICAL_ENTRY_POINT_V08);
  if (!after || after === "0x") {
    throw new Error("CREATE2 EntryPoint v0.8 deployment failed (no code at canonical address)");
  }
  console.log("EntryPoint v0.8 at", CANONICAL_ENTRY_POINT_V08);
  return { address: CANONICAL_ENTRY_POINT_V08, abi: artifact.abi };
}

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const deployed = {};
  const ep = await resolveEntryPoint(deployer);
  deployed.EntryPoint = { address: ep.address, abi: ep.abi };
  console.log("Using EntryPoint at", ep.address);

  const hexCoordsLib = await (await ethers.getContractFactory("HexCoords")).deploy();
  await hexCoordsLib.waitForDeployment();
  const hexCoordsAddress = await hexCoordsLib.getAddress();
  console.log("HexCoords library at", hexCoordsAddress);

  const contractNames = [
    "SimpleAccountFactory",
    "DirectActorAuthority",
    "SessionForwarderActorAuthority",
    "LobbyPaymasterHook",
    "LobbySessionPaymaster",
    "LobbyManager",
    "ExperienceStats",
    "Voting",
    "AIGameMaster",
    "ERC8004PlayerAgentRegistry",
    "MockERC8004Agent",
    "ERC8004AIGameMasterAdapter",
    "GameCore"
  ];

  const constructorArgsByName = {
    SimpleAccountFactory: () => [deployed.EntryPoint.address],
    LobbyPaymasterHook: () => [deployed.SessionForwarderActorAuthority.address, deployed.EntryPoint.address],
    LobbySessionPaymaster: () => [deployed.EntryPoint.address, deployed.LobbyPaymasterHook.address],
    ERC8004AIGameMasterAdapter: () => [deployed.AIGameMaster.address],
    GameCore: () => [deployed.LobbyManager.address]
  };

  for (const name of contractNames) {
    const Factory =
      name === "GameCore"
        ? await ethers.getContractFactory(name, { libraries: { HexCoords: hexCoordsAddress } })
        : await ethers.getContractFactory(name);
    const constructorArgsFactory = constructorArgsByName[name];
    const constructorArgs = constructorArgsFactory ? constructorArgsFactory() : [];
    const contract = await Factory.deploy(...constructorArgs);
    await contract.waitForDeployment();
    const address = await contract.getAddress();

    const contractArtifact = await hre.artifacts.readArtifact(name);

    deployed[name] = {
      address,
      abi: contractArtifact.abi
    };

    console.log(`${name} deployed at ${address}`);
  }

  const sessionForwarder = await ethers.getContractAt(
    "SessionForwarderActorAuthority",
    deployed.SessionForwarderActorAuthority.address
  );
  const lobbyPaymasterHook = await ethers.getContractAt("LobbyPaymasterHook", deployed.LobbyPaymasterHook.address);
  const lobbySessionPaymaster = await ethers.getContractAt(
    "LobbySessionPaymaster",
    deployed.LobbySessionPaymaster.address
  );
  const lobbyManager = await ethers.getContractAt("LobbyManager", deployed.LobbyManager.address);
  const experienceStats = await ethers.getContractAt("ExperienceStats", deployed.ExperienceStats.address);
  const gameCore = await ethers.getContractAt("GameCore", deployed.GameCore.address);
  const voting = await ethers.getContractAt("Voting", deployed.Voting.address);
  const aiGameMaster = await ethers.getContractAt("AIGameMaster", deployed.AIGameMaster.address);
  const erc8004PlayerAgentRegistry = await ethers.getContractAt(
    "ERC8004PlayerAgentRegistry",
    deployed.ERC8004PlayerAgentRegistry.address
  );

  await (await sessionForwarder.setSponsorPool(deployed.LobbyManager.address)).wait();
  await (await sessionForwarder.setLobbyManager(deployed.LobbyManager.address)).wait();
  await (await lobbyManager.setEntryPoint(deployed.EntryPoint.address)).wait();
  await (await lobbyManager.setSessionSponsorManager(deployed.SessionForwarderActorAuthority.address)).wait();
  await (await lobbyManager.setSessionPolicyRegistry(deployed.SessionForwarderActorAuthority.address)).wait();
  await (await lobbyPaymasterHook.setGasSponsor(deployed.LobbySessionPaymaster.address)).wait();
  await (await sessionForwarder.transferOwnership(deployed.LobbyPaymasterHook.address)).wait();
  const paymasterDeposit = ethers.parseEther("25");
  const paymasterStake = ethers.parseEther("2");
  await (await lobbySessionPaymaster.deposit({ value: paymasterDeposit })).wait();
  await (await lobbySessionPaymaster.addStake(86400, { value: paymasterStake })).wait();
  await (await lobbyManager.setActorAuthority(deployed.SessionForwarderActorAuthority.address)).wait();
  await (await lobbyManager.setGameCore(deployed.GameCore.address)).wait();
  await (await gameCore.setActorAuthority(deployed.SessionForwarderActorAuthority.address)).wait();
  await (await voting.setActorAuthority(deployed.SessionForwarderActorAuthority.address)).wait();
  await (await aiGameMaster.setActorAuthority(deployed.SessionForwarderActorAuthority.address)).wait();
  await (await experienceStats.setStatsUpdater(deployed.LobbyManager.address)).wait();
  await (await lobbyManager.setExperienceStatsRegistry(deployed.ExperienceStats.address)).wait();
  await (await erc8004PlayerAgentRegistry.setStatsUpdater(deployed.LobbyManager.address)).wait();
  await (await lobbyManager.setAgentStatsRegistry(deployed.ERC8004PlayerAgentRegistry.address)).wait();

  const outputDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outputDir, { recursive: true });

  const payload = {
    chainId: 1337,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: deployed
  };

  fs.writeFileSync(path.join(outputDir, "localhost.json"), JSON.stringify(payload, null, 2));
  console.log("Deploy artifacts saved to deployments/localhost.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
