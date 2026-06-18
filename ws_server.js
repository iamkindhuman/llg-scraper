const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const https = require('https');
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
      // Create custom WebSocket with options to handle SSL
      this.ws = new WebSocket(WS_URL, {
        rejectUnauthorized: false, // Accept self-signed certificates
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.8',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Origin': 'https://www.wfgold.com',
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits'
        }
      });
      
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
      
      // Log raw message for debugging (optional, can be disabled in production)
      if (message.startsWith('42')) {
        console.log(`[${new Date().toISOString()}] Received data message`);
      }
      
      // Socket.IO protocol messages
      if (message === '2') {
        // Ping from server, respond with pong
        console.log(`[${new Date().toISOString()}] Received ping, sending pong`);
        this.ws.send('3');
        return;
      }
      
      if (message === '3') {
        // Pong from server
        return;
      }
      
      if (message.startsWith('0')) {
        // Socket.IO opening packet
        console.log(`[${new Date().toISOString()}] Socket.IO opening packet received`);
        return;
      }
      
      if (message.startsWith('40')) {
        // Connection established
        console.log(`[${new Date().toISOString()}] Socket.IO connection established`);
        return;
      }
      
      // Handle actual data messages (starts with 42)
      if (message.startsWith('42')) {
        try {
          const jsonStr = message.substring(2); // Remove '42' prefix
          const parsedData = JSON.parse(jsonStr);
          
          // Check if it's a quote.realtime message
          if (Array.isArray(parsedData) && parsedData[0] === 'quote.realtime') {
            this.processQuoteData(parsedData[1]);
          }
        } catch (parseError) {
          // Sometimes the message might be malformed, log it
          if (message.includes('quote.realtime')) {
            console.error(`[${new Date().toISOString()}] Error parsing quote data:`, parseError.message);
          }
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
          mf_id: product.mf_id,
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
    
    console.log(`\n[${timestamp}] Key Products Update:`);
    console.log('─'.repeat(60));
    
    keyProducts.forEach(code => {
      if (products[code]) {
        const product = products[code];
        const name = product.name?.enUS || product.name?.zhCN || product.id;
        console.log(`${name.padEnd(15)} (${code.padEnd(5)}) Buy: ${product.buy.padEnd(10)} Sell: ${product.sell.padEnd(10)}`);
      }
    });
    console.log('─'.repeat(60));
  }

  startPing() {
    this.stopPing(); // Clear any existing interval
    this.pingInterval = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
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
      // Exponential backoff: 5s, 10s, 15s, 20s, 25s (capped at 25s)
      const delay = RECONNECT_INTERVAL * Math.min(this.reconnectAttempts, 5);
      
      console.log(`[${new Date().toISOString()}] Reconnecting in ${delay/1000} seconds... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.error(`[${new Date().toISOString()}] Max reconnection attempts reached. Will try again in 60 seconds.`);
      this.reconnectAttempts = 0; // Reset attempts
      
      setTimeout(() => {
        this.connect();
      }, 60000); // Try again after 1 minute
    }
  }

  disconnect() {
    this.stopPing();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        console.error('Error closing WebSocket:', error.message);
      }
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

// Home route
app.get('/', (req, res) => {
  res.json({
    service: 'WF Gold Scraper',
    version: '1.0.0',
    endpoints: {
      latest: '/api/latest',
      product: '/api/product/:code',
      products: '/api/products',
      status: '/api/status',
      health: '/health'
    },
    status: {
      connected: scraper.isConnected,
      lastUpdate: latestData.timestamp
    }
  });
});

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
      error: 'Product not found',
      availableProducts: Object.keys(latestData.products)
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
    prod_code: p.prod_code,
    lastUpdate: p.lastUpdate
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

// Start WebSocket connection with a small delay to ensure server is ready
setTimeout(() => {
  scraper.connect();
}, 2000);

// Start Express server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`\n=================================`);
  console.log(`WF Gold Scraper Server`);
  console.log(`=================================`);
  console.log(`Server running on port ${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  - GET /                   : Service info`);
  console.log(`  - GET /api/latest         : All latest data`);
  console.log(`  - GET /api/product/:code  : Specific product`);
  console.log(`  - GET /api/products       : Products list`);
  console.log(`  - GET /api/status         : Connection status`);
  console.log(`  - GET /health             : Health check`);
  console.log(`=================================\n`);
  console.log(`WebSocket will connect in 2 seconds...\n`);
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
