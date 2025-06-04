import fs from "fs";
import path from "path";

const KNOWN_TOKENS_JSON = path.join(__dirname, "../../data/known_tokens.json");
const KNOWN_TOKEN_DATA = fs.readFileSync(KNOWN_TOKENS_JSON);
const KNOWN_TOKENS = JSON.parse(KNOWN_TOKEN_DATA);

/**
 * Checks if the token is in the list of known tokens
 * @param {string} targetAddress
 * @returns
 */
export const isBaseToken = (targetAddress) => {
  for (let i = 0; i < KNOWN_TOKENS.length; i++) {
    let knownAddress = KNOWN_TOKENS[i];
    if (targetAddress.toLowerCase() === knownAddress.toLowerCase()) {
      return true;
    }
  }
  return false;
};

/**
 * Check two tokens to find out which one is the new one
 * @param {string} token0
 * @param {string} token1
 * @returns
 */
export const checkIfTokenIsNew = (token0, token1) => {
  let count = 0;
  let baseToken;
  let newToken;

  // Return true means its a known token
  if (checkList(token0)) {
    count++;
    baseToken = token0;
    newToken = token1;
  }

  // Returning true means its a known token
  if (checkList(token1)) {
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
