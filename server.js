const express = require("express");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory storage only - NO disk writes, NO database
let connected = false;
let latestData = {
    xau: null,
    xag: null,
    eur: null,
    gbp: null,
    jpy: null,
    timestamp: null
};

function connect() {
    const ws = new WebSocket(
        "wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket",
        {
            rejectUnauthorized: false,
            // Prevent memory leaks
            maxPayload: 1024 * 100, // 100KB max message size
        }
    );

    ws.on("open", () => {
        connected = true;
        console.log("✅ Connected to WF Gold");
        
        // Send subscription immediately
        setTimeout(() => {
            ws.send("40/bquote");
        }, 500);
    });

    ws.on("message", (data) => {
        const msg = data.toString();

        // ping -> pong (keep alive)
        if (msg === "2") {
            ws.send("3");
            return;
        }

        // Only process quote messages
        if (!msg.startsWith("42/bquote,")) {
            return;
        }

        try {
            const packet = JSON.parse(
                msg.substring("42/bquote,".length)
            );

            if (packet[0] !== "quote.realtime") return;

            const products = packet[1]?.products;
            if (!products) return;

            // Update only what we need (minimal memory)
            const timestamp = new Date().toISOString();
            
            if (products["XAU="]) {
                latestData.xau = {
                    buy: products["XAU="].buy,
                    sell: products["XAU="].sell,
                    high: products["XAU="].dayhigh,
                    low: products["XAU="].daylow
                };
            }
            
            if (products["XAG="]) {
                latestData.xag = {
                    buy: products["XAG="].buy,
                    sell: products["XAG="].sell
                };
            }
            
            if (products["EUR="]) {
                latestData.eur = {
                    buy: products["EUR="].buy,
                    sell: products["EUR="].sell
                };
            }
            
            if (products["GBP="]) {
                latestData.gbp = {
                    buy: products["GBP="].buy,
                    sell: products["GBP="].sell
                };
            }
            
            if (products["JPY="]) {
                latestData.jpy = {
                    buy: products["JPY="].buy,
                    sell: products["JPY="].sell
                };
            }
            
            latestData.timestamp = timestamp;

            // Log only every 60 seconds to avoid console spam
            if (Math.floor(Date.now() / 1000) % 60 === 0) {
                console.log(`📊 XAU: $${latestData.xau?.buy || '--'}`);
            }

        } catch (e) {
            // Silent fail - no logging to save resources
        }
    });

    ws.on("close", () => {
        connected = false;
        console.log("🔴 Disconnected, reconnecting in 5s...");
        // Clear timeout references to prevent memory leaks
        setTimeout(connect, 5000);
    });

    ws.on("error", (err) => {
        // Only log critical errors
        if (err.message !== 'unable to verify the first certificate') {
            console.error("WebSocket error:", err.message);
        }
    });
    
    // Return ws reference for cleanup
    return ws;
}

// Start connection
let ws = connect();

// Minimal API endpoints
app.get("/", (req, res) => {
    res.json({
        connected,
        lastUpdate: latestData.timestamp,
        xau: latestData.xau
    });
});

app.get("/buy", (req, res) => {
    res.send(latestData.xau?.buy || "");
});

app.get("/sell", (req, res) => {
    res.send(latestData.xau?.sell || "");
});

// Bonus: Get all prices
app.get("/all", (req, res) => {
    res.json(latestData);
});

// Health check for Render
app.get("/health", (req, res) => {
    res.json({ 
        status: connected ? "ok" : "error",
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed / 1024 / 1024
    });
});

// Cleanup on shutdown
process.on('SIGTERM', () => {
    console.log('Shutting down...');
    if (ws) ws.terminate();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`💾 Memory usage: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`);
});
