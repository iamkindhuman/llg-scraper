const express = require("express");
const WebSocket = require("ws");
const axios = require("axios");

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
    usdmyr: null, // Added for USD/MYR rate
    timestamp: null
};

// USD/MYR rate cache
let cachedUsdMyr = null;
let lastUsdMyrFetch = 0;
const USDMYR_CACHE_DURATION = 5000; // 5 seconds

// Known hash from msgold.com.my
const AJAX_HASH = 'c7345ad4580290c2971b1a5b43b0db0a';
let cachedAjaxUrl = null;

// Function to extract prefix from msgold.com.my
async function extractPrefix() {
    try {
        console.log('🔍 Extracting prefix from msgold.com.my...');
        
        const response = await axios.get('https://msgold.com.my/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache'
            },
            timeout: 15000
        });
        
        const html = response.data;
        
        // Look for: ajax("refg4","PREFIX_"+s+"_HASH","eval","","");
        const match = html.match(/ajax\("refg4","(\d+)_"\+s\+"_([a-f0-9]+)"/);
        
        if (match) {
            const prefix = match[1];
            const hash = match[2];
            console.log('✅ Found prefix:', prefix, 'hash:', hash);
            return { prefix, hash };
        }
        
        console.log('⚠️ Could not find prefix in page');
        return null;
        
    } catch (error) {
        console.error('❌ Error extracting prefix:', error.message);
        return null;
    }
}

// Generate AJAX URL for msgold.com.my
function generateAjaxUrl(prefix, hash) {
    const timestamp = Math.floor(Date.now() / 1000);
    const seed = Math.random();
    const q = `${prefix}_${timestamp}_${hash}`;
    
    return `adminxsettings/__ajax2.php?fn=refg4&m=eval&f=&q=${q}&seed=${seed}`;
}

// Fetch USD/MYR rate from msgold.com.my
async function fetchUsdMyr() {
    try {
        const now = Date.now();
        
        // Return cached rate if fresh enough
        if (cachedUsdMyr && (now - lastUsdMyrFetch) < USDMYR_CACHE_DURATION) {
            return cachedUsdMyr;
        }
        
        console.log('💱 Fetching USD/MYR rate from msgold.com.my...');
        
        // Get fresh prefix if needed
        if (!cachedAjaxUrl) {
            const params = await extractPrefix();
            if (params) {
                cachedAjaxUrl = generateAjaxUrl(params.prefix, params.hash || AJAX_HASH);
            } else {
                // Fallback: try common prefixes
                for (let testPrefix of ['3581', '794', '1360', '2104']) {
                    const testUrl = generateAjaxUrl(testPrefix, AJAX_HASH);
                    console.log('🔄 Testing prefix:', testPrefix);
                    
                    try {
                        const response = await axios.get(`https://msgold.com.my/${testUrl}`, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0',
                                'X-Requested-With': 'XMLHttpRequest',
                                'Referer': 'https://msgold.com.my/',
                                'Cache-Control': 'no-cache'
                            },
                            timeout: 10000
                        });
                        
                        const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
                        
                        // Check if we got valid data
                        if (data.includes('updprc')) {
                            cachedAjaxUrl = testUrl;
                            console.log('✅ Working prefix found:', testPrefix);
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }
        }
        
        // Fetch with cached URL
        if (cachedAjaxUrl) {
            const response = await axios.get(`https://msgold.com.my/${cachedAjaxUrl}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': 'https://msgold.com.my/',
                    'Cache-Control': 'no-cache'
                },
                timeout: 10000
            });
            
            const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            
            // Extract spn1 (USD/MYR rate)
            const spn1Match = data.match(/updprc\('spn1','([\d,]+\.?\d*)'\)/);
            
            if (spn1Match) {
                const spn1 = parseFloat(spn1Match[1].replace(/,/g, ''));
                console.log('✅ USD/MYR rate (spn1):', spn1);
                
                cachedUsdMyr = spn1;
                lastUsdMyrFetch = now;
                latestData.usdmyr = spn1;
                
                return spn1;
            }
            
            console.log('⚠️ spn1 not found in response');
        }
        
        // If all fails, return last cached value
        return cachedUsdMyr;
        
    } catch (error) {
        console.error('❌ Error fetching USD/MYR:', error.message);
        return cachedUsdMyr; // Return last known value
    }
}

function connect() {
    const ws = new WebSocket(
        "wss://quote.wfgold.com:8082/socket.io/?token=applepieapplepieapplepieapplepie&EIO=3&transport=websocket",
        {
            rejectUnauthorized: false,
            maxPayload: 1024 * 100,
        }
    );

    ws.on("open", () => {
        connected = true;
        console.log("✅ Connected to WF Gold");
        
        setTimeout(() => {
            ws.send("40/bquote");
        }, 500);
    });

    ws.on("message", (data) => {
        const msg = data.toString();

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

            if (packet[0] !== "quote.realtime") return;

            const products = packet[1]?.products;
            if (!products) return;

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

            if (Math.floor(Date.now() / 1000) % 60 === 0) {
                console.log(`📊 XAU: $${latestData.xau?.buy || '--'} | USD/MYR: ${latestData.usdmyr || '--'}`);
            }

        } catch (e) {
            // Silent fail
        }
    });

    ws.on("close", () => {
        connected = false;
        console.log("🔴 Disconnected, reconnecting in 5s...");
        setTimeout(connect, 5000);
    });

    ws.on("error", (err) => {
        if (err.message !== 'unable to verify the first certificate') {
            console.error("WebSocket error:", err.message);
        }
    });
    
    return ws;
}

// Start connection
let ws = connect();

// Start USD/MYR fetching interval
setInterval(fetchUsdMyr, 5000); // Fetch every 5 seconds
fetchUsdMyr(); // Initial fetch

// API endpoints
app.get("/", (req, res) => {
    res.json({
        connected,
        lastUpdate: latestData.timestamp,
        xau: latestData.xau,
        usdmyr: latestData.usdmyr
    });
});

app.get("/buy", (req, res) => {
    res.send(latestData.xau?.buy || "");
});

app.get("/sell", (req, res) => {
    res.send(latestData.xau?.sell || "");
});

app.get("/all", (req, res) => {
    res.json(latestData);
});

// New endpoint for USD/MYR rate
app.get("/usdmyr", (req, res) => {
    res.json({
        rate: latestData.usdmyr,
        cached: cachedUsdMyr,
        lastFetch: lastUsdMyrFetch ? new Date(lastUsdMyrFetch).toISOString() : null
    });
});

app.get("/health", (req, res) => {
    res.json({ 
        status: connected ? "ok" : "error",
        uptime: process.uptime(),
        memory: process.memoryUsage().heapUsed / 1024 / 1024,
        usdmyr: latestData.usdmyr
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
