const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const { EventEmitter } = require('events');

// Create event emitter for real-time data broadcasting
const dataEmitter = new EventEmitter();

// Store latest data
let latestData = {
  timestamp: null,
  products: {},
  timezones: {}
};

// Configuration
const WS_URL = 'wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket';
const RECONNECT_INTERVAL = 5000; // 5 seconds
const PING_INTERVAL = 25000; // 25 seconds

class WFGoldScraper {
  constructor() {
    this.ws = null;
    this.pingInterval = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  connect() {
    console.log(`[${new Date().toISOString()}] Connecting to WF Gold WebSocket...`);
    
    try {
      this.ws = new WebSocket(WS_URL);
      
      this.ws.on('open', () => {
        console.log(`[${new Date().toISOString()}] WebSocket connected successfully`);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Send ping periodically to keep connection alive
        this.startPing();
      });
      
      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });
      
      this.ws.on('error', (error) => {
        console.error(`[${new Date().toISOString()}] WebSocket error:`, error.message);
        this.isConnected = false;
      });
      
      this.ws.on('close', (code, reason) => {
        console.log(`[${new Date().toISOString()}] WebSocket closed. Code: ${code}, Reason: ${reason}`);
        this.isConnected = false;
        this.stopPing();
        this.reconnect();
      });
      
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Connection error:`, error.message);
      this.reconnect();
    }
  }

  handleMessage(data) {
    try {
      const message = data.toString();
      
      // Socket.IO protocol messages
      if (message === '2') {
        // Ping from server, respond with pong
        this.ws.send('3');
        return;
      }
      
      if (message === '3') {
        // Pong from server
        return;
      }
      
      if (message.startsWith('40')) {
        // Connection established, send subscription if needed
        console.log(`[${new Date().toISOString()}] Socket.IO connection established`);
        return;
      }
      
      // Handle actual data messages (starts with 42)
      if (message.startsWith('42')) {
        const jsonStr = message.substring(2); // Remove '42' prefix
        const parsedData = JSON.parse(jsonStr);
        
        // Check if it's a quote.realtime message
        if (Array.isArray(parsedData) && parsedData[0] === 'quote.realtime') {
          this.processQuoteData(parsedData[1]);
        }
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error processing message:`, error.message);
    }
  }

  processQuoteData(data) {
    if (data && data.products) {
      const timestamp = new Date().toISOString();
      
      // Update products data
      Object.keys(data.products).forEach(key => {
        const product = data.products[key];
        latestData.products[key] = {
          id: product.id,
          name: product.name,
          buy: product.buy,
          sell: product.sell,
          dayhigh: product.dayhigh,
          daylow: product.daylow,
          closeprice: product.closeprice,
          prod_code: product.prod_code,
          lastUpdate: timestamp
        };
      });
      
      // Update timezone data
      if (data.tz) {
        latestData.timezones = data.tz;
      }
      
      latestData.timestamp = timestamp;
      
      // Emit event with new data
      dataEmitter.emit('quoteUpdate', {
        timestamp,
        products: latestData.products,
        timezones: latestData.timezones
      });
      
      // Log key products updates
      this.logKeyProducts(latestData.products);
    }
  }

  logKeyProducts(products) {
    const keyProducts = ['XAU=', 'XAG=', 'EUR=', 'GBP=', 'JPY=', 'HKD='];
    const timestamp = new Date().toISOString();
    
    keyProducts.forEach(code => {
      if (products[code]) {
        const product = products[code];
        const name = product.name?.enUS || product.name?.zhCN || product.id;
        console.log(`[${timestamp}] ${name} (${code}): Buy=${product.buy}, Sell=${product.sell}`);
      }
    });
  }

  startPing() {
    this.pingInterval = setInterval(() => {
      if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('2'); // Send ping to keep connection alive
      }
    }, PING_INTERVAL);
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = RECONNECT_INTERVAL * Math.min(this.reconnectAttempts, 5);
      
      console.log(`[${new Date().toISOString()}] Reconnecting in ${delay/1000} seconds... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.error(`[${new Date().toISOString()}] Max reconnection attempts reached. Stopping.`);
      // You might want to implement a manual restart mechanism here
    }
  }

  disconnect() {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}

// Create Express app for REST API
const app = express();
const server = http.createServer(app);

// Parse JSON bodies
app.use(express.json());

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Routes

// Get all latest data
app.get('/api/latest', (req, res) => {
  res.json({
    success: true,
    data: latestData,
    connectionStatus: scraper.isConnected
  });
});

// Get specific product
app.get('/api/product/:code', (req, res) => {
  const code = req.params.code;
  if (latestData.products[code]) {
    res.json({
      success: true,
      data: latestData.products[code]
    });
  } else {
    res.status(404).json({
      success: false,
      error: 'Product not found'
    });
  }
});

// Get all products list
app.get('/api/products', (req, res) => {
  const products = Object.values(latestData.products).map(p => ({
    id: p.id,
    name: p.name?.enUS || p.name?.zhCN || p.id,
    buy: p.buy,
    sell: p.sell,
    prod_code: p.prod_code
  }));
  
  res.json({
    success: true,
    count: products.length,
    data: products
  });
});

// Get connection status
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    connected: scraper.isConnected,
    reconnectAttempts: scraper.reconnectAttempts,
    lastUpdate: latestData.timestamp,
    productsCount: Object.keys(latestData.products).length
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    wsConnected: scraper.isConnected
  });
});

// Initialize scraper
const scraper = new WFGoldScraper();

// Start WebSocket connection
scraper.connect();

// Start Express server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n=================================`);
  console.log(`WF Gold Scraper Server`);
  console.log(`=================================`);
  console.log(`Server running on port ${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  - GET /api/latest        : All latest data`);
  console.log(`  - GET /api/product/:code  : Specific product`);
  console.log(`  - GET /api/products      : Products list`);
  console.log(`  - GET /api/status        : Connection status`);
  console.log(`  - GET /health            : Health check`);
  console.log(`=================================\n`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  scraper.disconnect();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  scraper.disconnect();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Export for testing or external use
module.exports = { scraper, dataEmitter, app };
