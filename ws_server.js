const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());

let currentPrice = null;
let lastUpdate = 0;
let wsConnection = null;
let reconnectAttempts = 0;

function connectWebSocket() {
    console.log('🔄 Connecting to WebSocket...');
    
    const ws = new WebSocket('wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket');
    
    ws.on('open', function open() {
        console.log('✅ WebSocket connected!');
        reconnectAttempts = 0;
        // Send Socket.IO handshake
        ws.send('40');
    });
    
    ws.on('message', function incoming(data) {
        try {
            const message = data.toString();
            
            // Socket.IO messages: "42" + JSON
            if (message.startsWith('42')) {
                const jsonStr = message.substring(2);
                const parsed = JSON.parse(jsonStr);
                
                // Handle array format: ["eventName", data]
                if (Array.isArray(parsed) && parsed[0] === 'price') {
                    const priceData = parsed[1];
                    if (priceData && priceData.product === 'LLG') {
                        currentPrice = priceData.bid;
                        lastUpdate = Date.now();
                        console.log('💰 LLG Bid updated:', currentPrice);
                    }
                }
                // Handle object format
                else if (parsed && parsed.product === 'LLG') {
                    currentPrice = parsed.bid;
                    lastUpdate = Date.now();
                    console.log('💰 LLG Bid updated:', currentPrice);
                }
            }
        } catch (e) {
            // Not JSON or not price data
        }
    });
    
    ws.on('error', function error(err) {
        console.error('❌ WebSocket error:', err.message);
    });
    
    ws.on('close', function close() {
        console.log('🔌 WebSocket disconnected. Reconnecting...');
        wsConnection = null;
        
        // Reconnect after delay
        setTimeout(() => {
            if (reconnectAttempts < 10) {
                reconnectAttempts++;
                connectWebSocket();
            }
        }, 3000);
    });
    
    wsConnection = ws;
}

// API endpoint for getting the latest LLG price
app.get('/api/llg', (req, res) => {
    if (currentPrice) {
        res.json({
            bid: currentPrice,
            timestamp: lastUpdate,
            source: 'websocket'
        });
    } else {
        res.status(503).json({
            error: 'No price data available yet'
        });
    }
});

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        connected: wsConnection !== null,
        price: currentPrice || 'Not fetched'
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ HTTP server running on port ${PORT}`);
    connectWebSocket();
});
