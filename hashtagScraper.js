// hashtagScraper.js
const puppeteer = require("puppeteer");
const { parentPort, workerData } = require("worker_threads");

let browser = null;
let page = null;

async function initializeBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browser;
}

async function getPage() {
  if (!page) {
    page = await browser.newPage();
    // Login only when creating a new page
    await login(page, workerData.config.twitter.credentials);
  }
  return page;
}

async function login(page, credentials) {
  try {
    await page.goto("https://twitter.com/i/flow/login");
    await page.waitForSelector('input[autocomplete="username"]');
    await page.type('input[autocomplete="username"]', credentials.username);
    await page.keyboard.press("Enter");

    await page.waitForSelector('input[type="password"]');
    await page.type('input[type="password"]', credentials.password);
    await page.keyboard.press("Enter");

    await page.waitForSelector('a[aria-label="Home"]', { timeout: 30000 });
    console.log("Login successful");
  } catch (error) {
    console.error("Login failed:", error);
    throw error;
  }
}

async function scrapeHashtags(hashtags) {
  try {
    await initializeBrowser();
    const currentPage = await getPage();
    const results = {};

    for (const hashtag of hashtags) {
      try {
        const term = hashtag.startsWith("#") ? hashtag.slice(1) : hashtag;
        await currentPage.goto(
          `https://twitter.com/search?q=%23${term}&src=typed_query&f=live`
        );
        await currentPage.waitForSelector("article");

        // Scroll to load more tweets
        await currentPage.evaluate(() => {
          window.scrollBy(0, window.innerHeight * 2);
          return new Promise((resolve) => setTimeout(resolve, 2000));
        });

        // Extract tweets
        const tweets = await currentPage.evaluate(() => {
          return [...document.querySelectorAll("article")].map((tweet) => ({
            author:
              tweet
                .querySelector('div[data-testid="User-Name"]')
                ?.innerText.split("\n")[0] || "N/A",
            username:
              tweet
                .querySelector('div[data-testid="User-Name"]')
                ?.innerText.split("\n")[1] || "N/A",
            text: tweet.querySelector("div[lang]")?.innerText || "N/A",
            timestamp: tweet.querySelector("time")?.dateTime || "N/A",
            likes:
              tweet.querySelector('[data-testid="like"]')?.innerText || "0",
            retweets:
              tweet.querySelector('[data-testid="retweet"]')?.innerText || "0",
            replies:
              tweet.querySelector('[data-testid="reply"]')?.innerText || "0",
          }));
        });

        results[hashtag] = {
          tweets: tweets.slice(0, 10),
          scrapedAt: new Date().toISOString(),
        };
      } catch (error) {
        console.error(`Error scraping hashtag ${hashtag}:`, error);
        results[hashtag] = {
          error: error.message,
          scrapedAt: new Date().toISOString(),
        };
      }
    }

    return results;
  } catch (error) {
    console.error("Scraping failed:", error);
    throw error;
  }
}

// Handle graceful shutdown
async function cleanup() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Main worker function
async function runWorker() {
  try {
    const results = await scrapeHashtags(workerData.config.targets.hashtags);

    // Send results back to main thread
    if (parentPort) {
      parentPort.postMessage(results);
    }

    return results;
  } catch (error) {
    console.error("Worker error:", error);
    if (parentPort) {
      parentPort.postMessage({ error: error.message });
    }
    throw error;
  }
}

// Start the worker
runWorker();
