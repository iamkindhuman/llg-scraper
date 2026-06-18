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
let bquoteReceived = false;

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
    
    const ws = new WebSocket('wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket', {
        rejectUnauthorized: false,
        headers: {
            'Origin': 'https://www.wfgold.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
            
            // Log ALL messages for debugging
            console.log('📨 RECEIVED:', message.substring(0, 200) + (message.length > 200 ? '...' : ''));
            
            allMessages.push({
                timestamp: new Date().toISOString(),
                raw: message
            });
            
            if (allMessages.length > 100) {
                allMessages.shift();
            }
            
            // Handle different message types
            if (message === '3') {
                console.log('✅ Ping response');
                return;
            }
            
            if (message === '40') {
                console.log('✅ Handshake acknowledged');
                // Try multiple subscription formats
                setTimeout(() => {
                    const formats = [
                        '42/bquote,["subscribe",{"channel":"quote.realtime"}]',
                        '42["subscribe","quote.realtime"]',
                        '42["subscribe","XAU="]',
                        '42["join","quote.realtime"]',
                        '42/bquote,["subscribe","quote.realtime"]',
                        '42["subscribe","LLG"]'
                    ];
                    formats.forEach((format, i) => {
                        setTimeout(() => {
                            if (ws && ws.readyState === WebSocket.OPEN) {
                                ws.send(format);
                                console.log(`📤 Sent (${i+1}): ${format}`);
                            }
                        }, i * 500);
                    });
                }, 500);
                return;
            }
            
            // Check for bquote messages directly
            if (message.includes('bquote') || message.includes('quote.realtime')) {
                console.log('🎯 BQUOTE MESSAGE FOUND!');
                bquoteReceived = true;
                
                // Try to extract the price directly from the raw message
                // Look for "XAU=" followed by the price
                const match = message.match(/"XAU="[^}]*"buy":"([0-9.]+)"/);
                if (match && match[1]) {
                    const price = match[1];
                    if (price && !isNaN(parseFloat(price))) {
                        currentPrice = price;
                        lastUpdate = Date.now();
                        console.log(`💰 LLG Price updated: ${currentPrice}`);
                    }
                }
                
                // Alternative: look for "LLG" in the message
                if (!currentPrice) {
                    const llgMatch = message.match(/"LLG"[^}]*"buy":"([0-9.]+)"/);
                    if (llgMatch && llgMatch[1]) {
                        currentPrice = llgMatch[1];
                        lastUpdate = Date.now();
                        console.log(`💰 LLG Price found via LLG: ${currentPrice}`);
                    }
                }
            }
            
            // Try to parse any JSON in the message
            try {
                // Look for anything that looks like a price
                const priceMatch = message.match(/"buy":"([0-9.]+)"/);
                if (priceMatch && priceMatch[1]) {
                    // Check if this is likely LLG (around 4000-4500)
                    const price = parseFloat(priceMatch[1]);
                    if (price > 4000 && price < 5000) {
                        currentPrice = priceMatch[1];
                        lastUpdate = Date.now();
                        console.log(`💰 LLG Price (likely): ${currentPrice}`);
                    }
                }
            } catch(e) {}
            
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
        bquoteReceived = false;
        
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
        messages: allMessages.slice(-20).map(m => ({
            timestamp: m.timestamp,
            raw: m.raw.length > 500 ? m.raw.substring(0, 500) + '...' : m.raw
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
            bquoteReceived: bquoteReceived
        });
    } else {
        res.status(503).json({
            error: 'No price data available yet',
            connected: wsConnection && wsConnection.readyState === WebSocket.OPEN,
            messagesReceived: allMessages.length,
            bquoteReceived: bquoteReceived,
            lastMessages: allMessages.slice(-5).map(m => 
                m.raw.length > 200 ? m.raw.substring(0, 200) + '...' : m.raw
            )
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ HTTP server running on port ${PORT}`);
    connectWebSocket();
});
