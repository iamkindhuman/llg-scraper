const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

let currentPrice = null;
let lastUpdate = 0;

async function getLLGPrice() {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.goto('https://www.wfgold.com/en-us', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // Wait for the price to appear
        await page.waitForSelector('#pm-llg', { timeout: 10000 });
        
        // Extract the bid price
        const price = await page.$eval('#pm-llg', el => {
            const text = el.innerText;
            const match = text.match(/(\d+\.\d+)/);
            return match ? match[1] : null;
        });
        
        await browser.close();
        return price;
        
    } catch(error) {
        console.error('Scrape error:', error.message);
        if (browser) await browser.close();
        return null;
    }
}

app.get('/api/llg', async (req, res) => {
    // Return cached price if less than 5 seconds old
    if (currentPrice && (Date.now() - lastUpdate) < 5000) {
        return res.json({ bid: currentPrice, cached: true });
    }
    
    const price = await getLLGPrice();
    if (price) {
        currentPrice = price;
        lastUpdate = Date.now();
        res.json({ bid: price, cached: false });
    } else if (currentPrice) {
        res.json({ bid: currentPrice, cached: true });
    } else {
        res.status(503).json({ error: 'Unable to fetch price' });
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'OK', price: currentPrice || 'Not fetched' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
