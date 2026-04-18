require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 80
      },
      viaIR: true
    }
  },
  networks: {
    hardhat: {
      chainId: 1337,
      allowUnlimitedContractSize: true
    },
    /** Same mnemonic as docker-compose Anvil — use for deploy from the host to http://127.0.0.1:8545 */
    localhost: {
      url: process.env.GANACHE_RPC_URL || "http://127.0.0.1:8545",
      chainId: 1337,
      accounts: {
        mnemonic: "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat",
        path: "m/44'/60'/0'/0/",
        initialIndex: 0,
        count: 12
      }
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
