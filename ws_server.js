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
let subscriptionSent = false;

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
    subscriptionSent = false;
    
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
            
            // Only log important messages to avoid spam
            if (message.startsWith('42/bquote,')) {
                console.log('📨 BQUOTE MESSAGE RECEIVED');
            } else if (message !== '3') {
                console.log('📨 RAW MESSAGE:', message);
            }
            
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
                // Ping response - ignore
                return;
            }
            
            if (message === '40') {
                console.log('✅ Handshake acknowledged');
                // Send subscription immediately after handshake
                setTimeout(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        // This is the correct subscription format based on your browser
                        const subMsg = '42/bquote,["subscribe",{"channel":"quote.realtime"}]';
                        ws.send(subMsg);
                        console.log(`📤 Sent subscription: ${subMsg}`);
                        subscriptionSent = true;
                    }
                }, 500);
                return;
            }
            
            // Parse bquote messages
            if (message.startsWith('42/bquote,')) {
                try {
                    // Extract the JSON part after '/bquote,'
                    const jsonStr = message.substring(10); // Remove '42/bquote,'
                    const parsed = JSON.parse(jsonStr);
                    
                    // Look for the price data
                    extractLLGPrice(parsed);
                    
                } catch (e) {
                    console.log('⚠️ Could not parse bquote:', e.message);
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
        subscriptionSent = false;
        
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
    if (message.startsWith('42/bquote,')) return 'bquote';
    if (message.startsWith('42')) return 'event';
    if (message.startsWith('2')) return 'ping';
    return 'unknown';
}

function extractLLGPrice(data) {
    // The data structure from your message:
    // ["quote.realtime", {"products": {"XAU=": {"buy": "4315.3"}}}]
    
    if (Array.isArray(data)) {
        // Check if this is the quote.realtime array
        if (data[0] === 'quote.realtime') {
            const quoteData = data[1];
            if (quoteData && quoteData.products && quoteData.products['XAU=']) {
                const xau = quoteData.products['XAU='];
                const price = xau.buy;
                if (price && !isNaN(parseFloat(price))) {
                    currentPrice = price;
                    lastUpdate = Date.now();
                    console.log(`💰 LLG Price updated: ${currentPrice}`);
                }
            }
        }
    }
    
    // Also search recursively for XAU=
    const searchForXAU = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        
        if (obj['XAU=']) {
            const price = obj['XAU='].buy;
            if (price && !isNaN(parseFloat(price))) {
                currentPrice = price;
                lastUpdate = Date.now();
                console.log(`💰 LLG Price found: ${currentPrice}`);
                return;
            }
        }
        
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
        messages: allMessages.slice(-20).map(m => ({
            timestamp: m.timestamp,
            raw: m.raw.length > 200 ? m.raw.substring(0, 200) + '...' : m.raw,
            type: m.type
        }))
    });
});

app.get('/api/llg', (req, res) => {
    if (currentPrice) {
        res.json({
            bid: currentPrice,
            timestamp: lastUpdate,
            source: 'websocket',
            connected: wsConnection && wsConnection.readyState === WebSocket.OPEN,
            product: 'LLG (XAU=)',
            subscriptionSent: subscriptionSent
        });
    } else {
        res.status(503).json({
            error: 'No price data available yet',
            connected: wsConnection && wsConnection.readyState === WebSocket.OPEN,
            messagesReceived: allMessages.length,
            subscriptionSent: subscriptionSent,
            lastMessages: allMessages.slice(-5).map(m => 
                m.raw.length > 100 ? m.raw.substring(0, 100) + '...' : m.raw
            )
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ HTTP server running on port ${PORT}`);
    connectWebSocket();
});
