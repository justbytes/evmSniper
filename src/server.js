import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { rugpullDetection, tokenSecurity, rateLimiter } from './audit/index.js';

export class WebSocketController extends EventEmitter {
  constructor(port = 8069) {
    super();
    this.port = port;
    this.wss = null;
    this.isRunning = false;
    this.rateLimiterMonitor = null;

    this.uniswapV2 = new UniswapV2();
    this.uniswapV3 = new UniswapV3();
  }

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

  handleConnection(ws) {
    // Set up ping/pong for connection health
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async rawData => {
      try {
        let token = await this.deserializeData(rawData);

        // Make sure the data is valid
        if (!token) {
          console.log('*******   ERROR: Invalid data format   ******');
          return;
        }

        // Runs the GoPlus audits
        token = await this.runAudit(token);

        if (!token) return;

        // snipe the token
        this.runTrade(token);
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

  handleDisconnection(ws) {
    // Clean up any connection-specific data
    this.emit('connectionClosed', ws.id);

    // TODO: Implement your save logic here
    this.saveDataToFile();
  }

  async deserializeData(data) {
    try {
      // Handle both Buffer and string data
      const jsonString = data instanceof Buffer ? data.toString() : data;
      return JSON.parse(jsonString);
    } catch (error) {
      throw new Error(`Failed to deserialize data: ${error.message}`);
    }
  }

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
      // console.log(
      //   `[Token Audit] Security check failed for ${token.newTokenAddress}`
      // );
      return false;
    }

    // Run a security audit for rugpull detection
    const rugCheck = await rugpullDetection(token.chainId, token.newTokenAddress);

    // Stop if its token is unsafe
    if (!rugCheck.success) {
      // console.log(
      //   `[Token Audit] Rugpull check failed for ${token.newTokenAddress}`
      // );
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

  async runTrade(token) {
    if (token.v3) {
      // RUN UNISWAP V3 TRADE - SOON TO BE IMPLEMENTED
    } else {
      console.log(`****   SNIPING ${token.newTokenAddress}   ****`);
    }
  }

  saveDataToFile() {
    // Implement your save logic here
    console.log(`This should save a token to file`);
    // Example: fs.writeFileSync('data.json', JSON.stringify([...this.newtokens]));
  }

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
    };
  }

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

  // Reset rate limiter (emergency use)
  resetRateLimiter() {
    console.log('⚠️  Resetting rate limiter - use with caution!');
    rateLimiter.reset();
  }
}
