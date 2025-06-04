import fs from 'fs';

// Load known tokens once at module level
const KNOWN_TOKENS = JSON.parse(
  fs.readFileSync(new URL('../../data/known_tokens.json', import.meta.url), 'utf8')
);

/**
 * Checks if the token is in the list of known tokens
 * @param {string} targetAddress
 * @returns {boolean}
 */
export const isBaseToken = targetAddress => {
  return KNOWN_TOKENS.some(
    knownAddress => targetAddress.toLowerCase() === knownAddress.toLowerCase()
  );
};

/**
 * Check two tokens to find out which one is the new one
 * @param {string} token0
 * @param {string} token1
 * @returns
 */
export const findNewToken = (token0, token1) => {
  let count = 0;
  let baseToken;
  let newToken;

  // Return true means its a known token
  if (isBaseToken(token0)) {
    count++;
    baseToken = token0;
    newToken = token1;
  }

  // Returning true means its a known token
  if (isBaseToken(token1)) {
    count++;
    baseToken = token1;
    newToken = token0;
  }

  // If both tokens are known or if neither token is known return false
  if (count == 0) {
    return { newToken: false, baseToken: false };
  } else if (count === 2) {
    return { newToken: false, baseToken: false };
  }

  return { newToken, baseToken };
};
