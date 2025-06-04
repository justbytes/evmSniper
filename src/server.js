import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { Audit } from './audit/Audit.js';

export class WebSocketController extends EventEmitter {
  constructor(port = 8069) {
    super();
    this.port = port;
    this.wss = null;
    this.isRunning = false;
    this.audit = new Audit(this).start();
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
      this.isRunning = true;

      console.log(`WebSocket server started on port ${this.port}`);
      this.emit('serverStarted', this.port);
    } catch (error) {
      console.error('Failed to start WebSocket server:', error);
      throw error;
    }
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
        const data = await this.deserializeData(rawData);
        console.log('');
        console.log('***** DATA *****\n', data);
        console.log('');

        if (!data) {
          console.log('*******   ERROR: Invalid data format   ******');
          // ws.send(JSON.stringify({ error: 'Invalid data format' }));
          return;
        }

        if (data.action == 'audit') {
          // Add to audit queue
          this.audit.addToQueue(data.data);
          this.emit('NewTokenFound', data);
        } else if (data.action == 'trade') {
          console.log('going to run a trade');
          this.emit('TradeFound', data);
        }

        // Acknowledge receipt
        ws.send(
          JSON.stringify({
            type: 'ack',
            status: 'received',
          })
        );
      } catch (error) {
        console.error('Error processing message:', error);
        ws.send(
          JSON.stringify({
            error: 'Failed to process message',
            details: error.message,
          })
        );
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
    return {
      isRunning: this.isRunning,
      connectedClients: this.wss ? this.wss.clients.size : 0,
      auditQueueSize: this.audit.size,
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
}
