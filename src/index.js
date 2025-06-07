import fs from 'fs';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import { V2TokenPairListener } from './listeners/V2TokenPairListener.js';
import { V3TokenPairListener } from './listeners/V3TokenPairListener.js';
import { WebSocketController } from './server.js';
import { createTradingInstances, stopAllInstanceListeners } from './trading/index.js';

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
  let tradingInstances = null;
  let server = null;
  let wsClient = null;

  try {
    console.log('🚀 Starting EVM Sniper Bot...');

    // Step 1: Create and initialize all trading instances
    console.log('📊 Creating trading instances...');
    tradingInstances = await createTradingInstances(UNISWAP_CONFIG);

    console.log('✅ All trading instances created successfully:');
    Object.keys(tradingInstances).forEach(name => {
      console.log(`   - ${name}`);
    });

    // Step 2: Initialize the websocket server
    console.log('🔌 Starting WebSocket server...');
    server = new WebSocketController(process.env.PORT, tradingInstances);
    await server.startServer();

    // Step 3: Create the client connection
    console.log('🔗 Connecting WebSocket client...');
    wsClient = new WebSocket(`ws://localhost:${process.env.PORT}`);

    // Wait for connection to open
    await new Promise((resolve, reject) => {
      wsClient.on('open', resolve);
      wsClient.on('error', reject);

      // Add timeout to prevent hanging
      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });

    // Step 4: Activate new pairs/pools listeners for each blockchain
    console.log('👂 Activating blockchain listeners...');
    activateListeners(wsClient);

    console.log('🎉 Welcome to the EVM Sniper Bot! All systems operational.');

    // Log available instances for reference
    console.log('\n📋 Available trading instances:');
    Object.keys(tradingInstances).forEach(name => {
      const instance = tradingInstances[name];
      console.log(`   ${name} - Chain ID: ${instance.chainId}`);
    });
  } catch (error) {
    console.error('❌ Error starting the program:', error);

    // Cleanup on error
    if (tradingInstances) {
      console.log('🧹 Cleaning up trading instances...');
      await stopAllInstanceListeners(tradingInstances);
    }

    if (wsClient) {
      wsClient.close();
    }

    if (server) {
      await server.stopServer();
    }

    process.exit(1);
  }
};

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');

  try {
    // Stop all trading instance listeners first
    if (global.tradingInstances) {
      await stopAllInstanceListeners(global.tradingInstances);
    }

    // Then stop the server
    if (global.server) {
      await global.server.stopServer();
    }

    console.log('✅ Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

main();
