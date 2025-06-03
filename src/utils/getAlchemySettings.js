require("dotenv").config({ path: "../.env" });
const { Network } = require("alchemy-sdk");

/**
 * Contains a switch case that returns the approprate provider config
 * @param {*} chainId
 * @returns provider config settings
 */
const getAlchemySettings = (chainId) => {
  switch (chainId) {
    case "1":
      return {
        apiKey: process.env.ALCHEMY_KEY,
        network: Network.ETH_MAINNET,
      };
    case "8453":
      return {
        apiKey: process.env.ALCHEMY_KEY,
        network: Network.BASE_MAINNET,
      };

    default:
      console.log("Unkown chain id");
      return false;
  }
};

module.exports = getAlchemySettings;
