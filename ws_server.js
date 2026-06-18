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
            messages: '/api/messages',
            raw: '/api/raw'
        }
    });
});

function connectWebSocket() {
    console.log('🔄 Connecting to WebSocket...');
    
    // Try without token first
    const ws = new WebSocket('wss://quote.wfgold.com:8082/socket.io/?EIO=3&transport=websocket', {
        rejectUnauthorized: false
    });
    
    ws.on('open', function open() {
        console.log('✅ WebSocket connected!');
        reconnectAttempts = 0;
        // Just send handshake, no subscription
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
            
            // Parse any JSON data
            if (message.startsWith('42')) {
                try {
                    const jsonStr = message.substring(2);
                    const parsed = JSON.parse(jsonStr);
                    console.log('📊 PARSED DATA:', JSON.stringify(parsed, null, 2));
                    
                    // Look for any numbers that could be prices
                    const found = findAnyPrice(parsed);
                    if (found) {
                        console.log('🎯 POTENTIAL PRICE FOUND!');
                    }
                } catch (e) {
                    console.log('⚠️ Could not parse JSON:', e.message);
                }
            }
            
            // If it's a plain number, it might be a price
            if (/^\d+\.\d+$/.test(message)) {
                console.log('💰 POSSIBLE PRICE:', message);
                if (!currentPrice) {
                    currentPrice = message;
                    lastUpdate = Date.now();
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
    if (/^\d+\.\d+$/.test(message)) return 'possible-price';
    return 'unknown';
}

function findAnyPrice(data) {
    let found = false;
    const searchForNumbers = (obj, path = '') => {
        if (!obj || typeof obj !== 'object') return;
        
        // If it's an array, check each item
        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                if (typeof item === 'object' && item !== null) {
                    searchForNumbers(item, `${path}[${index}]`);
                } else if (typeof item === 'string' && /^\d+\.\d+$/.test(item)) {
                    console.log(`💰 Found number at ${path}[${index}]:`, item);
                    if (!currentPrice) {
                        currentPrice = item;
                        lastUpdate = Date.now();
                    }
                    found = true;
                }
            });
            return;
        }
        
        // Check all keys
        Object.keys(obj).forEach(key => {
            const value = obj[key];
            
            // Check if value is a number string
            if (typeof value === 'string' && /^\d+\.\d+$/.test(value)) {
                console.log(`💰 Found number at ${path}.${key}:`, value);
                if (!currentPrice) {
                    currentPrice = value;
                    lastUpdate = Date.now();
                }
                found = true;
            }
            
            // Check if value is a number
            if (typeof value === 'number' && value > 0) {
                console.log(`💰 Found number at ${path}.${key}:`, value);
                if (!currentPrice) {
                    currentPrice = value.toString();
                    lastUpdate = Date.now();
                }
                found = true;
            }
            
            // Recursively search
            if (typeof value === 'object' && value !== null) {
                searchForNumbers(value, `${path}.${key}`);
            }
        });
    };
    
    searchForNumbers(data);
    return found;
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
        messages: allMessages
    });
});

app.get('/api/raw', (req, res) => {
    // Return only the raw messages as text
    const raw = allMessages.map(m => m.raw).join('\n');
    res.type('text/plain').send(raw);
});

app.get('/api/llg', (req, res) => {
    if (currentPrice) {
        res.json({
            bid: currentPrice,
            timestamp: lastUpdate,
            source: 'websocket',
            connected: wsConnection && wsConnection.readyState === WebSocket.OPEN,
            totalMessages: allMessages.length
        });
    } else {
        res.status(503).json({
            error: 'No price data available yet',
            connected: wsConnection && wsConnection.readyState === WebSocket.OPEN,
            messagesReceived: allMessages.length,
            raw: allMessages.slice(-10).map(m => m.raw) // Show last 10 messages
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ HTTP server running on port ${PORT}`);
    connectWebSocket();
});
