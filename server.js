const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();

app.use(cors());
app.use(express.json());

let cachedPrice = null;
let lastUpdate = 0;

async function scrapeLLG() {
    try {
        console.log('🌐 Fetching Wing Fung page...');
        const response = await axios.get('https://www.wfgold.com/en-us', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Cache-Control': 'no-cache'
            },
            timeout: 30000
        });
        
        const html = response.data;
        const $ = cheerio.load(html);
        
        // Get all text content from the page
        const text = $('body').text();
        
        // Look for LLG in the text
        const patterns = [
            /LLG[^0-9]*([0-9]+\.[0-9]+)/i,
            /LLG.*?([0-9]+\.[0-9]+)\s*\/\s*([0-9]+\.[0-9]+)/i,
            /LLG[^<]*?([0-9]+\.[0-9]+)/i,
            /"LLG".*?"bid":"?([0-9]+\.[0-9]+)/i,
            /"llg".*?"bid":"?([0-9]+\.[0-9]+)/i
        ];
        
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const price = parseFloat(match[1]);
                if (!isNaN(price) && price > 0) {
                    console.log('✅ Found LLG price:', price);
                    return match[1];
                }
            }
        }
        
        console.log('❌ LLG price not found');
        return null;
    } catch (error) {
        console.error('❌ Scraping error:', error.message);
        return null;
    }
}

app.get('/api/llg', async (req, res) => {
    const now = Date.now();
    
    // Return cached price if less than 10 seconds old
    if (cachedPrice && (now - lastUpdate) < 10000) {
        console.log('📦 Returning cached price:', cachedPrice);
        return res.json({ 
            bid: cachedPrice, 
            cached: true,
            timestamp: lastUpdate 
        });
    }
    
    console.log('🔄 Fetching new price...');
    const price = await scrapeLLG();
    
    if (price) {
        cachedPrice = price;
        lastUpdate = now;
        res.json({ bid: price, cached: false, timestamp: now });
    } else if (cachedPrice) {
        console.log('📦 Scrape failed, returning cached price:', cachedPrice);
        res.json({ bid: cachedPrice, cached: true, timestamp: lastUpdate });
    } else {
        console.log('❌ No price available');
        res.status(503).json({ error: 'Unable to fetch LLG price' });
    }
});

app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        price: cachedPrice || 'Not yet fetched',
        lastUpdate: lastUpdate ? new Date(lastUpdate).toISOString() : null
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
