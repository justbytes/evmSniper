import { GoPlus, ErrorCode } from "@goplus/sdk-node";

/**
 * Checks a tokens security. Check the link below for a detailed look at
 * what is checked and their meanings
 * @dev https://docs.gopluslabs.io/reference/response-details
 *
 * @param {string} chainId chain of the token
 * @param {string} address new token address to inspect
 * @returns {Object} { success: boolean, results: Object|null }
 */
export const tokenSecurity = async (chainId, address) => {
  const response = await GoPlus.tokenSecurity(chainId, [address], 30);

  // Check if we have an error before continuing
  if (
    response.code != ErrorCode.SUCCESS &&
    response.code != ErrorCode.DATA_PENDING_SYNC
  ) {
    // If we have been rate limited wait 10 seconds
    if (response.code == 4029) {
      console.log("Rate limited, waiting 10 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 10000));
      return await tokenSecurity(chainId, address);
    }
    // Return false if it was some other kind of error
    console.error(
      "There was an error when running the GoPlus tokenSecurity function\n",
      response
    );
    return { success: false, results: null };
  }

  // Process the security audit results
  const result = response.result;

  // Check if we have no data for this token (empty result object)
  if (!result || Object.keys(result).length === 0) {
    // console.log("No security data available for token:", address);
    return { success: false, results: null };
  }

  // Get the token data (result is keyed by address)
  const tokenData = result[address.toLowerCase()];

  if (!tokenData) {
    // console.log("No security data found for token:", address);
    return { success: false, results: null };
  }

  // Critical security checks - any of these being "1" indicates high risk
  const criticalChecks = [
    tokenData.is_honeypot === "1", // Token is a honeypot
    tokenData.honeypot_with_same_creator === "1", // Creator has made honeypots before
    tokenData.is_blacklisted === "1", // Token is blacklisted
    tokenData.selfdestruct === "1", // Has selfdestruct capability
    tokenData.external_call === "1", // Makes external calls (risky)
    tokenData.cannot_buy === "1", // Cannot buy the token
    tokenData.cannot_sell_all === "1", // Cannot sell all tokens
    tokenData.transfer_pausable === "1", // Transfers can be paused
    tokenData.trading_cooldown === "1", // Has trading cooldown
  ];

  // Owner-related security checks
  const ownerChecks = [
    tokenData.hidden_owner === "1", // Owner is hidden
    tokenData.can_take_back_ownership === "1", // Can take back ownership
    parseFloat(tokenData.owner_percent || 0) > 10, // Owner holds >10% of tokens
    parseFloat(tokenData.creator_percent || 0) > 10, // Creator holds >10% of tokens
  ];

  // Tax and slippage checks (high taxes or modifiable slippage are concerning)
  const taxSlippageChecks = [
    parseFloat(tokenData.buy_tax || 0) > 10, // Buy tax > 10%
    parseFloat(tokenData.sell_tax || 0) > 10, // Sell tax > 10%
    tokenData.slippage_modifiable === "1", // Slippage can be modified
    tokenData.personal_slippage_modifiable === "1", // Personal slippage modifiable
  ];

  // Anti-whale and mint checks
  const additionalChecks = [
    tokenData.is_mintable === "1", // Token can be minted (inflation risk)
    tokenData.anti_whale_modifiable === "1", // Anti-whale rules can be modified
  ];

  // Proxy and open source checks
  const contractChecks = [
    tokenData.is_proxy === "1", // Is a proxy contract (higher risk)
    tokenData.is_open_source === "0", // Contract is not open source
  ];

  // DEX and liquidity checks
  const liquidityChecks = [
    tokenData.is_in_dex === "0", // Not listed on any DEX
    parseInt(tokenData.lp_holder_count || 0) === 0, // No LP holders
    parseFloat(tokenData.lp_total_supply || 0) === 0, // No liquidity
  ];

  // Owner address checks (concerning if owned by EOA or unknown contract)
  const ownerAddressChecks = [
    tokenData.owner_address &&
      tokenData.owner_address !==
        "0x0000000000000000000000000000000000000000" &&
      tokenData.owner_address.length === 42, // Has an active owner (not burned)
  ];

  // If any critical, owner, tax, additional, contract, liquidity, or owner address checks fail, return unsuccessful
  if (
    criticalChecks.some((check) => check) ||
    ownerChecks.some((check) => check) ||
    taxSlippageChecks.some((check) => check) ||
    additionalChecks.some((check) => check) ||
    contractChecks.some((check) => check) ||
    liquidityChecks.some((check) => check) ||
    ownerAddressChecks.some((check) => check)
  ) {
    // console.log("Token security audit failed on token:", address);
    // console.log("Failed checks:", {
    //   critical: criticalChecks.some((check) => check),
    //   owner: ownerChecks.some((check) => check),
    //   taxSlippage: taxSlippageChecks.some((check) => check),
    //   additional: additionalChecks.some((check) => check),
    //   contract: contractChecks.some((check) => check),
    //   liquidity: liquidityChecks.some((check) => check),
    //   ownerAddress: ownerAddressChecks.some((check) => check),
    // });
    return { success: false, results: tokenData };
  }

  // All checks passed
  return { success: true, results: tokenData };
};
