// hashtagScraper.js
const { parentPort, workerData } = require("worker_threads");
const puppeteer = require("puppeteer");
const axios = require("axios");

const { config } = workerData;

class HashtagScraper {
  constructor(browser) {
    this.browser = browser;
  }

  formatHashtagTweetForDiscord(tweet, hashtag) {
    return {
      embeds: [
        {
          title: `New #${hashtag} Tweet`,
          description: tweet.text,
          author: {
            name: `${tweet.author} (${tweet.username})`,
          },
          color: 3447003,
          fields: [
            { name: "Likes", value: tweet.likes, inline: true },
            { name: "Retweets", value: tweet.retweets, inline: true },
            { name: "Replies", value: tweet.replies, inline: true },
          ],
          timestamp: tweet.timestamp,
        },
      ],
    };
  }

  async scrapeHashtags(hashtags) {
    const page = await this.browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["stylesheet", "font", "image"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    for (const hashtag of hashtags) {
      try {
        const term = hashtag.startsWith("#") ? hashtag.slice(1) : hashtag;
        await page.goto(
          `https://twitter.com/search?q=%23${term}&src=typed_query&f=live`,
          { waitUntil: "domcontentloaded", timeout: 40000 }
        );
        await page.waitForSelector("article", { timeout: 40000 });

        const tweets = await page.evaluate(() => {
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

        if (tweets.length > 0) {
          const latestTweet = tweets[0];
          await this.sendToDiscord(latestTweet, term);
        }
      } catch (error) {
        console.error(`Error scraping hashtag ${hashtag}:`, error);
      }
    }
    await page.close();
  }

  async sendToDiscord(tweet, hashtag) {
    await axios.post(
      config.webhookUrl,
      this.formatHashtagTweetForDiscord(tweet, hashtag)
    );
  }
}

async function runHashtagScraper() {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    // Login
    const loginPage = await browser.newPage();
    await loginPage.goto("https://twitter.com/i/flow/login");
    await loginPage.waitForSelector('input[autocomplete="username"]');
    await loginPage.type(
      'input[autocomplete="username"]',
      config.twitter.credentials.username
    );
    await loginPage.keyboard.press("Enter");
    await loginPage.waitForSelector('input[type="password"]');
    await loginPage.type(
      'input[type="password"]',
      config.twitter.credentials.password
    );
    await loginPage.keyboard.press("Enter");
    await loginPage.waitForSelector('a[aria-label="Home"]', { timeout: 30000 });
    await loginPage.close();

    const scraper = new HashtagScraper(browser);
    await scraper.scrapeHashtags(config.targets.hashtags);

    parentPort.postMessage("Hashtag scraping completed successfully");
  } catch (error) {
    console.error("Error in hashtag scraper:", error);
    parentPort.postMessage({ error: error.message });
  } finally {
    if (browser) await browser.close();
  }
}

runHashtagScraper();
