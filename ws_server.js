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

let messageCount = 0;
let lastMessageTime = null;

// Configuration
const WS_URL = 'wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket';
const RECONNECT_INTERVAL = 5000;
const PING_INTERVAL = 25000;

class WFGoldScraper {
  constructor() {
    this.ws = null;
    this.pingInterval = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 100; // Increased for persistence
  }

  connect() {
    console.log(`[${new Date().toISOString()}] 🔌 Connecting to WF Gold WebSocket...`);
    
    try {
      this.ws = new WebSocket(WS_URL, {
        rejectUnauthorized: false,
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
        console.log(`[${new Date().toISOString()}] ✅ WebSocket connected successfully!`);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startPing();
      });
      
      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });
      
      this.ws.on('error', (error) => {
        console.error(`[${new Date().toISOString()}] ❌ WebSocket error:`, error.message);
        this.isConnected = false;
      });
      
      this.ws.on('close', (code, reason) => {
        const reasonStr = reason ? reason.toString() : 'No reason';
        console.log(`[${new Date().toISOString()}] 🔴 WebSocket closed. Code: ${code}, Reason: ${reasonStr}`);
        this.isConnected = false;
        this.stopPing();
        
        // Don't reconnect if it was a clean closure requested by us
        if (code !== 1000) {
          this.reconnect();
        }
      });
      
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Connection error:`, error.message);
      this.reconnect();
    }
  }

  handleMessage(data) {
    try {
      const message = data.toString();
      messageCount++;
      lastMessageTime = new Date().toISOString();
      
      // Socket.IO protocol handlers
      if (message === '0') {
        console.log(`[${lastMessageTime}] 📡 Socket.IO opening packet`);
        return;
      }
      
      if (message === '40') {
        console.log(`[${lastMessageTime}] 🔗 Socket.IO connection established`);
        return;
      }
      
      if (message === '2') {
        // Server ping
        if (messageCount <= 5 || messageCount % 100 === 0) {
          console.log(`[${lastMessageTime}] 💓 Server ping (message #${messageCount})`);
        }
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send('3'); // Send pong
        }
        return;
      }
      
      if (message === '3') {
        // Server pong
        return;
      }
      
      // Handle data messages (starts with 42)
      if (message.startsWith('42')) {
        try {
          const jsonStr = message.substring(2);
          const parsedData = JSON.parse(jsonStr);
          
          // Check for quote.realtime
          if (Array.isArray(parsedData) && parsedData[0] === 'quote.realtime') {
            this.processQuoteData(parsedData[1]);
          }
        } catch (parseError) {
          // Some messages might not be valid JSON, that's okay
          if (messageCount <= 10) {
            console.log(`[${lastMessageTime}] Raw message (#${messageCount}):`, message.substring(0, 100));
          }
        }
      } else if (messageCount <= 5) {
        // Log other message types for debugging
        console.log(`[${lastMessageTime}] Other message (#${messageCount}):`, message.substring(0, 100));
      }
      
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error processing message:`, error.message);
    }
  }

  processQuoteData(data) {
    if (data && data.products) {
      const timestamp = new Date().toISOString();
      
      // Update products data
      let updatedCount = 0;
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
        updatedCount++;
      });
      
      // Update timezone data
      if (data.tz) {
        latestData.timezones = data.tz;
      }
      
      latestData.timestamp = timestamp;
      
      // Emit event
      dataEmitter.emit('quoteUpdate', {
        timestamp,
        products: latestData.products,
        timezones: latestData.timezones
      });
      
      // Log update
      console.log(`\n[${timestamp}] 📊 QUOTE UPDATE #${messageCount} - ${updatedCount} products updated`);
      this.logKeyProducts();
    }
  }

  logKeyProducts() {
    const keyProducts = ['XAU=', 'XAG=', 'EUR=', 'GBP=', 'JPY='];
    console.log('─'.repeat(60));
    keyProducts.forEach(code => {
      if (latestData.products[code]) {
        const p = latestData.products[code];
        const name = (p.name?.enUS || p.name?.zhCN || p.id).padEnd(10);
        console.log(`${name} ${code.padEnd(5)} Buy: ${p.buy.padEnd(10)} Sell: ${p.sell.padEnd(10)} High: ${p.dayhigh.split('/')[0].trim()}`);
      }
    });
    console.log('─'.repeat(60));
  }

  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('2');
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
      const delay = RECONNECT_INTERVAL * Math.min(this.reconnectAttempts, 10);
      
      console.log(`[${new Date().toISOString()}] ⏳ Reconnecting in ${delay/1000}s... (Attempt ${this.reconnectAttempts})`);
      
      setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.error(`[${new Date().toISOString()}] 🔄 Max attempts reached. Restarting connection cycle...`);
      this.reconnectAttempts = 0;
      setTimeout(() => this.connect(), 30000);
    }
  }

  disconnect() {
    this.stopPing();
    if (this.ws) {
      try {
        this.ws.close(1000, 'Client disconnect');
      } catch (error) {
        console.error('Error closing WebSocket:', error.message);
      }
      this.ws = null;
    }
    this.isConnected = false;
  }
}

// Express app
const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

// Routes
app.get('/', (req, res) => {
  res.json({
    service: 'WF Gold Scraper',
    version: '1.0.0',
    status: {
      connected: scraper.isConnected,
      messageCount: messageCount,
      lastMessage: lastMessageTime,
      lastUpdate: latestData.timestamp,
      products: Object.keys(latestData.products).length
    },
    endpoints: {
      latest: '/api/latest',
      product: '/api/product/:code',
      products: '/api/products',
      status: '/api/status',
      health: '/health'
    }
  });
});

app.get('/api/latest', (req, res) => {
  res.json({
    success: true,
    timestamp: latestData.timestamp,
    messageCount: messageCount,
    data: latestData
  });
});

app.get('/api/product/:code', (req, res) => {
  const code = req.params.code;
  if (latestData.products[code]) {
    res.json({ success: true, data: latestData.products[code] });
  } else {
    res.status(404).json({ 
      success: false, 
      error: 'Product not found',
      availableProducts: Object.keys(latestData.products)
    });
  }
});

app.get('/api/products', (req, res) => {
  const products = Object.values(latestData.products).map(p => ({
    id: p.id,
    name: p.name?.enUS || p.name?.zhCN || p.id,
    buy: p.buy,
    sell: p.sell,
    dayhigh: p.dayhigh,
    daylow: p.daylow,
    lastUpdate: p.lastUpdate
  }));
  
  res.json({ success: true, count: products.length, data: products });
});

app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    connected: scraper.isConnected,
    reconnectAttempts: scraper.reconnectAttempts,
    messageCount: messageCount,
    lastMessage: lastMessageTime,
    lastUpdate: latestData.timestamp
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', wsConnected: scraper.isConnected, messages: messageCount });
});

// Initialize scraper
const scraper = new WFGoldScraper();

// Start server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`\n🚀 WF Gold Scraper Server`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Health: http://localhost:${PORT}/health`);
  console.log(`📊 Status: http://localhost:${PORT}/api/status`);
  console.log(`💹 Latest: http://localhost:${PORT}/api/latest`);
  console.log(``);
  
  // Connect WebSocket after server is ready
  setTimeout(() => {
    console.log(`🔌 Initiating WebSocket connection...`);
    scraper.connect();
  }, 1000);
});

// Graceful shutdown
const shutdown = () => {
  console.log('\n🛑 Shutting down...');
  scraper.disconnect();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { scraper, dataEmitter, app };
