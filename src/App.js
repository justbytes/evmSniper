import WebSocket from 'ws';

export class App {
  // Create a map to store the dodoEggs
  newTokens = new Map();
  wss;
  auditCall;
  server;
  /**
   * Constructor for the App class
   */
  constructor() {
    // Create the websocket server
    // Create a counter to track the total number of dodoEggs received
  }

  /**
   * A token pair listener will call this method to have a token pair/new token audited,
   * it will then add the pair as a DodoEgg into the dodos map.
   * @param {string} data
   */
  async processAudit(id, results) {
    // Get the dodoEgg from the map
    const newToken = this.newTokens.get(id);

    console.log('ID ', id);
    console.log('RESULTS', results);

    // If the audit was not successful, remove the pair from the Map
    if (!newToken.auditResults.success) {
      console.log('************* |   AUDIT FAILED   | *************');

      // Log the reason
      if (newToken.auditResults.mythrilAudit === null) {
        console.log(newToken.auditResults.goPlusAudit.reason);
      } else if (newToken.auditResults.mythrilAudit.success === false) {
        console.log('Failed Mythril Audit');
      } else {
        console.log('Unknown failure reason');
      }
      console.log('');

      // Remove the pair from the Map
      this.newTokens.delete(id);
      return;
    }

    console.log('************* |   AUDIT SUCCESS   | *************');
    console.log('');

    // Add the dodoEgg to the trader queue to see if it can be traded
    //this.trader.add(dodoEgg);

    return;
  }

  /**
   * Should create a snapshot of the blockchain and try to trade the token pair to see if there is anything that
   * stops a buy or sell from happening
   * @param {DodoEgg} dodoEgg
   */
  async processTrade(dodoEgg) {
    // Update the DodoEgg in the map
    this.dodos.set(dodoEgg.id, dodoEgg);

    // This should process the trade results meaning that if the token pair was successfully traded on the local/private
    // blockchain it should be safe to trade on the mainnet.

    // If it failed remove the dodo from the #dodos map record the reason
    // for its failure, and save it to the correct archive file

    // If it was successful, we should save the dodoEgg to the correct archive file

    return;
  }
}
