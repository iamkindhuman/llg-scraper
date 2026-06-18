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
        console.log('Starting Puppeteer...');
        
        // For Render, we need to find Chrome
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || 
                              '/usr/bin/google-chrome-stable' ||
                              '/usr/bin/chromium' ||
                              undefined;
        
        browser = await puppeteer.launch({
            headless: true,
            executablePath: executablePath,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-features=site-per-process'
            ]
        });
        
        console.log('Browser launched, opening page...');
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        console.log('Navigating to Wing Fung...');
        await page.goto('https://www.wfgold.com/en-us', {
            waitUntil: 'networkidle2',
            timeout: 45000
        });
        
        console.log('Page loaded, waiting for content...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const content = await page.content();
        console.log('Content length:', content.length);
        
        const patterns = [
            /LLG[^0-9]*([0-9]+\.[0-9]+)/i,
            /LLG.*?([0-9]+\.[0-9]+)\s*\/\s*([0-9]+\.[0-9]+)/i,
            /LLG[^<]*?([0-9]+\.[0-9]+)/i,
            /"LLG".*?"bid":"?([0-9]+\.[0-9]+)/i,
            /"llg".*?"bid":"?([0-9]+\.[0-9]+)/i,
            /LLG[^0-9]*([0-9]+\.[0-9]+)/i
        ];
        
        for (const pattern of patterns) {
            const match = content.match(pattern);
            if (match && match[1]) {
                const price = parseFloat(match[1]);
                if (!isNaN(price) && price > 0) {
                    console.log('✅ Found LLG price:', price);
                    return match[1];
                }
            }
        }
        
        // Try to find in the whole page text
        const text = await page.evaluate(() => document.body.innerText);
        const llgIndex = text.indexOf('LLG');
        if (llgIndex !== -1) {
            const snippet = text.substring(llgIndex, llgIndex + 50);
            const numMatch = snippet.match(/([0-9]+\.[0-9]+)/);
            if (numMatch) {
                console.log('✅ Found LLG price from text:', numMatch[1]);
                return numMatch[1];
            }
        }
        
        console.log('❌ LLG price not found in page');
        return null;
    } catch (error) {
        console.error('❌ Scraping error:', error.message);
        return null;
    } finally {
        if (browser) await browser.close();
        console.log('Browser closed');
    }
}

app.get('/api/llg', async (req, res) => {
    const now = Date.now();
    
    // Return cached price if less than 10 seconds old
    if (cachedPrice && (now - lastUpdate) < 10000) {
        console.log('Returning cached price:', cachedPrice);
        return res.json({ 
            bid: cachedPrice, 
            cached: true,
            timestamp: lastUpdate 
        });
    }
    
    console.log('Fetching new price...');
    const price = await scrapeLLG();
    
    if (price) {
        cachedPrice = price;
        lastUpdate = now;
        res.json({ bid: price, cached: false, timestamp: now });
    } else if (cachedPrice) {
        console.log('Scrape failed, returning cached price:', cachedPrice);
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
