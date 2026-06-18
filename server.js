const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const app = express();

app.use(cors());
app.use(express.json());

let cachedPrice = null;
let lastUpdate = 0;

async function scrapeLLG() {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.goto('https://www.wfgold.com/en-us', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // Wait for content
        await page.waitForTimeout(3000);
        
        // Get page content
        const content = await page.content();
        
        // Extract LLG price using regex
        const patterns = [
            /LLG[^0-9]*([0-9]+\.[0-9]+)/i,
            /LLG.*?([0-9]+\.[0-9]+)\s*\/\s*([0-9]+\.[0-9]+)/i,
            /LLG[^<]*?([0-9]+\.[0-9]+)/i,
            /"LLG".*?"bid":"?([0-9]+\.[0-9]+)/i
        ];
        
        for (const pattern of patterns) {
            const match = content.match(pattern);
            if (match && match[1]) {
                const price = parseFloat(match[1]);
                if (!isNaN(price) && price > 0) {
                    return match[1];
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error('Scraping error:', error);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

// API endpoint
app.get('/api/llg', async (req, res) => {
    const now = Date.now();
    
    // Return cached price if less than 5 seconds old
    if (cachedPrice && (now - lastUpdate) < 5000) {
        return res.json({ 
            bid: cachedPrice, 
            cached: true,
            timestamp: lastUpdate 
        });
    }
    
    // Scrape new price
    const price = await scrapeLLG();
    
    if (price) {
        cachedPrice = price;
        lastUpdate = now;
        res.json({ bid: price, cached: false, timestamp: now });
    } else {
        // Return cached if available
        if (cachedPrice) {
            res.json({ bid: cachedPrice, cached: true, timestamp: lastUpdate });
        } else {
            res.status(503).json({ error: 'Unable to fetch LLG price' });
        }
    }
});

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'OK', price: cachedPrice || 'Not yet fetched' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
