import { GoPlusAudit } from './GoPlusAudit.js';

/**
 * Runs the GoPlus and Mythril audits and returns the results
 * @class Audit
 * @description This class is used to run the audits on the new token
 */
export class Audit {
  /**
   * Constructor for the Audit class
   * @param {WebsocketServer} server - The main app instance
   */
  constructor(server) {
    this.server = server;
    this.goPlusCalls = 0;
    this.auditQueue = [];
    this.goPlusInterval = null;
  }

  /**
   * Get the current queue size
   */
  get size() {
    return this.auditQueue.length;
  }

  /**
   * Starts the Mythril audit queue
   */
  start() {
    console.log('************* |   Starting Audit Queue    | *************');

    this.goPlusInterval = setInterval(async () => {
      // Check if the queue is empty
      if (this.auditQueue.length === 0) {
        return;
      }

      // If the number of audits is greater than 30, wait for 1 minute and reset the counter
      if (this.goPlusCalls >= 30) {
        console.log('Rate limit reached, waiting 1 minute...');
        await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute
        this.goPlusCalls = 0;
      }

      // Get the first token from the queue
      const newToken = this.auditQueue.shift();

      // Process the audit asynchronously
      this.runGoPlusAudit(newToken);
    }, 1000); // 1 second

    return this;
  }

  /**
   * Stops audit queue
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
    console.log('Data to queue: ', data);

    this.auditQueue.push(data);
    console.log('Queue size is now:', this.auditQueue.length);
  }

  /**
   * Processes the GoPlus audit
   * @param {*} newToken data
   */
  async runGoPlusAudit(newToken) {
    console.log('*** Starting GoPlus audit for:', newToken.newTokenAddress);

    try {
      // Increment the call counter
      this.goPlusCalls++;

      // Run the audit
      const results = await new GoPlusAudit(
        this,
        newToken.chainId,
        newToken.newTokenAddress
      ).main();

      console.log('GoPlus audit completed. Success:', results.success);

      // If the audit was unsuccessful return
      if (!results.success) {
        console.log('Audit failed for token:', newToken.newTokenAddress);
        return;
      }

      console.log('');
      console.log('************* |   AUDIT SUCCESS   | *************');
      console.log('Token:', newToken.newTokenAddress);
      console.log('');

      // Add the audit results to the newToken object
      newToken.auditResults = results.data;

      // Send to server using broadcast instead of send
      this.server.send(JSON.stringify({ action: 'trade', data: newToken }));
    } catch (error) {
      console.error(
        'There was an error running go plus audit on: ',
        newToken.newTokenAddress,
        error
      );
    }
  }
}
