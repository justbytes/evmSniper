import { GoPlus, ErrorCode } from "@goplus/sdk-node";
import { RateLimiter } from "./RateLimiter.js";

// Create a shared rate limiter instance for all GoPlus API calls
export const rateLimiter = new RateLimiter(30, 60000); // 30 calls per minute

/**
 * Internal function to make GoPlus API calls with rate limiting
 * @param {Function} apiFunction - The GoPlus API function to call
 * @param {...any} args - Arguments for the API function
 * @returns {Promise} API response
 */
async function makeGoPlusCall(apiFunction, ...args) {
  const maxRetries = 5;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      // Use rate limiter to execute the call
      const response = await rateLimiter.executeWithRateLimit(
        apiFunction,
        ...args
      );

      // Handle rate limiting response
      if (response.code === 4029) {
        const retryAfter = response.retry_after || 60; // Default to 60 seconds if not provided
        rateLimiter.handleRateLimit(retryAfter);

        // console.log(
        //   `Rate limited (429). Retry attempt ${retryCount + 1}/${maxRetries}`
        // );
        retryCount++;

        if (retryCount < maxRetries) {
          // Wait for the rate limiter before retrying
          const waitTime = rateLimiter.getWaitTime();
          if (waitTime > 0) {
            // console.log(`Waiting ${waitTime}ms before retry...`);
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
          continue;
        }
      }

      return response;
    } catch (error) {
      console.error(`API call failed (attempt ${retryCount + 1}):`, error);

      if (retryCount === maxRetries - 1) {
        throw error;
      }

      retryCount++;
      await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
    }
  }
}

/**
 * Checks a tokens rug pull capabilities with rate limiting
 * @param {string} chainId chain of the token
 * @param {string} address new token address to inspect
 * @returns {Object} { success: boolean, results: Object|null }
 */
export const rugpullDetection = async (chainId, address) => {
  try {
    const response = await makeGoPlusCall(
      GoPlus.rugpullDetection,
      chainId,
      address,
      30
    );

    // Check if we have an error before continuing
    if (
      response.code !== ErrorCode.SUCCESS &&
      response.code !== ErrorCode.DATA_PENDING_SYNC
    ) {
      console.error(
        "There was an error when running the GoPlus rugpullDetection function\n",
        response
      );
      return { success: false, results: null };
    }

    // Process the security audit results
    const result = response.result;

    // Check for malicious indicators - any of these being "1" indicates potential risk
    const securityChecks = [
      result.privilege_withdraw === "1", // Can privileged withdraw
      result.withdraw_missing === "1", // Missing withdraw function
      result.blacklist === "1", // Has blacklist functionality
      result.selfdestruct === "1", // Has selfdestruct capability
      result.is_proxy === "1", // Is a proxy contract (higher risk)
      result.approval_abuse === "1", // Can abuse approvals
    ];

    // Additional checks for concerning owner situations
    const ownerChecks = [
      result.owner?.owner_type === "contract" &&
        result.owner?.owner_address !==
          "0x0000000000000000000000000000000000000000", // Owned by contract (not blackhole)
      result.owner?.owner_type === "eoa", // Owned by externally owned account
    ];

    // Check if contract is not open source (concerning)
    const openSourceCheck = result.is_open_source === "0";

    // If any security check fails, return unsuccessful
    if (
      securityChecks.some((check) => check) ||
      ownerChecks.some((check) => check) ||
      openSourceCheck
    ) {
      return { success: false, results: result };
    }

    // All checks passed
    return { success: true, results: result };
  } catch (error) {
    console.error("Error in rugpullDetection:", error);
    return { success: false, results: null };
  }
};

/**
 * Checks a tokens security with rate limiting
 * @param {string} chainId chain of the token
 * @param {string} address new token address to inspect
 * @returns {Object} { success: boolean, results: Object|null }
 */
export const tokenSecurity = async (chainId, address) => {
  try {
    const response = await makeGoPlusCall(
      GoPlus.tokenSecurity,
      chainId,
      [address],
      30
    );

    // Check if we have an error before continuing
    if (
      response.code !== ErrorCode.SUCCESS &&
      response.code !== ErrorCode.DATA_PENDING_SYNC
    ) {
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
      return { success: false, results: null };
    }

    // Get the token data (result is keyed by address)
    const tokenData = result[address.toLowerCase()];

    if (!tokenData) {
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

    // If any checks fail, return unsuccessful
    if (
      criticalChecks.some((check) => check) ||
      ownerChecks.some((check) => check) ||
      taxSlippageChecks.some((check) => check) ||
      additionalChecks.some((check) => check) ||
      contractChecks.some((check) => check) ||
      liquidityChecks.some((check) => check) ||
      ownerAddressChecks.some((check) => check)
    ) {
      return { success: false, results: tokenData };
    }

    // All checks passed
    return { success: true, results: tokenData };
  } catch (error) {
    console.error("Error in tokenSecurity:", error);
    return { success: false, results: null };
  }
};
