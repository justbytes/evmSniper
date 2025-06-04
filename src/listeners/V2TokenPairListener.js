const { ethers } = require("ethers");
const { Alchemy, Interface } = require("alchemy-sdk");
const getAlchemySettings = require("../utils/getAlchemySettings");
const checkIfTokenIsNew = require("../utils/newTokenChecker");

// Get contract ABI's
const {
  abi: UniswapV2FactoryABI,
} = require("@uniswap/v2-periphery/build/IUniswapV2Factory.json");

// Get the interface of the ABI
const FACTORY_V2_INTERFACE = new ethers.Interface(UniswapV2FactoryABI);

/**
 * This class is used to create event listeners for any Uniswap v2 fork.
 */
class V2TokenPairListener {
  /**
   * Constructor creates the Alchemy provider based on the given chainId
   * @param {string} factoryAddress - target factory address
   * @param {string} chainId - target blockchain id
   * @param {WebSocket} server - the websocket server that takes the newly created tokens and processes them
   */
  constructor(factoryAddress, chainId, server) {
    this.totalSent = 0;
    this.chainId = chainId;
    this.factoryAddress = factoryAddress;
    this.server = server;

    // Create a provider for the targeted blockchain
    this.provider = new Alchemy(getAlchemySettings(String(chainId)));

    // Start the PairCreated event listener
    this.activateListener();
  }

  /**
   * Activates a listener for a pair that is created on the Uniswap v2 protocol
   */
  activateListener() {
    console.log("************* | Activating V2 listener | *************");
    try {
      // Create a filter for the listener
      const filter = {
        address: this.factoryAddress,
        topics: [FACTORY_V2_INTERFACE.getEvent("PairCreated").topicHash],
      };

      // Start the listener
      this.provider.ws.on(filter, (log) => {
        // When triggered send the log for processing
        this.processEventLog(log).catch((err) => {
          console.log("Error processing event log", err);
        });
      });
    } catch (error) {
      console.error(
        `There was an error activating the ${this.chainId} V2 listener.\n` +
          error
      );
    }
  }

  /**
   * Decoded V2 log data
   * @param {string} log encoded event data
   */
  async processEventLog(log) {
    // Decode the log
    const decodedLog = FACTORY_V2_INTERFACE.parseLog(log);

    // Extract the token0, token1, and pair address from the decoded log
    const { token0, token1, pair } = decodedLog.args;

    console.log("************* | V2 pair detected | *************");
    console.log("");

    let data;

    // Find out which token is new
    const { newToken, baseToken } = checkIfTokenIsNew(token0, token1);

    // If both tokens are known, return
    if (!newToken && !baseToken) {
      console.log(
        "************* | Unable to identify which token is new! | *************"
      );
      return;
    }

    // Create a data object
    data = {
      chainId: this.chainId,
      newTokenAddress: newToken,
      baseTokenAddress: baseToken,
      pairAddress: pair,
      v3: false,
    };

    // Send it to the websocket server
    this.server.send(data);

    // Increment the total sent
    this.totalSent++;
  }
}

module.exports = V2TokenPairListener;
