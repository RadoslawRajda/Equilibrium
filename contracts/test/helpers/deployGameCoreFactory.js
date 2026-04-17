const { ethers } = require("hardhat");

/** GameCore links `HexCoords` to stay under the 24kB deploy limit. */
async function getLinkedGameCoreFactory() {
  const Lib = await ethers.getContractFactory("HexCoords");
  const lib = await Lib.deploy();
  await lib.waitForDeployment();
  const hexCoordsAddress = await lib.getAddress();
  return ethers.getContractFactory("GameCore", {
    libraries: {
      HexCoords: hexCoordsAddress
    }
  });
}

module.exports = { getLinkedGameCoreFactory };
