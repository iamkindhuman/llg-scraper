const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const app = express();

app.use(cors());
app.use(express.json());

let cachedPrice = null;
let lastUpdate = 0;

async function scrapeLLG() {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.goto('https://www.wfgold.com/en-us', { waitUntil: 'networkidle2' });

    // Wait for the specific element to appear
    await page.waitForSelector('#pm-llg .ng-binding', { timeout: 10000 });

    // Get all text content inside the LLG row, then extract the bid price
    const bid = await page.$eval('#pm-llg', el => {
        const text = el.innerText;
        // Find the first number that looks like a price (e.g., 4322.4)
        const match = text.match(/(\d+\.\d+)/);
        return match ? match[1] : null;
    });

    await browser.close();
    return bid;
}

app.get('/api/llg', async (req, res) => {
    const now = Date.now();
    if (cachedPrice && (now - lastUpdate) < 5000) {
        return res.json({ bid: cachedPrice, cached: true });
    }

    try {
        const price = await scrapeLLG();
        if (price) {
            cachedPrice = price;
            lastUpdate = now;
            res.json({ bid: price, cached: false });
        } else {
            res.status(503).json({ error: 'Price not found' });
        }
    } catch (error) {
        if (cachedPrice) {
            res.json({ bid: cachedPrice, cached: true });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
