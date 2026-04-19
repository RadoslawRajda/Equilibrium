require("@nomicfoundation/hardhat-toolbox");

const chainId = Number(process.env.CHAIN_ID || 1337);
const sharedMnemonic = process.env.ANVIL_MNEMONIC;
const sharedAccounts = sharedMnemonic
  ? {
      mnemonic: sharedMnemonic,
      path: "m/44'/60'/0'/0/",
      initialIndex: 0,
      count: Number(process.env.HARDHAT_ACCOUNT_COUNT || 12)
    }
  : undefined;

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
      chainId,
      allowUnlimitedContractSize: true
    },
    localhost: {
      url: process.env.GANACHE_HOST_RPC_URL || "http://127.0.0.1:8545",
      chainId,
      accounts: sharedAccounts
    },
    ganache: {
      url: process.env.GANACHE_DOCKER_RPC_URL || "http://ganache:8545",
      chainId,
      accounts: sharedAccounts
    }
  }
};
