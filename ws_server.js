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
    console.log('🔄 Connecting to WebSocket...');
    
    // Use the token-based WebSocket connection
    const ws = new WebSocket('wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket', {
        rejectUnauthorized: false
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
            console.log('📨 RAW MESSAGE:', message);
            
            allMessages.push({
                timestamp: new Date().toISOString(),
                raw: message,
                type: getMessageType(message)
            });
            
            if (allMessages.length > 200) {
                allMessages.shift();
            }
            
            // Handle different message types
            if (message === '3') {
                console.log('✅ Ping response received');
                return;
            }
            
            if (message === '40') {
                console.log('✅ Handshake acknowledged');
                return;
            }
            
            // Parse Socket.IO events
            if (message.startsWith('42')) {
                try {
                    // Handle the specific format: 42/bquote,["quote.realtime",{...}]
                    let parsed;
                    let jsonStr = message.substring(2);
                    
                    // Check if it's the bquote format
                    if (jsonStr.startsWith('/bquote,')) {
                        jsonStr = jsonStr.substring(8); // Remove '/bquote,'
                        parsed = JSON.parse(jsonStr);
                        console.log('📊 BQUOTE DATA:', JSON.stringify(parsed, null, 2));
                    } else {
                        parsed = JSON.parse(jsonStr);
                        console.log('📊 PARSED DATA:', JSON.stringify(parsed, null, 2));
                    }
                    
                    // Extract LLG price from the data
                    extractLLGPrice(parsed);
                    
                } catch (e) {
                    console.log('⚠️ Could not parse JSON:', e.message);
                }
            }
            
        } catch (e) {
            console.log('⚠️ Error processing message:', e.message);
        }
    });
    
    ws.on('error', function error(err) {
        console.error('❌ WebSocket error:', err.message);
    });
    
    ws.on('close', function close(code, reason) {
        console.log(`🔌 WebSocket disconnected. Code: ${code}, Reason: ${reason || 'No reason provided'}`);
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

function getMessageType(message) {
    if (message === '3') return 'ping-response';
    if (message === '40') return 'handshake-ack';
    if (message.startsWith('0')) return 'handshake';
    if (message.startsWith('42')) return 'event';
    if (message.startsWith('2')) return 'ping';
    return 'unknown';
}

function extractLLGPrice(data) {
    // Look for the quote.realtime data structure
    if (Array.isArray(data) && data[0] === 'quote.realtime') {
        const quoteData = data[1];
        if (quoteData && quoteData.products) {
            // XAU= is the LLG product
            if (quoteData.products['XAU=']) {
                const price = quoteData.products['XAU='].buy;
                if (price && !isNaN(parseFloat(price))) {
                    currentPrice = price;
                    lastUpdate = Date.now();
                    console.log(`💰 LLG Price updated: ${currentPrice}`);
                }
            }
        }
    }
    
    // Also search recursively for any XAU= data
    const searchForXAU = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        
        // Check if this object has XAU=
        if (obj['XAU=']) {
            const price = obj['XAU='].buy;
            if (price && !isNaN(parseFloat(price))) {
                currentPrice = price;
                lastUpdate = Date.now();
                console.log(`💰 LLG Price found: ${currentPrice}`);
            }
        }
        
        // Recursively search
        Object.values(obj).forEach(value => {
            if (typeof value === 'object' && value !== null) {
                searchForXAU(value);
            }
        });
    };
    
    searchForXAU(data);
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
        messages: allMessages.slice(-50) // Return last 50 messages
    });
});

app.get('/api/llg', (req, res) => {
    if (currentPrice) {
        res.json({
            bid: currentPrice,
            timestamp: lastUpdate,
            source: 'websocket',
            connected: wsConnection && wsConnection.readyState === WebSocket.OPEN,
            product: 'LLG'
        });
    } else {
        res.status(503).json({
            error: 'No price data available yet',
            connected: wsConnection && wsConnection.readyState === WebSocket.OPEN,
            messagesReceived: allMessages.length,
            lastMessages: allMessages.slice(-5).map(m => m.raw)
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ HTTP server running on port ${PORT}`);
    connectWebSocket();
});
