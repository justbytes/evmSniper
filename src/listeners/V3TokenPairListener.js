import { ethers } from 'ethers';
import { Alchemy } from 'alchemy-sdk';
import { getAlchemySettings } from '../utils/getAlchemySettings.js';
import { findNewToken } from '../utils/newTokenChecker.js';

import  UniswapV3Factory from '@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json'  with { type: 'json' };
const {abi: UniswapV3FactoryABI} = UniswapV3Factory

// Get the interface of the ABI
const FACTORY_V3_INTERFACE = new ethers.Interface(UniswapV3FactoryABI);

/**
 * This class is used to create event listeners for any Uniswap v3 fork.
 */
export class V3TokenPairListener {
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
   * Activates a listener for a pair that is created on the Uniswap v3 protocol
   */
  activateListener() {
    console.log('************* | Activating V3 listener | *************');
    try {
      // Filter for PoolCreated events indicating a new pool
      const filter = {
        address: this.factoryAddress,
        topics: [FACTORY_V3_INTERFACE.getEvent('PoolCreated').topicHash],
      };

      // Start the listener
      this.provider.ws.on(filter, log => {
        // When triggered send the log for processing
        this.processEventLog(log);
      });
    } catch (error) {
      console.error(`There was an error activating the ${this.chainId} V3 listener.\n` + error);
    }
  }

  /**
   * Decoded v3 log data
   * @param {*} log encoded event data
   */
  async processEventLog(log) {
    const decodedLog = FACTORY_V3_INTERFACE.parseLog(log);

    const { token0, token1, fee, tickSpacing, pool } = decodedLog.args;

    // console.log("DECODED LOG: ", this.chainId, token0, token1, pool, fee);


    // console.log('************* | V3 pair detected | *************');
    // console.log('');

    let data;

    // Find out which token is new
    const { newToken, baseToken } = findNewToken(token0, token1);

    // console.log("NewToken ", newToken);
    // console.log("BaseToken ", baseToken);



    // If both tokens are known, return
    if (!newToken && !baseToken) {
      // console.log('************* | Unable to identify which token is new! | *************');
      return;
    }

    // Create a data object
    data = {
      chainId: this.chainId,
      newTokenAddress: newToken,
      baseTokenAddress: baseToken,
      pairAddress: pool,
      v3: true,
      fee: fee.toString(),
    };

    // Send it to the server
    this.server.send(JSON.stringify({ action: 'audit', data: data }));

    // Increment the total sent
    this.totalSent++;
  }
}
