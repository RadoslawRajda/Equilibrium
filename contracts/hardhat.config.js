require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  networks: {
    hardhat: {
      chainId: 1337
    },
    ganache: {
      url: process.env.GANACHE_RPC_URL || "http://ganache:8545",
      chainId: 1337,
      accounts: {
        mnemonic: "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat",
        path: "m/44'/60'/0'/0/",
        initialIndex: 0,
        count: 12
      }
    }
  }
};
