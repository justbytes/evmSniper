const fs = require("fs");
const path = require("path");
const App = require("./App");
const V2TokenPairListener = require("./models/V2TokenPairListener");
const V3TokenPairListener = require("./models/V3TokenPairListener");

// Retrieve Uniswap address data file and parse the json
const UNISWAP_JSON = path.join(__dirname, "../data/uniswap.json");
const rawUniswapData = fs.readFileSync(UNISWAP_JSON);
const UNISWAP = JSON.parse(rawUniswapData);

const activateListeners = (server) => {
  // Loop through each Uniswap protocol and activate listeners
  for (let i = 0; i < UNISWAP.length; i++) {
    let chainId = UNISWAP[i].chain_id;
    let v2Factory = UNISWAP[i].v2.factory;
    let v3Factory = UNISWAP[i].v3.factory;

    // Start V2 listener
    if (v2Factory != null) {
      new V2TokenPairListener(v2Factory, chainId, server);
    }

    // Start V3 listener
    if (v3Factory != null) {
      new V3TokenPairListener(v3Factory, chainId, server);
    }
  }
};

/**
 * Starts the program by activating listeners on all Uniswap v3 and v2 protocols
 */
const main = () => {
  try {
    // Initialize the websocket server that will recieve newly created token pools/pairs
    const server = new WebSocket("ws://localhost:8069");

    // Initialize the App
    const app = new App();

    // Activate new pairs/pools listeners for each blockchain
    activateListeners(server);

    // Start the app
    app.start();

    console.log("Welcome to the EVM Sniper Bot!");
  } catch (error) {
    throw new Error(`There was an error starting the program\n` + error);
  }
};

main();
