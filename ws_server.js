const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const https = require('https');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

let currentPrice = null;
let lastUpdate = 0;
let wsConnection = null;
let reconnectAttempts = 0;
let allMessages = [];

app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        message: 'LLG Scraper is running',
        endpoints: {
            llg: '/api/llg',
            messages: '/api/messages'
        }
    });
});

function connectWebSocket() {
    console.log('🔄 Connecting to WebSocket with browser headers...');
    
    // Use the token-based connection with proper headers
    const ws = new WebSocket('wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket', {
        rejectUnauthorized: false,
        headers: {
            'Origin': 'https://www.wfgold.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version': '13'
        }
    });
    
    ws.on('open', function open() {
        console.log('✅ WebSocket connected!');
        reconnectAttempts = 0;
        ws.send('40');
        console.log('📤 Sent Socket.IO handshake (40)');
    });
    
    ws.on('message', function incoming(data) {
        try {
            const message = data.toString();
            
            // Log all messages
            if (message.startsWith('42/bquote,')) {
                console.log('📨 BQUOTE DATA RECEIVED!');
                // Extract the price immediately
                const match = message.match(/"XAU="[^}]*"buy":"([0-9.]+)"/);
                if (match && match[1]) {
                    currentPrice = match[1];
                    lastUpdate = Date.now();
                    console.log(`💰 LLG Price: ${currentPrice}`);
                }
            } else if (message !== '3') {
                console.log(`📨 Received: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);
            }
            
            // Store all messages for debugging
            allMessages.push({
                timestamp: new Date().toISOString(),
                raw: message.length > 500 ? message.substring(0, 500) + '...' : message
            });
            if (allMessages.length > 100) allMessages.shift();
            
            // Handle handshake
            if (message === '40') {
                console.log('✅ Handshake acknowledged');
                // Send subscription after a delay
                setTimeout(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        const sub = '42/bquote,["subscribe",{"channel":"quote.realtime"}]';
                        ws.send(sub);
                        console.log(`📤 Sent subscription: ${sub}`);
                    }
                }, 1000);
            }
            
        } catch (e) {
            console.log('⚠️ Error processing message:', e.message);
        }
    });
    
    ws.on('error', function error(err) {
        console.error('❌ WebSocket error:', err.message);
    });
    
    ws.on('close', function close(code, reason) {
        console.log(`🔌 WebSocket disconnected. Code: ${code}`);
        wsConnection = null;
        
        const delay = Math.min(3000 * Math.pow(1.5, reconnectAttempts), 30000);
        console.log(`⏳ Reconnecting in ${delay/1000} seconds...`);
        setTimeout(() => {
            if (reconnectAttempts < 20) {
                reconnectAttempts++;
                connectWebSocket();
            }
        }, delay);
    });
    
    wsConnection = ws;
}

// Keep connection alive
setInterval(() => {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.send('2');
        console.log('📤 Sent keep-alive ping');
    }
}, 15000);

app.get('/api/messages', (req, res) => {
    res.json({
        total: allMessages.length,
        messages: allMessages.slice(-20)
    });
});

app.get('/api/llg', (req, res) => {
    if (currentPrice) {
        res.json({
            bid: currentPrice,
            timestamp: lastUpdate,
            source: 'websocket',
            connected: wsConnection && wsConnection.readyState === WebSocket.OPEN,
            messagesReceived: allMessages.length
        });
    } else {
        res.status(503).json({
            error: 'No price data available yet',
            connected: wsConnection && wsConnection.readyState === WebSocket.OPEN,
            messagesReceived: allMessages.length,
            lastMessages: allMessages.slice(-5)
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ HTTP server running on port ${PORT}`);
    connectWebSocket();
});
