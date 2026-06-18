// Alternative: ws_server_v2.js
const WebSocket = require('ws');
const express = require('express');
const http = require('http');

let latestData = {
  timestamp: null,
  products: {},
  timezones: {}
};

let messageCount = 0;
let isConnected = false;
let lastUpdateTime = null;

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

function connectToWFGold() {
  console.log(`[${new Date().toISOString()}] 🔌 Connecting to WF Gold...`);
  
  // Socket.IO v2 uses different URL format
  const wsUrl = 'wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket';
  
  const ws = new WebSocket(wsUrl, {
    rejectUnauthorized: false,
    headers: {
      'Origin': 'https://www.wfgold.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  ws.on('open', () => {
    console.log(`[${new Date().toISOString()}] ✅ WebSocket connected!`);
    isConnected = true;
  });

  ws.on('message', (data) => {
    const msg = data.toString();
    messageCount++;
    
    // Socket.IO v2 protocol: messages start with 42["event", data]
    if (msg.startsWith('0')) {
      console.log(`[${new Date().toISOString()}] 📡 Handshake received`);
      return;
    }
    
    if (msg === '40') {
      console.log(`[${new Date().toISOString()}] 🔗 Connection established`);
      return;
    }
    
    if (msg === '2') {
      // Server ping, respond with pong
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('3');
      }
      return;
    }
    
    // Data message - Socket.IO v2 format: 42["event", data]
    if (msg.startsWith('42')) {
      try {
        const jsonStr = msg.substring(2);
        const parsed = JSON.parse(jsonStr);
        
        if (Array.isArray(parsed) && parsed[0] === 'quote.realtime') {
          const data = parsed[1];
          lastUpdateTime = new Date().toISOString();
          
          if (data && data.products) {
            Object.keys(data.products).forEach(key => {
              latestData.products[key] = {
                ...data.products[key],
                lastUpdate: lastUpdateTime
              };
            });
            
            if (data.tz) {
              latestData.timezones = data.tz;
            }
            
            latestData.timestamp = lastUpdateTime;
            
            if (messageCount === 2 || messageCount % 50 === 0) {
              console.log(`[${lastUpdateTime}] 📊 Update #${messageCount-1}`);
              logKeyProducts();
            }
          }
        }
      } catch (e) {
        if (messageCount <= 5) {
          console.log(`Raw message: ${msg.substring(0, 100)}`);
        }
      }
    }
  });

  ws.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] ❌ Error: ${error.message}`);
    isConnected = false;
  });

  ws.on('close', (code, reason) => {
    console.log(`[${new Date().toISOString()}] 🔴 Closed: ${code} - ${reason}`);
    isConnected = false;
    // Reconnect after 5 seconds
    setTimeout(connectToWFGold, 5000);
  });

  // Keep alive with pings
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send('2');
    }
  }, 20000);

  ws.on('close', () => {
    clearInterval(pingInterval);
  });

  return ws;
}

function logKeyProducts() {
  const keyProducts = ['XAU=', 'XAG=', 'EUR=', 'GBP=', 'JPY='];
  console.log('─'.repeat(60));
  keyProducts.forEach(code => {
    if (latestData.products[code]) {
      const p = latestData.products[code];
      console.log(`${code} Buy: ${p.buy} Sell: ${p.sell}`);
    }
  });
  console.log('─'.repeat(60));
}

// Routes (same as before)
app.get('/', (req, res) => {
  res.json({
    service: 'WF Gold Scraper',
    connected: isConnected,
    messageCount,
    lastUpdate: latestData.timestamp
  });
});

app.get('/api/latest', (req, res) => {
  res.json({ success: true, data: latestData });
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
    sell: p.sell
  }));
  res.json({ success: true, data: products });
});

app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    connected: isConnected,
    messageCount,
    lastUpdate: latestData.timestamp
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', connected: isConnected });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Server on port ${PORT}`);
  setTimeout(connectToWFGold, 2000);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
