import fs from 'fs';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import { V2TokenPairListener } from './listeners/V2TokenPairListener.js';
import { V3TokenPairListener } from './listeners/V3TokenPairListener.js';
import { WebSocketController } from './server.js';

dotenv.config();

// Load config once at module level
const UNISWAP_CONFIG = JSON.parse(
  fs.readFileSync(new URL('../data/uniswap.json', import.meta.url), 'utf8')
);

const activateListeners = server => {
  for (const { chain_id: chainId, v2, v3 } of UNISWAP_CONFIG) {
    if (v2?.factory) {
      new V2TokenPairListener(v2.factory, chainId, server);
    }

    if (v3?.factory) {
      new V3TokenPairListener(v3.factory, chainId, server);
    }
  }
};

/**
 * Starts the program by activating listeners on all Uniswap v3 and v2 protocols
 */
const main = async () => {
  try {
    // Initialize the websocket server that will recieve newly created token pools/pairs
    const server = new WebSocketController(process.env.PORT).startServer();

    // Create the client connection
    const wsClient = new WebSocket(`ws://localhost:${process.env.PORT}`);

    // Wait for connection to open
    await new Promise((resolve, reject) => {
      wsClient.on('open', resolve);
      wsClient.on('error', reject);
    });

    // Activate new pairs/pools listeners for each blockchain
    activateListeners(wsClient);

    console.log('Welcome to the EVM Sniper Bot!');
  } catch (error) {
    throw new Error(`There was an error starting the program\n` + error);
  }
};

main();
