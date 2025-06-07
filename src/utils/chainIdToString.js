/**
 * Gets the name of the chain using the chain id
 */
export const chainIdToString = chainId => {
  switch (chainId) {
    case '8453':
      return 'Base';
    case '1':
      return 'Ethereum';
    default:
      console.error('Unkown chain id coming from chainIdToString()');
      return null;
  }
};
