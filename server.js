const express = require("express");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const app = express();

let latestQuotes = {};
let connected = false;
let lastMessages = [];

function addLog(msg) {
    console.log(msg);

    lastMessages.push({
        time: new Date().toISOString(),
        message: msg
    });

    if (lastMessages.length > 100) {
        lastMessages.shift();
    }
}

function connectWebSocket() {
    addLog("Connecting to websocket...");

    const ws = new WebSocket(
        "wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket",
        {
            rejectUnauthorized: false
        }
    );

    ws.on("open", () => {
        connected = true;
        addLog("WebSocket connected");

        // Try joining namespace
        setTimeout(() => {
            try {
                addLog("SEND: 40/bquote");
                ws.send("40/bquote");
            } catch (e) {
                addLog("ERROR sending namespace connect: " + e.message);
            }
        }, 1000);
    });

    ws.on("message", (data) => {
        const msg = data.toString();

        addLog("RECV: " + msg);

        // Engine.IO ping
        if (msg === "2") {
            addLog("SEND: 3");
            ws.send("3");
            return;
        }

        // Engine.IO open packet
        if (msg.startsWith("0")) {
            addLog("Engine.IO open received");
            return;
        }

        // Namespace connected
        if (msg.startsWith("40/bquote")) {
            addLog("Connected to /bquote namespace");
            return;
        }

        // Socket.IO event
        if (msg.startsWith("42/bquote,")) {
            try {
                const payload = JSON.parse(
                    msg.substring("42/bquote,".length)
                );

                const eventName = payload[0];
                const eventData = payload[1];

                addLog(`EVENT: ${eventName}`);

                if (
                    eventName === "quote.realtime" &&
                    eventData &&
                    eventData.products
                ) {
                    latestQuotes = eventData.products;

                    addLog(
                        `Quotes updated. Symbols=${Object.keys(latestQuotes).length}`
                    );

                    if (latestQuotes.XAU) {
                        addLog(
                            `XAU BUY=${latestQuotes.XAU.buy} SELL=${latestQuotes.XAU.sell}`
                        );
                    }
                }
            } catch (err) {
                addLog("JSON PARSE ERROR: " + err.message);
            }
        }
    });

    ws.on("error", (err) => {
        addLog("WebSocket error: " + err.message);
    });

    ws.on("close", (code, reason) => {
        connected = false;

        addLog(
            `WebSocket closed. Code=${code} Reason=${reason?.toString()}`
        );

        setTimeout(() => {
            connectWebSocket();
        }, 5000);
    });
}

connectWebSocket();

app.get("/", (req, res) => {
    res.json({
        status: connected ? "connected" : "disconnected",
        symbols: Object.keys(latestQuotes).length,
        xau: latestQuotes?.XAU || null
    });
});

app.get("/quotes", (req, res) => {
    res.json(latestQuotes);
});

app.get("/quote/:symbol", (req, res) => {
    const symbol = req.params.symbol;

    res.json(latestQuotes[symbol] || {});
});

app.get("/debug", (req, res) => {
    res.json(lastMessages);
});

app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
});
