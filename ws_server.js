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
    
    // IMPORTANT: Disable certificate verification for this specific connection
    const ws = new WebSocket('wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket', {
        rejectUnauthorized: false  // This bypasses certificate verification
    });
    
    ws.on('open', function open() {
    console.log('✅ WebSocket connected!');
    reconnectAttempts = 0;
    ws.send('40');
    
    // Send subscription request for LLG price
    setTimeout(() => {
        ws.send('42["subscribe","LLG"]');
        console.log('📤 Sent subscription for LLG');
    }, 500);
});
    
    ws.on('message', function incoming(data) {
        try {
            const message = data.toString();
            
            // Look for price data in the messages
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
                // Handle object format directly
                else if (parsed && parsed.product === 'LLG') {
                    currentPrice = parsed.bid;
                    lastUpdate = Date.now();
                    console.log('💰 LLG Bid updated:', currentPrice);
                }
            }
        } catch (e) {
            // Silent ignore for non-JSON messages
        }
    });
    
    ws.on('error', function error(err) {
        console.error('❌ WebSocket error:', err.message);
    });
    
    ws.on('close', function close() {
        console.log('🔌 WebSocket disconnected. Reconnecting...');
        wsConnection = null;
        
        setTimeout(() => {
            if (reconnectAttempts < 20) {
                reconnectAttempts++;
                connectWebSocket();
            }
        }, 3000);
    });
    
    wsConnection = ws;
}

app.get('/api/llg', (req, res) => {
    if (currentPrice) {
        res.json({
            bid: currentPrice,
            timestamp: lastUpdate,
            source: 'websocket'
        });
    } else {
        res.status(503).json({
            error: 'No price data available yet',
            connected: wsConnection !== null
        });
    }
});

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
