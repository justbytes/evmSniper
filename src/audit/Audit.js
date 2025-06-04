import GoPlusAudit from './GoPlusAudit.js';

/**
 * Runs the GoPlus and Mythril audits and returns the results
 * @class Audit
 * @description This class is used to run the audits on the new token
 */
export class Audit {
  /**
   * Constructor for the Audit class
   * @param {App} app - The main app instance
   */
  constructor(server) {
    this.server = server;
    this.goPlusCalls = 0;
    this.goPlusQueue = [];
    this.goPlusInterval = null;
  }

  /**
   * Starts the Mythril audit queue
   */
  start() {
    console.log('************* |   Starting Audit Queue    | *************');

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
        await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute
        this.goPlusCalls = 0;
      }

      // Look for the first non-running item in the queue
      const index = this.goPlusQueue.findIndex(
        newToken => !this.goPlusRunning.has(newToken.newTokenAddress)
      );
      if (index === -1) return; // All items are running

      // Get the newToken from the queue
      const newToken = this.goPlusQueue[index];

      // Process the audit asynchronously
      this.runGoPlusAudit(newToken).catch(console.error);
    }, 1000); // 1 second
  }

  /**
   * Stops the Mythril audit queue
   */
  stop() {
    clearInterval(this.goPlusInterval);
    this.goPlusInterval = null;
  }

  /**
   * Adds a new token to the audit queue
   * @param {*} data of a new token
   */
  addToQueue(data) {
    this.goPlusQueue.push(data);
  }

  /**
   * Processes the GoPlus audit
   * @param {*} newToken data
   */
  async runGoPlusAudit(newToken) {
    try {
      // Run the audit
      const results = await new GoPlusAudit(this, chainId, newTokenAddress).main();

      // If the audit was unsuccessful return
      if (!results.success) {
        // Remove the newToken from the GoPlus Queue
        this.goPlusQueue = this.goPlusQueue.filter(
          item => item.newTokenAddress !== newToken.newTokenAddress
        );
        return;
      }

      console.log('');
      console.log('************* |   AUDIT SUCCESS   | *************');
      console.log('');

      // Add the audit results to the newToken object
      newToken.auditResults = results.data;
      this.server.send(JSON.stringify({ action: 'trade', data: newToken }));
      JSON.stringify({ action: 'audit', data: data });
      // Remove the newToken from the GoPlus Queue
      this.goPlusQueue = this.goPlusQueue.filter(
        item => item.newTokenAddress !== newToken.newTokenAddress
      );
    } catch {
      console.error('There was an error running go plus audit on: ', newToken.newTokenAddress);
    }
  }
}
