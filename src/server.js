import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { rugpullDetection, tokenSecurity, rateLimiter } from './audit/index.js';
import { getTradingInstance } from './trading/index.js';

/**
 * This class is responsible for running the GoPlus audit on new tokens and if the token contract passes then it attempt to buy
 * and sells if the stop loss or target price have been hit.
 */
export class WebSocketController extends EventEmitter {
  /**
   * Constructor
   */
  constructor(port = 8069, tradingInstances = {}) {
    super();
    this.port = port;
    this.wss = null;
    this.isRunning = false;
    this.rateLimiterMonitor = null;
    this.tradingInstances = tradingInstances;
  }

  /**
   * Starts up the server on the specified port. starts event handlers and the rate limiter for the go plus audits
   */
  async startServer() {
    if (this.isRunning) {
      console.log('Server already running');
      return;
    }

    try {
      this.wss = new WebSocketServer({
        port: this.port,
        perMessageDeflate: false,
      });

      this.setupEventHandlers();
      this.startRateLimiterMonitor();
      this.isRunning = true;

      console.log(`WebSocket server started on port ${this.port}`);
      this.emit('serverStarted', this.port);
    } catch (error) {
      console.error('Failed to start WebSocket server:', error);
      throw error;
    }
  }

  /**
   * Displays the rate limiter stats every 30 seconds
   */
  startRateLimiterMonitor() {
    // Monitor rate limiter status every 30 seconds
    this.rateLimiterMonitor = setInterval(() => {
      const status = rateLimiter.getStatus();
      console.log(
        `[Rate Limiter Status] Calls: ${status.callsInWindow}/${status.maxCalls}, Queue: ${status.queueLength}, Throttled: ${status.isThrottled}`
      );

      // Emit status for any listeners
      this.emit('rateLimiterStatus', status);
    }, 30000);
  }

  /**
   * Setup and initialize connections
   */
  setupEventHandlers() {
    this.wss.on('connection', (ws, request) => {
      console.log(`New connection from ${request.socket.remoteAddress}`);

      // Add connection metadata
      ws.id = this.generateConnectionId();
      ws.connectedAt = new Date();

      this.handleConnection(ws);
    });

    this.wss.on('error', error => {
      console.error('WebSocket server error:', error);
      this.emit('error', error);
    });
  }

  /**
   * Handle the data/request coming in from client
   */
  handleConnection(ws) {
    // Set up ping/pong for connection health
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async rawData => {
      try {
        let token = await this.deserializeData(rawData);
        console.log('');

        console.log(token);
        console.log('');
        // Make sure the data is valid
        if (!token) {
          console.log('*******   ERROR: Invalid data format   ******');
          return;
        }

        // Runs the GoPlus audits
        token = await this.runAudit(token);

        if (!token) return;

        // snipe the token
        await this.runTrade(token);
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`Connection ${ws.id} closed: ${code} - ${reason}`);
      this.handleDisconnection(ws);
    });

    ws.on('error', error => {
      console.error(`Connection ${ws.id} error:`, error);
    });
  }

  /**
   * Yet to be implemented
   */
  handleDisconnection(ws) {
    // Clean up any connection-specific data
    this.emit('connectionClosed', ws.id);

    // TODO: Implement your save logic here
    this.saveDataToFile();
  }

  /**
   * Parse the data recieved from clients
   */
  async deserializeData(data) {
    try {
      // Handle both Buffer and string data
      const jsonString = data instanceof Buffer ? data.toString() : data;
      return JSON.parse(jsonString);
    } catch (error) {
      throw new Error(`Failed to deserialize data: ${error.message}`);
    }
  }

  /**
   * Used for pinging server
   */
  async pingServer() {
    if (!this.wss) return false;

    return new Promise(resolve => {
      const interval = setInterval(() => {
        this.wss.clients.forEach(ws => {
          if (ws.isAlive === false) {
            console.log(`Terminating inactive connection ${ws.id}`);
            return ws.terminate();
          }

          ws.isAlive = false;
          ws.ping();
        });
      }, 30000); // Ping every 30 seconds

      // Store interval reference for cleanup
      this.pingInterval = interval;
      resolve(true);
    });
  }

  /**
   * Shuts down the server
   */
  async stopServer() {
    if (!this.isRunning) {
      console.log('Server not running');
      return;
    }

    return new Promise(resolve => {
      // Clear ping interval
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
      }

      // Clear rate limiter monitor
      if (this.rateLimiterMonitor) {
        clearInterval(this.rateLimiterMonitor);
      }

      // Save data before closing
      this.saveDataToFile();

      // Close all connections gracefully
      this.wss.clients.forEach(ws => {
        ws.close(1000, 'Server shutting down');
      });

      // Close server
      this.wss.close(() => {
        this.isRunning = false;
        console.log('WebSocket server stopped');
        this.emit('serverStopped');
        resolve();
      });
    });
  }

  /**
   * Runs 2 GoPlus Security audits to see if the token is safe
   * @param {*} token
   * @returns
   */
  async runAudit(token) {
    // Send rate limiter status before processing
    const rateLimiterStatus = rateLimiter.getStatus();

    // Display current audit queue stats
    console.log(`[Rate Limiter] Current status:`, {
      calls: `${rateLimiterStatus.callsInWindow}/${rateLimiterStatus.maxCalls}`,
      queueLength: rateLimiterStatus.queueLength,
      waitTime: `${rateLimiterStatus.waitTime}ms`,
    });

    // Runs a detailed GoPlus token security check
    const securityCheck = await tokenSecurity(token.chainId, token.newTokenAddress);

    // Stop if token is unsafe
    if (!securityCheck.success) {
      return false;
    }

    // Run a security audit for rugpull detection
    const rugCheck = await rugpullDetection(token.chainId, token.newTokenAddress);

    // Stop if its token is unsafe
    if (!rugCheck.success) {
      return false;
    }

    console.log('******   TOKEN PASSED AUDIT   ******\n', token.newTokenAddress);

    // Add the audit results to the token
    return {
      ...token,
      auditResults: { ...securityCheck.results, ...rugCheck.results },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Attempts to buy a new token
   */
  async runTrade(token) {
    try {
      // Get the appropriate trading instance
      const tradingInstance = getTradingInstance(this.tradingInstances, token);

      // Stop if theres no matching instance
      if (!tradingInstance) {
        console.error(`❌ No trading instance found for token:`, {
          chain: token.chain,
          chainId: token.chainId,
          version: token.v3 ? 'V3' : 'V2',
          tokenAddress: token.newTokenAddress,
        });
        return;
      }

      const version = token.v3 ? 'V3' : 'V2';
      const instanceName = `${token.chain || 'unknown'}${version}`;

      console.log(`🎯 Using ${instanceName} instance for trading`);
      console.log(`****   SNIPING ${token.newTokenAddress}   ****`);

      // Execute the trade
      const result = await tradingInstance.buyToken(token);

      if (result && result.success) {
        console.log(`✅ Trade successful:`, {
          txHash: result.txHash,
          entryPrice: result.entryPrice,
          amount: result.amount.toString(),
          instanceUsed: instanceName,
        });
      } else {
        console.error(`❌ Trade failed for ${token.newTokenAddress}`);
      }

      return result;
    } catch (error) {
      console.error(`❌ Error executing trade for ${token.newTokenAddress}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Should be used to save a buy tx to file
   *
   * Note: This will probably get moved to the utils dir and be called in the trading classes instead.
   */
  saveDataToFile() {
    // Implement your save logic here
    console.log(`This should save a token to file`);
    // Example: fs.writeFileSync('data.json', JSON.stringify([...this.newtokens]));
  }

  /**
   * Creates a unique connection id for a websocket connection
   */
  generateConnectionId() {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Utility methods
  getStats() {
    const rateLimiterStatus = rateLimiter.getStatus();
    return {
      isRunning: this.isRunning,
      connectedClients: this.wss ? this.wss.clients.size : 0,
      rateLimiter: rateLimiterStatus,
      tradingInstances: Object.keys(this.tradingInstances),
    };
  }

  /**
   * Broadcast a message to a client
   */
  broadcast(message) {
    if (!this.wss) return;

    const data = JSON.stringify(message);
    this.wss.clients.forEach(ws => {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    });
  }

  // Get rate limiter status
  getRateLimiterStatus() {
    return rateLimiter.getStatus();
  }

  // Reset rate limiter
  resetRateLimiter() {
    console.log('⚠️  Resetting rate limiter - use with caution!');
    rateLimiter.reset();
  }

  // Get available trading instances
  getTradingInstances() {
    return Object.keys(this.tradingInstances);
  }
}
