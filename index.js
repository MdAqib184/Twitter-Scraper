const puppeteer = require("puppeteer");
const { MongoClient } = require("mongodb");
const { WebhookClient } = require("discord.js");

class TwitterScraper {
  constructor(mongoUri, discordWebhookUrl) {
    this.mongoUri =
      "mongodb+srv://admin-uwais:password%40123@cluster0.2ieu9.mongodb.net/?retryWrites=true&w=majority";
    this.discordWebhook = new WebhookClient({
      url: "https://discord.com/api/webhooks/1337468470962426037/i9hSk6hdEH6TGVb0LtLSBZcKByNGy96ppyUyEFyWbLHopC-Kv0mOiLzuwOwJAbwiWXn2",
    });
    this.db = null;
  }

  async initialize() {
    const client = new MongoClient(this.mongoUri);
    await client.connect();
    this.db = client.db("twitter_scraper");
  }

  async getTwitterData(url) {
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });

    try {
      const page = await browser.newPage();
      await this._setupPage(page);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });

      const profileData = await this._getProfileInfo(page);
      const recentTweets = await this._getRecentTweets(page);

      return {
        ...profileData,
        tweetCount: recentTweets.length,
        tweets: recentTweets,
        scrapedAt: new Date().toISOString(),
      };
    } finally {
      await browser.close();
    }
  }

  async scrapeTargets(targets) {
    const results = [];
    for (const target of targets) {
      const data = await this.getTwitterData(target.url);
      const newTweets = await this._processAndStoreData(
        target.identifier,
        data
      );
      if (newTweets.length > 0) {
        await this._sendToDiscord(newTweets);
        results.push(newTweets);
      }
    }
    return results;
  }

  async _processAndStoreData(identifier, data) {
    const collection = this.db.collection("tweets");
    const newTweets = [];

    for (const tweet of data.tweets) {
      const existingTweet = await collection.findOne({
        postLink: tweet.postLink,
      });

      if (!existingTweet) {
        await collection.insertOne({
          ...tweet,
          identifier,
          processedAt: new Date(),
        });
        newTweets.push(tweet);
      }
    }

    return newTweets;
  }

  async _sendToDiscord(tweets) {
    for (const tweet of tweets) {
      await this.discordWebhook.send({
        content: `New tweet detected:\n${tweet.description}\nLink: ${tweet.postLink}`,
      });
    }
  }

  async _setupPage(page) {
    // Block unnecessary resources for faster loading
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["stylesheet", "font", "image"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });
  }

  async _getProfileInfo(page) {
    // Wait longer for content to load
    await page.waitForSelector('[data-testid="UserName"]', { timeout: 10000 });

    return await page.evaluate(() => {
      const $ = (selector) => document.querySelector(selector);
      const getTextOrDefault = (selector, defaultValue = "N/A") => {
        const element = $(selector);
        return element ? element.innerText : defaultValue;
      };

      try {
        return {
          profileName: getTextOrDefault('[data-testid="UserName"] div span'),
          username: getTextOrDefault(
            '[data-testid="UserName"] div:nth-of-type(2) span'
          ),
          followers: getTextOrDefault(
            'a[href$="/verified_followers"] span span'
          ),
          following: getTextOrDefault('a[href$="/following"] span span'),
        };
      } catch (error) {
        console.error("Error extracting profile info:", error);
        return {
          profileName: "N/A",
          username: "N/A",
          followers: "N/A",
          following: "N/A",
        };
      }
    });
  }

  async _getRecentTweets(page) {
    await page.waitForSelector("article", { timeout: 20000 });

    // Scroll to ensure recent tweets are loaded
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        window.scrollBy(0, window.innerHeight * 2);
        setTimeout(resolve, 2000); // Wait for content to load
      });
    });

    const tweets = await page.evaluate(() => {
      try {
        // Get all tweet articles and convert to array
        const tweetElements = [...document.querySelectorAll("article")];

        // Map each tweet element to its data
        const tweets = tweetElements.map((el) => {
          const getTextOrDefault = (selector, defaultValue = "0") => {
            const element = el.querySelector(selector);
            return element ? element.innerText : defaultValue;
          };

          // Extract timestamp for sorting
          const timestamp = el.querySelector("time")?.dateTime || "N/A";

          return {
            submitted: timestamp,
            submittedFormatted: new Date(timestamp).toLocaleString(),
            postLink: el.querySelector("time")?.parentElement?.href
              ? `https://x.com${el
                  .querySelector("time")
                  .parentElement.getAttribute("href")}`
              : "N/A",
            description: getTextOrDefault("div[lang]"),
            replies: getTextOrDefault('[data-testid="reply"]'),
            retweets: getTextOrDefault('[data-testid="retweet"]'),
            likes: getTextOrDefault('[data-testid="like"]'),
            imageUrl: el.querySelector('img[alt="Image"]')?.src || "No image",
          };
        });

        // Sort tweets by date (most recent first) and take the first 5
        return tweets
          .filter((tweet) => tweet.submitted) // Remove any tweets without valid timestamps
          .sort((a, b) => new Date(b.submitted) - new Date(a.submitted))
          .slice(0, 5);
      } catch (error) {
        console.error("Error extracting tweet metrics:", error);
        return [];
      }
    });

    return tweets;
  }
}

module.exports = TwitterScraper;

// Example usage with cron
const cron = require("node-cron");

const targets = [
  {
    url: "https://x.com/elonmusk",
    identifier: "elonmusk",
  },
  {
    url: "https://x.com/orangie",
    identifier: "orangie",
  },
  // Hashtag tracking
  ...["crypto", "bitcoin", "ai"].map((tag) => ({
    url: `https://x.com/hashtag/${tag}`,
    identifier: `hashtag_${tag}`,
  })),
];

async function setupScraper() {
  const scraper = new TwitterScraper(
    process.env.MONGO_URI,
    process.env.DISCORD_WEBHOOK
  );

  await scraper.initialize();

  // Run immediately
  await scraper.scrapeTargets(targets);

  // Schedule recurring job every 2 minutes
  cron.schedule("*/2 * * * *", async () => {
    await scraper.scrapeTargets(targets);
  });
}

setupScraper().catch(console.error);
