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
        
        // Step 1: Send the Socket.IO handshake (required!)
        ws.send('40');
        console.log('📤 Sent Socket.IO handshake (40)');
        
        // Step 2: After handshake, send ping to keep connection alive
        setTimeout(() => {
            ws.send('2');
            console.log('📤 Sent ping (2)');
        }, 1000);
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
            
            // Socket.IO handshake acknowledgment
            if (message.startsWith('40')) {
                console.log('✅ Handshake acknowledged');
                return;
            }
            
            // Check for price data (Socket.IO event format: 42["event", data])
            if (message.startsWith('42')) {
                const jsonStr = message.substring(2);
                const parsed = JSON.parse(jsonStr);
                
                // Handle array format: ["eventName", data]
                if (Array.isArray(parsed)) {
                    const eventName = parsed[0];
                    const eventData = parsed[1];
                    
                    if (eventName === 'price' || eventName === 'update') {
                        if (eventData && eventData.product === 'LLG') {
                            currentPrice = eventData.bid;
                            lastUpdate = Date.now();
                            console.log('💰 LLG Bid updated:', currentPrice);
                        }
                        // If data is nested differently
                        else if (eventData && eventData.LLG) {
                            currentPrice = eventData.LLG.bid;
                            lastUpdate = Date.now();
                            console.log('💰 LLG Bid updated:', currentPrice);
                        }
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
            // Not JSON or not price data - ignore
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
            connected: wsConnection !== null,
            status: 'Waiting for data'
        });
    }
});

app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        connected: wsConnection !== null,
        price: currentPrice || 'Not fetched',
        lastUpdate: lastUpdate ? new Date(lastUpdate).toISOString() : null
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ HTTP server running on port ${PORT}`);
    connectWebSocket();
});
