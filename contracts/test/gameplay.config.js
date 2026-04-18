const { ethers } = require("hardhat");

module.exports = {
  TICKET_PRICE: ethers.parseEther("1"),
  DEFAULT_MAP_SEED: 123456789n,
  DEFAULT_MAP_RADIUS: 4,
  ZERO_ROUND_SECONDS: 300,
  ROUND_SECONDS: 300
};
