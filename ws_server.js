const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());

// Add this route handler for the root URL
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

let currentPrice = null;
let lastUpdate = 0;
let wsConnection = null;
let reconnectAttempts = 0;
let allMessages = [];

function connectWebSocket() {
    console.log('🔄 Connecting to WebSocket...');
    
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
            
            if (allMessages.length > 100) {
                allMessages.shift();
            }
            
            if (message === '3') {
                console.log('✅ Ping response received');
                return;
            }
            
            if (message === '40') {
                console.log('✅ Handshake acknowledged');
                ws.send('42["subscribe","LLG"]');
                console.log('📤 Sent subscription for LLG');
                return;
            }
            
            if (message.startsWith('42')) {
                try {
                    const jsonStr = message.substring(2);
                    const parsed = JSON.parse(jsonStr);
                    console.log('📊 PARSED DATA:', JSON.stringify(parsed, null, 2));
                    findLLGPrice(parsed);
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

function findLLGPrice(data) {
    const searchLLG = (obj, path = '') => {
        if (!obj || typeof obj !== 'object') return;
        
        if (obj.product === 'LLG' && obj.bid) {
            currentPrice = obj.bid;
            lastUpdate = Date.now();
            console.log(`🎯 FOUND LLG at ${path}:`, obj);
            console.log(`💰 LLG Bid: ${obj.bid}, Ask: ${obj.ask || 'N/A'}`);
            return;
        }
        
        Object.keys(obj).forEach(key => {
            if (key === 'LLG' || key === 'llg') {
                const value = obj[key];
                if (value && typeof value === 'object') {
                    if (value.bid) {
                        currentPrice = value.bid;
                        lastUpdate = Date.now();
                        console.log(`🎯 FOUND LLG at ${path}.${key}:`, value);
                        console.log(`💰 LLG Bid: ${value.bid}, Ask: ${value.ask || 'N/A'}`);
                    }
                }
            }
            
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                searchLLG(obj[key], `${path}.${key}`);
            }
        });
        
        if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                if (typeof item === 'object' && item !== null) {
                    searchLLG(item, `${path}[${index}]`);
                }
            });
        }
    };
    
    searchLLG(data);
}

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

app.get('/api/llg', (req, res) => {
    if (currentPrice) {
        res.json({
            bid: currentPrice,
            timestamp: lastUpdate,
            source: 'websocket',
            connected: wsConnection && wsConnection.readyState === WebSocket.OPEN,
            lastMessage: allMessages.length > 0 ? allMessages[allMessages.length - 1] : null
        });
    } else {
        res.status(503).json({
            error: 'No price data available yet',
            connected: wsConnection && wsConnection.readyState === WebSocket.OPEN,
            messagesReceived: allMessages.length,
            lastMessage: allMessages.length > 0 ? allMessages[allMessages.length - 1] : null
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ HTTP server running on port ${PORT}`);
    connectWebSocket();
});
