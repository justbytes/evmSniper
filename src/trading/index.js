import { UniswapV2 } from './UniswapV2.js';
import { UniswapV3 } from './UniswapV3.js';
import { chainIdToString } from '../utils/chainIdToString.js';

/**
 * Creates and initializes trading instances for all DEXs in the config
 * @param {Array} config - The JSON config array containing DEX information
 * @returns {Object} Object containing all initialized trading instances
 */
export async function createTradingInstances(config) {
  const instances = {};

  for (const dexConfig of config) {
    const { chain, chain_id, dex, v2, v3 } = dexConfig;

    // Create V2 instance if V2 config exists
    if (v2?.factory && v2?.router) {
      const v2InstanceName = `${dex}${chain}V2`;

      console.log(`Creating ${v2InstanceName} instance...`);

      const v2Instance = new UniswapV2(chain_id, v2.router, v2.factory);

      // Initialize the instance
      await v2Instance.initialize();

      instances[v2InstanceName] = v2Instance;
      console.log(`✅ ${v2InstanceName} initialized successfully`);
    }

    // Create V3 instance if V3 config exists
    if (v3?.factory && v3?.router && v3?.quoter) {
      const v3InstanceName = `${dex}${chain}V3`;

      console.log(`Creating ${v3InstanceName} instance...`);

      const v3Instance = new UniswapV3(chain_id, v3.router, v3.factory, v3.quoter);

      // Initialize the instance
      await v3Instance.initialize();

      instances[v3InstanceName] = v3Instance;
      console.log(`✅ ${v3InstanceName} initialized successfully`);
    }
  }

  return instances;
}

/**
 * Helper function to get the correct trading instance based on token data
 * @param {Object} instances - All trading instances
 * @param {Object} token - Token data containing chain and version info
 * @returns {Object|null} The appropriate trading instance
 */
export function getTradingInstance(instances, token) {
  const { chainId, v3 } = token;

  const chain = chainIdToString(chainId);

  // Determine version
  const version = v3 ? 'V3' : 'V2';

  // Try to find instance by chain name first
  let instanceName = `uniswap${chain}${version}`;

  if (instances[instanceName]) {
    return instances[instanceName];
  }

  // If not found by chain name, try to find by chain ID
  for (const [name, instance] of Object.entries(instances)) {
    if (instance.chainId === chainId || instance.chainId === String(chainId)) {
      if (name.includes(version)) {
        return instance;
      }
    }
  }

  console.warn(
    `No trading instance found for chain: ${chain}, chainId: ${chainId}, version: ${version}`
  );
  return null;
}

/**
 * Gets all available instance names
 * @param {Object} instances
 * @returns {Array<string>}
 */
export function getInstanceNames(instances) {
  return Object.keys(instances);
}

/**
 * Emergency stop all listeners across all instances
 * @param {Object} instances
 */
export async function stopAllInstanceListeners(instances) {
  console.log('🛑 Stopping all listeners across all trading instances...');

  const stopPromises = Object.entries(instances).map(async ([name, instance]) => {
    try {
      await instance.stopAllListeners();
      console.log(`✅ Stopped all listeners for ${name}`);
    } catch (error) {
      console.error(`❌ Failed to stop listeners for ${name}:`, error);
    }
  });

  await Promise.all(stopPromises);
  console.log('🛑 All listeners stopped');
}
