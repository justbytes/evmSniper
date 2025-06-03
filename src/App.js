const WebSocket = require("ws");
const { deserializeDodo } = require("./utils/dodoCoder");
const Audit = require("./controller/audit/Audit");
const Trader = require("./controller/blockchain/Trader");
const { saveAuditedDodoEgg } = require("./utils/archive");

class App {
  // Create a map to store the dodoEggs
  #dodos = new Map();

  /**
   * Constructor for the App class
   */
  constructor() {
    // Create the websocket server
    this.wss = new WebSocket.Server({ port: 8069 });

    // Create the audit controller
    this.audit = new Audit(this);

    // Create the trader controller
    this.trader = new Trader(this);

    // Create a counter to track the total number of dodoEggs received
    this.totalReceived = 0;
  }

  /**
   * A token pair listener will call this method to have a token pair/new token audited,
   * it will then add the pair as a DodoEgg into the dodos map.
   * @param {string} data
   */
  async processAudit(id, results) {
    // Get the dodoEgg from the map
    const dodoEgg = this.#dodos.get(id);

    // Add the audit results to the DodoEgg object
    dodoEgg.auditResults = results;

    // Save the audit results
    saveAuditedDodoEgg(dodoEgg.auditResults.success, dodoEgg.getDodoEgg());

    // If the audit was not successful, remove the pair from the Map
    if (!dodoEgg.auditResults.success) {
      console.log("************* |   AUDIT FAILED   | *************");

      // Log the reason
      if (dodoEgg.auditResults.mythrilAudit === null) {
        console.log(dodoEgg.auditResults.goPlusAudit.reason);
      } else if (dodoEgg.auditResults.mythrilAudit.success === false) {
        console.log("Failed Mythril Audit");
      } else {
        console.log("Unknown failure reason");
      }
      console.log("");

      // Remove the pair from the Map
      this.#dodos.delete(id);
      return;
    }

    console.log("************* |   AUDIT SUCCESS   | *************");
    console.log("");

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
    this.#dodos.set(dodoEgg.id, dodoEgg);

    // This should process the trade results meaning that if the token pair was successfully traded on the local/private
    // blockchain it should be safe to trade on the mainnet.

    // If it failed remove the dodo from the #dodos map record the reason
    // for its failure, and save it to the correct archive file

    // If it was successful, we should save the dodoEgg to the correct archive file

    return;
  }

  /**
   * Starts the app by activating listeners on all Uniswap v3 and v2 protocols
   */
  start() {
    // Begin the audit queue
    this.audit.start();
    //this.trader.startQueue();

    // Listen for new connections
    this.wss.on("connection", (ws) => {
      console.log("New connection to app.js");

      // Listen for new messages
      ws.on("message", (data) => {
        // Increment the total received
        this.totalReceived++;

        // Convert the data into a DodoEgg object
        const dodoEgg = deserializeDodo(data);

        // Add the new pair to the Map
        this.#dodos.set(dodoEgg.id, dodoEgg);

        //console.log(dodoEgg);

        // Begin the audit process
        this.audit.add({
          id: dodoEgg.id,
          chainId: dodoEgg.chainId,
          newTokenAddress: dodoEgg.newTokenAddress,
        });
      });

      ws.on("close", () => {
        console.log(
          "************* |   Socket was disconnected  | *************"
        );
        console.log("");
        // TODO: Run a save function that saves all data to file before closing
      });
    });
  }

  /**
   * Stops the app by stopping the audit and trader queues and closing the websocket server
   */
  stop() {
    this.audit.stopQueue();
    this.trader.stopQueue();
  }
}

module.exports = App;
