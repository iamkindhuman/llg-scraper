const WebSocket = require('ws');
const express = require('express');
const http = require('http');

let latestData = {
  timestamp: null,
  products: {},
  timezones: {},
  raw: null
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
  
  const wsUrl = 'wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket';
  
  const ws = new WebSocket(wsUrl, {
    rejectUnauthorized: false,
    headers: {
      'Origin': 'https://www.wfgold.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  let pingInterval;

  ws.on('open', () => {
    console.log(`[${new Date().toISOString()}] ✅ WebSocket connected!`);
    isConnected = true;
  });

  ws.on('message', (data) => {
    const msg = data.toString();
    messageCount++;
    
    // Log first few messages for debugging
    if (messageCount <= 10) {
      console.log(`[MSG #${messageCount}] ${msg.substring(0, 150)}`);
    }
    
    // Socket.IO v2 protocol handling
    if (msg.startsWith('0{')) {
      console.log(`📡 Handshake received`);
      // Start ping after handshake
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('2');
        }
      }, 20000);
      return;
    }
    
    if (msg === '40') {
      console.log(`🔗 Connected to Socket.IO`);
      
      // SUBSCRIBE TO QUOTE.REALTIME - This is the key!
      // Socket.IO v2 format for subscribing
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          console.log(`📨 Subscribing to quote.realtime...`);
          // Try different subscription formats
          ws.send('42["subscribe",{"channel":"quote.realtime"}]');
          
          setTimeout(() => {
            ws.send('42["join","quote.realtime"]');
          }, 500);
        }
      }, 1000);
      return;
    }
    
    if (msg === '2') {
      // Server ping
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('3');
      }
      return;
    }
    
    if (msg === '3') {
      // Server pong
      return;
    }
    
    // Data message - Socket.IO v2 format: 42["event", data]
    if (msg.startsWith('42')) {
      try {
        const jsonStr = msg.substring(2);
        const parsed = JSON.parse(jsonStr);
        
        if (Array.isArray(parsed)) {
          const eventName = parsed[0];
          const eventData = parsed[1];
          
          console.log(`📊 Event: ${eventName}`);
          
          if (eventName === 'quote.realtime' && eventData && eventData.products) {
            lastUpdateTime = new Date().toISOString();
            
            // Store all raw data
            latestData.raw = eventData;
            
            // Update products
            Object.keys(eventData.products).forEach(key => {
              latestData.products[key] = {
                ...eventData.products[key],
                lastUpdate: lastUpdateTime
              };
            });
            
            if (eventData.tz) {
              latestData.timezones = eventData.tz;
            }
            
            latestData.timestamp = lastUpdateTime;
            
            console.log(`✅ QUOTE DATA RECEIVED! ${Object.keys(eventData.products).length} products`);
            logKeyProducts();
          }
        }
      } catch (e) {
        console.log(`Parse error: ${e.message}`);
        console.log(`Raw: ${msg.substring(0, 200)}`);
      }
    }
  });

  ws.on('error', (error) => {
    console.error(`❌ Error: ${error.message}`);
    isConnected = false;
  });

  ws.on('close', (code, reason) => {
    console.log(`🔴 Closed: ${code}`);
    isConnected = false;
    if (pingInterval) clearInterval(pingInterval);
    setTimeout(connectToWFGold, 5000);
  });

  return ws;
}

function logKeyProducts() {
  console.log('═'.repeat(60));
  const products = ['XAU=', 'XAG=', 'EUR=', 'GBP=', 'JPY=', 'HKD='];
  products.forEach(code => {
    if (latestData.products[code]) {
      const p = latestData.products[code];
      const name = (p.name?.enUS || p.id).padEnd(12);
      console.log(`  ${name} ${code}  Buy: ${p.buy?.padEnd(10)} Sell: ${p.sell?.padEnd(10)}`);
    }
  });
  console.log('═'.repeat(60));
}

// API Routes
app.get('/', (req, res) => {
  res.json({
    service: 'WF Gold Scraper',
    connected: isConnected,
    messageCount,
    lastUpdate: latestData.timestamp,
    products: Object.keys(latestData.products).length
  });
});

app.get('/api/latest', (req, res) => {
  res.json(latestData);
});

app.get('/api/product/:code', (req, res) => {
  const code = req.params.code;
  if (latestData.products[code]) {
    res.json(latestData.products[code]);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    connected: isConnected,
    messageCount,
    lastUpdate: latestData.timestamp,
    products: Object.keys(latestData.products).length
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', connected: isConnected });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`\n🚀 WF Gold Scraper on port ${PORT}`);
  console.log(`⏳ Connecting in 3 seconds...\n`);
  setTimeout(connectToWFGold, 3000);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
