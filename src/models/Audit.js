const GoPlusAudit = require("./audits/GoPlusAudit");
const MythrilAudit = require("./audits/MythrilAudit");

/**
 * Runs the GoPlus and Mythril audits and returns the results
 * @class Audit
 * @description This class is used to run the audits on the new token
 */
class Audit {
  /**
   * Constructor for the Audit class
   * @param {App} app - The main app instance
   */
  constructor(app) {
    this.app = app;
    this.goPlusCalls = 0;
    this.goPlusQueue = [];
    this.goPlusInterval = null;

    // Keeps track of the running audits
    this.goPlusRunning = new Map();
  }

  /**
   * Runs the GoPlus audit
   * @param {string} chainId
   * @param {string} newTokenAddress
   * @returns
   */
  async goPlusAudit(chainId, newTokenAddress) {
    // GoPlus Audit
    const results = await GoPlusAudit(this, chainId, newTokenAddress);

    return {
      success: results.success,
      data: { ...results },
    };
  }

  /**
   * Adds a new token to the audit queue
   * @param {DodoEgg} dodoEgg
   */
  add(data) {
    // Create an object to store the audit data
    const dodo = {
      id: data.id,
      chainId: data.chainId,
      newTokenAddress: data.newTokenAddress,
      goPlusResults: null,
      running: false,
    };

    // Add the audit to the GoPlus queue
    this.goPlusQueue.push(dodo);
  }

  /**
   * Stops the Mythril audit queue
   */
  stop() {
    clearInterval(this.goPlusInterval);
    clearInterval(this.mythrilInterval);
    this.goPlusInterval = null;
    this.mythrilInterval = null;
  }

  /**
   * Starts the Mythril audit queue
   */
  start() {
    console.log("************* |   Starting Audit Queue    | *************");

    /**
     * Begins the GoPlus Audit Interval which runs a check every second to see
     * if we can run a go plus audit. If the audit comes back with a success,
     * it will be added to the Mythril Audit Queue. If not it will return to the app
     */
    this.goPlusInterval = setInterval(async () => {
      // Check if the queue is empty
      if (this.goPlusQueue.length === 0) {
        return;
      }

      // If the number of audits is greater than 30, wait for 1 minute and reset the counter
      while (this.goPlusCalls >= 30) {
        await new Promise((resolve) => setTimeout(resolve, 60000)); // 1 minute
        this.goPlusCalls = 0;
      }

      // Look for the first non-running item in the queue
      const index = this.goPlusQueue.findIndex(
        (dodo) => !this.goPlusRunning.has(dodo.id)
      );
      if (index === -1) return; // All items are running

      // Get the dodo from the queue
      const dodo = this.goPlusQueue[index];

      // Add the dodo to the running audits
      this.goPlusRunning.add(dodo.id);

      // Process the audit asynchronously
      this.processGoPlusAudit(dodo).catch(console.error);
    }, 1000); // 1 second
  }

  /**
   * Processes the GoPlus audit
   * @param {DodoEgg} dodo
   */
  async processGoPlusAudit(dodo) {
    try {
      // Run the audit
      const auditResults = await this.goPlusAudit(
        dodo.chainId,
        dodo.newTokenAddress
      );

      // If the audit was successful, add it to the Mythril Queue
      if (auditResults.success) {
        dodo.goPlusResults = auditResults.data;
        this.mythrilQueue.push(dodo);
      } else {
        // If the audit was not successful, send the results to the app
        const results = {
          success: auditResults.success,
          goPlusAudit: auditResults.data,
          mythrilAudit: null,
          timestamp: new Date().toISOString(),
        };

        // Send the results to the app
        this.app.processAudit(dodo.id, results);
      }

      // Remove the dodo from the GoPlus Queue
      this.goPlusQueue = this.goPlusQueue.filter((item) => item.id !== dodo.id);
    } finally {
      // Remove the dodo from the running audits
      this.goPlusRunning.delete(dodo.id);
    }
  }
}

module.exports = Audit;
