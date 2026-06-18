const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io-client');

// Store latest data
let latestQuoteData = null;
let isConnected = false;

app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

// Connect to WF Gold WebSocket
function connectWFGold() {
  console.log('Connecting to WF Gold...');
  
  const socket = io('https://quote.wfgold.com:8082', {
    transports: ['websocket'],
    query: 'token=applepieapplepieapplepieapplepie',
    extraHeaders: {
      'Origin': 'https://www.wfgold.com'
    },
    reconnection: true,
    reconnectionDelay: 5000,
    reconnectionAttempts: Infinity
  });

  socket.on('connect', () => {
    console.log('✅ Connected! ID:', socket.id);
    isConnected = true;
  });

  socket.on('quote.realtime', (data) => {
    latestQuoteData = data;
    console.log('📊 Data received:', new Date().toISOString());
  });

  socket.on('disconnect', (reason) => {
    console.log('🔴 Disconnected:', reason);
    isConnected = false;
  });

  socket.on('connect_error', (err) => {
    console.error('❌ Error:', err.message);
    isConnected = false;
  });
}

// API endpoint - returns the exact WebSocket data
app.get('/api/data', (req, res) => {
  if (!latestQuoteData) {
    return res.json({ error: 'No data yet', connected: isConnected });
  }
  res.json(latestQuoteData);
});

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    connected: isConnected,
    hasData: latestQuoteData !== null,
    timestamp: new Date().toISOString()
  });
});

// Health check for Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok', connected: isConnected });
});

// Home page
app.get('/', (req, res) => {
  res.json({
    service: 'WF Gold Scraper',
    connected: isConnected,
    hasData: latestQuoteData !== null,
    endpoints: {
      data: '/api/data',
      status: '/api/status',
      health: '/health'
    }
  });
});

// Start
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  connectWFGold();
});
