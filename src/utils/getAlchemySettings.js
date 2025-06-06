import dotenv from 'dotenv';
import { Network } from 'alchemy-sdk';

dotenv.config();

/**
 * Contains a switch case that returns the approprate provider config
 * @param {*} chainId
 * @returns provider config settings
 */
export const getAlchemySettings = chainId => {
  switch (chainId) {
    case '1':
      return {
        apiKey: process.env.ALCHEMY_KEY,
        network: Network.ETH_MAINNET,
      };
    case '8453':
      return {
        apiKey: process.env.ALCHEMY_KEY,
        network: Network.BASE_MAINNET,
      };

    default:
      console.log('Unkown chain id');
      return false;
  }
};
