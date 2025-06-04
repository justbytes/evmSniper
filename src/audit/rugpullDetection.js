import { GoPlus, ErrorCode } from "@goplus/sdk-node";

/**
 * Checks a tokens rug pull capabilities. Check the link below for a detailed look at
 * what is checked and their meanings
 * @dev https://docs.gopluslabs.io/reference/response-details-7
 *
 * @param {string} chainId chain of the token
 * @param {string} address new token address to inspect
 * @returns
 */
export const rugpullDetection = async (chainId, address) => {
  const response = await GoPlus.rugpullDetection(chainId, address, 30);

  // Check if we have an error before continuing
  if (
    response.code != ErrorCode.SUCCESS &&
    response.code != ErrorCode.DATA_PENDING_SYNC
  ) {
    // If we have been rate limited wait 1 seconds
    if (response.code == 4029) {
      console.log("Rate limited, waiting 1 second...");
      await new Promise((resolve) => setTimeout(resolve, 10000));
      return await rugpullDetection(chainId, address);
    }
    // Return false if it was some other kind of error
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
    // console.log("Rugpull detection audit failed on token: ", address);
    return { success: false, results: result };
  }

  // All checks passed
  // console.log("Rugpull detection audit passed on token: ", address);
  return { success: true, results: result };
};
