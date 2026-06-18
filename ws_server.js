const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());

let currentPrice = null;
let lastUpdate = 0;
let ws = null;
let reconnectAttempts = 0;
let messageCount = 0;

app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        price: currentPrice || 'Not fetched',
        connected: ws && ws.readyState === WebSocket.OPEN,
        messages: messageCount
    });
});

function connectWebSocket() {
    console.log('🔄 Connecting to WebSocket...');
    
    const wsUrl = 'wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket';
    
    ws = new WebSocket(wsUrl, {
        rejectUnauthorized: false,
        headers: {
            'Origin': 'https://www.wfgold.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
    
    ws.on('open', function() {
        console.log('✅ WebSocket connected!');
        reconnectAttempts = 0;
        ws.send('40');
        console.log('📤 Sent handshake (40)');
        
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send('42/bquote,["subscribe",{"channel":"quote.realtime"}]');
                console.log('📤 Sent subscription');
            }
        }, 1000);
    });
    
    ws.on('message', function(data) {
        const msg = data.toString();
        messageCount++;
        
        // Log only when we get data
        if (msg.includes('"XAU="')) {
            const match = msg.match(/"XAU="[^}]*"buy":"([0-9.]+)"/);
            if (match && match[1]) {
                currentPrice = match[1];
                lastUpdate = Date.now();
                console.log(`💰 LLG Price: ${currentPrice}`);
            }
        }
        
        // Log first 100 chars of each message for debugging
        if (msg !== '3' && msg !== '40' && !msg.startsWith('0')) {
            console.log(`📨 ${msg.substring(0, 100)}${msg.length > 100 ? '...' : ''}`);
        }
    });
    
    ws.on('error', function(err) {
        console.error('❌ WebSocket error:', err.message);
    });
    
    ws.on('close', function() {
        console.log('🔌 WebSocket disconnected');
        ws = null;
        
        const delay = Math.min(5000 * Math.pow(1.5, reconnectAttempts), 30000);
        console.log(`⏳ Reconnecting in ${delay/1000}s...`);
        setTimeout(() => {
            reconnectAttempts++;
            connectWebSocket();
        }, delay);
    });
}

// Keep connection alive
setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send('2');
    }
}, 15000);

app.get('/api/llg', (req, res) => {
    if (currentPrice) {
        res.json({
            bid: currentPrice,
            timestamp: lastUpdate,
            connected: ws && ws.readyState === WebSocket.OPEN,
            messages: messageCount
        });
    } else {
        res.status(503).json({
            error: 'No price data available',
            connected: ws && ws.readyState === WebSocket.OPEN,
            messages: messageCount
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    connectWebSocket();
});
