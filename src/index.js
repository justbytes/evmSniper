import fs from "fs";
import path from "path";
import V2TokenPairListener from "./listeners/V2TokenPairListener";
import V3TokenPairListener from "./listeners/V3TokenPairListener";
import dotenv from "dotenv";

dotenv.config();

// Retrieve Uniswap address data file and parse the json
const UNISWAP_JSON = path.join(__dirname, "../data/uniswap.json");
const rawUniswapData = fs.readFileSync(UNISWAP_JSON, "utf8");
const UNISWAP = JSON.parse(rawUniswapData);

/**
 * Starts the event listeners for the target chains in uniswap.json file (which can be any fork of uniswap)
 * @param {Websocket} server - Websocket to send data event data too
 */
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
const main = async () => {
  try {
    // Initialize the websocket server that will recieve newly created token pools/pairs
    const server = new WebSocketController(process.env.PORT).startServer();

    // Create the client connection
    const wsClient = new WebSocket(`ws://localhost:${process.env.PORT}`);

    // Wait for connection to open
    await new Promise((resolve, reject) => {
      wsClient.on("open", resolve);
      wsClient.on("error", reject);
    });

    // Activate new pairs/pools listeners for each blockchain
    activateListeners(wsClient);

    console.log("Welcome to the EVM Sniper Bot!");
  } catch (error) {
    throw new Error(`There was an error starting the program\n` + error);
  }
};

main();
