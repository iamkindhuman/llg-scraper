const express = require("express");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

let connected = false;
let latestXAU = null;
let lastUpdate = null;

function connect() {
    const ws = new WebSocket(
        "wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket",
        {
            rejectUnauthorized: false
        }
    );

    ws.on("open", () => {
        connected = true;

        setTimeout(() => {
            ws.send("40/bquote");
        }, 1000);
    });

    ws.on("message", (data) => {
        const msg = data.toString();

        // ping -> pong
        if (msg === "2") {
            ws.send("3");
            return;
        }

        if (!msg.startsWith("42/bquote,")) {
            return;
        }

        try {
            const packet = JSON.parse(
                msg.substring("42/bquote,".length)
            );

            if (packet[0] !== "quote.realtime") {
                return;
            }

            const products = packet[1]?.products;

            if (!products) {
                return;
            }

            // IMPORTANT: key is XAU=
            if (products["XAU="]) {
                latestXAU = products["XAU="];
                lastUpdate = new Date().toISOString();
            }

        } catch (e) {}
    });

    ws.on("close", () => {
        connected = false;
        setTimeout(connect, 5000);
    });

    ws.on("error", () => {});
}

connect();

app.get("/", (req, res) => {
    res.json({
        connected,
        lastUpdate,
        xau: latestXAU
    });
});

app.get("/buy", (req, res) => {
    res.send(latestXAU?.buy || "");
});

app.get("/sell", (req, res) => {
    res.send(latestXAU?.sell || "");
});

app.listen(PORT, () => {
    console.log(`Server started on ${PORT}`);
});
