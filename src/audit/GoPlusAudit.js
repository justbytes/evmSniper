import GoPlus from "@goplus/sdk-node";

/**
 * @class GoPlusAudit
 * @description This class is used to run the GoPlus audit on the new token
 */
export class GoPlusAudit {
  /**
   * @constructor
   * @description This constructor is used to initialize the GoPlusAudit class
   */
  constructor(app, chainId, newTokenAddress) {
    this.app = app;
    this.chainId = chainId;
    this.newTokenAddress = newTokenAddress;
  }

  /**
   * Checks if the address is malicious
   * @param {string} chainId
   * @param {string} targetAddress
   * @returns {object} malicious results
   */
  async maliciousCheck() {
    // Wait for 1 second if counter is greater than 30
    while (this.app.goPlusCalls >= 30) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("THIS IS AFTER THE MALICIOUS WHILE LOOP");

    try {
      // Get the address security data
      const response = await GoPlus.addressSecurity(
        this.chainId,
        this.newTokenAddress
      );

      console.log("MALISOUS RESULTS", response);

      // Increment the number of audits calls
      this.app.goPlusCalls++;
      return response.result;
    } catch (error) {
      console.log(
        "There was a problem retrieving data from GoPlus address security api call.\n",
        error
      );

      return null;
    }
  }

  /**
   * Runs the GoPlus audit
   * @param {string} chainId
   * @param {string} newTokenAddress
   * @returns {object} audit results
   */
  async main() {
    // Get the malicious results
    const maliciousResults = await this.maliciousCheck(
      this.chainId,
      this.newTokenAddress
    );

    return {
      success: maliciousResults.success,
      data: { ...securityResults.data, ...maliciousResults },
    };
  }
}
