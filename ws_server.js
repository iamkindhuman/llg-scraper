const express = require('express');
const http = require('http');
const io = require('socket.io-client');

// Store latest data
let latestData = {
  timestamp: null,
  products: {},
  timezones: {}
};

let messageCount = 0;
let isConnected = false;
let lastUpdateTime = null;
let socket = null;

// Create Express app
const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

// Connect to WF Gold WebSocket using socket.io-client v2
function connectToWFGold() {
  console.log(`[${new Date().toISOString()}] 🔌 Connecting to WF Gold...`);
  
  // Socket.IO v2 connection options
  const options = {
    transports: ['websocket'],
    query: 'token=applepieapplepieapplepieapplepie',
    extraHeaders: {
      'Origin': 'https://www.wfgold.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 5000,
    reconnectionDelayMax: 30000,
    timeout: 20000,
    forceNew: true,
    rejectUnauthorized: false
  };
  
  socket = io.connect('https://quote.wfgold.com:8082', options);

  socket.on('connect', () => {
    console.log(`[${new Date().toISOString()}] ✅ Connected! Socket ID: ${socket.id}`);
    isConnected = true;
  });

  socket.on('quote.realtime', (data) => {
    messageCount++;
    lastUpdateTime = new Date().toISOString();
    
    if (data && data.products) {
      // Update products
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
          lastUpdate: lastUpdateTime
        };
      });
      
      if (data.tz) {
        latestData.timezones = data.tz;
      }
      
      latestData.timestamp = lastUpdateTime;
      
      // Log updates periodically
      if (messageCount === 1 || messageCount % 50 === 0) {
        console.log(`\n[${lastUpdateTime}] 📊 Update #${messageCount}`);
        logKeyProducts();
      }
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[${new Date().toISOString()}] 🔴 Disconnected: ${reason}`);
    isConnected = false;
    
    // Socket.IO v2 will auto-reconnect
  });

  socket.on('connect_error', (error) => {
    console.error(`[${new Date().toISOString()}] ❌ Connection error: ${error.message}`);
    isConnected = false;
  });

  socket.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] ❌ Error: ${error}`);
  });

  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log(`[${new Date().toISOString()}] 🔄 Reconnect attempt #${attemptNumber}`);
  });

  socket.on('reconnect', () => {
    console.log(`[${new Date().toISOString()}] ✅ Reconnected!`);
    isConnected = true;
  });

  return socket;
}

function logKeyProducts() {
  const keyProducts = ['XAU=', 'XAG=', 'EUR=', 'GBP=', 'JPY=', 'HKD='];
  console.log('─'.repeat(60));
  keyProducts.forEach(code => {
    if (latestData.products[code]) {
      const p = latestData.products[code];
      const name = (p.name?.enUS || p.id).padEnd(10);
      console.log(`${name} ${code} Buy: ${p.buy?.padEnd(10)} Sell: ${p.sell?.padEnd(10)}`);
    }
  });
  console.log('─'.repeat(60));
}

// Routes
app.get('/', (req, res) => {
  res.json({
    service: 'WF Gold Scraper v2.0',
    status: {
      connected: isConnected,
      messageCount,
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
    messageCount,
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
      available: Object.keys(latestData.products)
    });
  }
});

app.get('/api/products', (req, res) => {
  const products = Object.values(latestData.products).map(p => ({
    id: p.id,
    name: p.name?.enUS || p.id,
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
    connected: isConnected,
    messageCount,
    lastUpdate: latestData.timestamp,
    products: Object.keys(latestData.products).length,
    socketId: socket ? socket.id : null
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connected: isConnected, 
    messages: messageCount,
    uptime: process.uptime()
  });
});

// Start server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`\n🚀 WF Gold Scraper v2.0 (Socket.IO v2 client)`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 URL: https://llg-scraper.onrender.com`);
  console.log(`\n⏳ Connecting in 2 seconds...\n`);
  
  // Connect after server is ready
  setTimeout(() => {
    connectToWFGold();
  }, 2000);
});

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  if (socket) socket.close();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down...');
  if (socket) socket.close();
  server.close(() => process.exit(0));
});
