const express = require("express");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const app = express();

let latestQuotes = {};
let connected = false;

function connectWebSocket() {
    const ws = new WebSocket(
        "wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket"
    );

    ws.on("open", () => {
        console.log("WebSocket connected");
        connected = true;
    });

    ws.on("message", (data) => {
        const msg = data.toString();

        // Engine.IO ping
        if (msg === "2") {
            ws.send("3");
            return;
        }

        if (msg.startsWith("42/bquote,")) {
            try {
                const packet = JSON.parse(
                    msg.substring("42/bquote,".length)
                );

                const eventName = packet[0];
                const payload = packet[1];

                if (eventName === "quote.realtime") {
                    latestQuotes = payload.products || {};

                    console.log(
                        "Updated:",
                        new Date().toISOString(),
                        "XAU:",
                        latestQuotes?.XAU?.buy
                    );
                }
            } catch (err) {
                console.error(err);
            }
        }
    });

    ws.on("close", () => {
        console.log("WebSocket closed");
        connected = false;

        setTimeout(connectWebSocket, 5000);
    });

    ws.on("error", (err) => {
        console.error("WebSocket error:", err.message);
    });
}

connectWebSocket();

app.get("/", (req, res) => {
    res.json({
        status: connected ? "connected" : "disconnected",
        symbols: Object.keys(latestQuotes).length
    });
});

app.get("/quotes", (req, res) => {
    res.json(latestQuotes);
});

app.get("/quote/:symbol", (req, res) => {
    const symbol = req.params.symbol;

    res.json(latestQuotes[symbol] || {});
});

app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
});
