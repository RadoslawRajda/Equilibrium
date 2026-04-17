const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const contractNames = [
    "LobbyManager",
    "Ticket",
    "Season",
    "PlayerState",
    "Structures",
    "Voting",
    "AIGameMaster",
    "GameCore"
  ];

  const deployed = {};

  for (const name of contractNames) {
    const Factory = await ethers.getContractFactory(name);
    const contract = await Factory.deploy();
    await contract.waitForDeployment();
    const address = await contract.getAddress();

    const artifact = await hre.artifacts.readArtifact(name);

    deployed[name] = {
      address,
      abi: artifact.abi
    };

    console.log(`${name} deployed at ${address}`);
  }

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
