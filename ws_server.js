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
    
    const ws = new WebSocket('wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket', {
        rejectUnauthorized: false
    });
    
    ws.on('open', function open() {
        console.log('✅ WebSocket connected!');
        reconnectAttempts = 0;
        
        // Complete Socket.IO handshake with auth
        // 40 = Socket.IO connection message with auth
        const handshake = JSON.stringify({
            token: 'applepieapplepieapplepieapplepie'
        });
        ws.send('40' + handshake);
        console.log('📤 Sent Socket.IO handshake with auth:', handshake);
    });
    
    ws.on('message', function incoming(data) {
        try {
            const message = data.toString();
            console.log('📨 Received:', message);
            
            // Socket.IO ping response
            if (message === '3') {
                console.log('✅ Ping response received');
                return;
            }
            
            // Socket.IO handshake acknowledgment with session
            if (message.startsWith('40') && message.length > 2) {
                console.log('✅ Handshake acknowledged with session');
                return;
            }
            
            // Check for price data (Socket.IO event format)
            if (message.startsWith('42')) {
                const jsonStr = message.substring(2);
                const parsed = JSON.parse(jsonStr);
                console.log('📊 Parsed data:', JSON.stringify(parsed));
                
                // Handle array format: ["eventName", data]
                if (Array.isArray(parsed)) {
                    const eventName = parsed[0];
                    const eventData = parsed[1];
                    
                    // Look for price data
                    if (eventName === 'price' || eventName === 'update' || eventName === 'data') {
                        if (eventData && typeof eventData === 'object') {
                            // Check for LLG in various formats
                            if (eventData.product === 'LLG' && eventData.bid) {
                                currentPrice = eventData.bid;
                                lastUpdate = Date.now();
                                console.log('💰 LLG Bid updated:', currentPrice);
                            }
                            // Check if LLG is nested
                            if (eventData.LLG && eventData.LLG.bid) {
                                currentPrice = eventData.LLG.bid;
                                lastUpdate = Date.now();
                                console.log('💰 LLG Bid updated:', currentPrice);
                            }
                            // Check for array of products
                            if (Array.isArray(eventData)) {
                                eventData.forEach(item => {
                                    if (item && item.product === 'LLG' && item.bid) {
                                        currentPrice = item.bid;
                                        lastUpdate = Date.now();
                                        console.log('💰 LLG Bid updated:', currentPrice);
                                    }
                                });
                            }
                            // Check all keys for LLG
                            Object.keys(eventData).forEach(key => {
                                if (key === 'LLG' || key === 'llg') {
                                    if (eventData[key] && eventData[key].bid) {
                                        currentPrice = eventData[key].bid;
                                        lastUpdate = Date.now();
                                        console.log('💰 LLG Bid updated:', currentPrice);
                                    }
                                }
                            });
                        }
                    }
                }
                // Handle object format directly
                else if (parsed && typeof parsed === 'object') {
                    if (parsed.product === 'LLG' && parsed.bid) {
                        currentPrice = parsed.bid;
                        lastUpdate = Date.now();
                        console.log('💰 LLG Bid updated:', currentPrice);
                    }
                }
            }
        } catch (e) {
            console.log('⚠️ Error parsing message:', e.message);
        }
    });
    
    ws.on('error', function error(err) {
        console.error('❌ WebSocket error:', err.message);
    });
    
    ws.on('close', function close(code, reason) {
        console.log(`🔌 WebSocket disconnected. Code: ${code}, Reason: ${reason || 'No reason provided'}`);
        wsConnection = null;
        
        // Exponential backoff reconnect
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

// Keep connection alive with regular pings
setInterval(() => {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.send('2');
        console.log('📤 Sent keep-alive ping');
    }
}, 15000);

app.get('/api/llg', (req, res) => {
    if (currentPrice) {
        res.json({
            bid: currentPrice,
            timestamp: lastUpdate,
            source: 'websocket',
            connected: wsConnection && wsConnection.readyState === WebSocket.OPEN
        });
    } else {
        res.status(503).json({
            error: 'No price data available yet',
            connected: wsConnection && wsConnection.readyState === WebSocket.OPEN,
            status: 'Waiting for data'
        });
    }
});

app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        connected: wsConnection && wsConnection.readyState === WebSocket.OPEN,
        price: currentPrice || 'Not fetched',
        lastUpdate: lastUpdate ? new Date(lastUpdate).toISOString() : null
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ HTTP server running on port ${PORT}`);
    connectWebSocket();
});
