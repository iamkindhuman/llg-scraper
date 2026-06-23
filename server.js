const express = require("express");
const WebSocket = require("ws");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3000;

// Add CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// In-memory storage only - NO disk writes, NO database
let connected = false;
let latestData = {
    xau: null,
    xag: null,
    eur: null,
    gbp: null,
    jpy: null,
    usdmyr: null,
    timestamp: null
};

// USD/MYR rate cache
let cachedUsdMyr = null;
let lastUsdMyrFetch = 0;
const USDMYR_CACHE_DURATION = 2000; // Reduced to 2 seconds for faster updates

// Known hash from msgold.com.my
const AJAX_HASH = 'c7345ad4580290c2971b1a5b43b0db0a';
let cachedAjaxUrl = null;

// Helper function for HTTPS requests
function httpsGet(url, options = {}) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { 
            ...options,
            timeout: options.timeout || 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                ...options.headers
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    data: data
                });
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// Function to extract prefix from msgold.com.my
async function extractPrefix() {
    try {
        console.log('🔍 Extracting prefix from msgold.com.my...');
        
        const response = await httpsGet('https://msgold.com.my/', {
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache'
            }
        });
        
        const html = response.data;
        
        // Try multiple patterns to find the prefix
        let match = html.match(/ajax\("refg4","(\d+)_"\+s\+"_([a-f0-9]+)"/);
        
        if (!match) {
            // Alternative pattern
            match = html.match(/"(\d+)_"\s*\+\s*s\s*\+\s*"_([a-f0-9]+)"/);
        }
        
        if (!match) {
            // Another alternative
            match = html.match(/ajax\([^,]+,[^,]*"(\d+)_/);
        }
        
        if (match) {
            const prefix = match[1];
            const hash = match[2] || AJAX_HASH;
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
        
        console.log('💱 Attempting to fetch USD/MYR rate...');
        
        // Force refresh URL every 5 minutes
        if (!cachedAjaxUrl || (now - lastUsdMyrFetch) > 300000) {
            console.log('🔄 Refreshing AJAX URL...');
            cachedAjaxUrl = null; // Reset to force new extraction
        }
        
        // Get fresh prefix if needed
        if (!cachedAjaxUrl) {
            const params = await extractPrefix();
            if (params) {
                cachedAjaxUrl = generateAjaxUrl(params.prefix, params.hash || AJAX_HASH);
                console.log('📎 Generated URL:', cachedAjaxUrl);
            } else {
                // Fallback: try common prefixes
                for (let testPrefix of ['3581', '794', '1360', '2104']) {
                    const testUrl = generateAjaxUrl(testPrefix, AJAX_HASH);
                    console.log('🔄 Testing prefix:', testPrefix);
                    
                    try {
                        const response = await httpsGet(`https://msgold.com.my/${testUrl}`, {
                            timeout: 10000,
                            headers: {
                                'X-Requested-With': 'XMLHttpRequest',
                                'Referer': 'https://msgold.com.my/',
                                'Cache-Control': 'no-cache'
                            }
                        });
                        
                        if (response.data.includes('updprc')) {
                            cachedAjaxUrl = testUrl;
                            console.log('✅ Working prefix found:', testPrefix);
                            break;
                        }
                    } catch (e) {
                        console.log('❌ Prefix', testPrefix, 'failed:', e.message);
                        continue;
                    }
                }
            }
        }
        
        // Fetch with cached URL
        if (cachedAjaxUrl) {
            const response = await httpsGet(`https://msgold.com.my/${cachedAjaxUrl}`, {
                timeout: 10000,
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': 'https://msgold.com.my/',
                    'Cache-Control': 'no-cache'
                }
            });
            
            const data = response.data;
            
            // Extract spn1 (USD/MYR rate) - try multiple patterns
            let spn1 = null;
            
            // Pattern 1: updprc('spn1','XXX.XX')
            const spn1Match = data.match(/updprc\('spn1','([\d,]+\.?\d*)'\)/);
            if (spn1Match) {
                spn1 = parseFloat(spn1Match[1].replace(/,/g, ''));
            }
            
            // Pattern 2: Look for any number near "USD" or "MYR"
            if (!spn1) {
                const usdMatch = data.match(/USD[^0-9]*([\d]+\.[\d]+)/);
                if (usdMatch) {
                    spn1 = parseFloat(usdMatch[1]);
                }
            }
            
            if (spn1 && !isNaN(spn1)) {
                console.log('✅ USD/MYR rate (spn1):', spn1, '(previous:', cachedUsdMyr, ')');
                
                // Update only if value actually changed
                if (cachedUsdMyr !== spn1) {
                    console.log('📊 USD/MYR updated from', cachedUsdMyr, 'to', spn1);
                }
                
                cachedUsdMyr = spn1;
                lastUsdMyrFetch = now;
                latestData.usdmyr = spn1;
                
                return spn1;
            } else {
                console.log('⚠️ spn1 not found in response. Response preview:', data.substring(0, 200));
            }
        } else {
            console.log('❌ No cached URL available');
        }
        
        // If all fails, return last cached value
        console.log('⚠️ Returning cached value:', cachedUsdMyr);
        return cachedUsdMyr;
        
    } catch (error) {
        console.error('❌ Error fetching USD/MYR:', error.message);
        return cachedUsdMyr;
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

// Start USD/MYR fetching interval - more frequent updates
setInterval(() => {
    console.log('⏰ Fetch interval triggered');
    fetchUsdMyr();
}, 3000); // Every 3 seconds instead of 5

// Initial fetch
fetchUsdMyr();

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
        usdmyr: latestData.usdmyr,
        usdmyr_cached: cachedUsdMyr,
        last_usdmyr_fetch: lastUsdMyrFetch ? new Date(lastUsdMyrFetch).toISOString() : 'never'
    });
});

process.on('SIGTERM', () => {
    console.log('Shutting down...');
    if (ws) ws.terminate();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`💾 Memory usage: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`);
});
