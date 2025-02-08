// profileScraper.js
const { parentPort, workerData } = require("worker_threads");
const puppeteer = require("puppeteer");
const { MongoClient } = require("mongodb");
const axios = require("axios");

const { config } = workerData;

class ProfileScraper {
  constructor(browser, mongoClient) {
    this.browser = browser;
    this.mongoClient = mongoClient;
    this.collection = mongoClient
      .db(config.mongodb.dbName)
      .collection("last_tweets");
  }

  async normalizeTwitterUrl(input) {
    return input.startsWith("http")
      ? input
      : `https://x.com/${input.replace("@", "")}`;
  }

  async getProfileInfo(page) {
    await page.waitForSelector('[data-testid="UserName"]', { timeout: 10000 });

    return await page.evaluate(() => {
      const $ = (selector) => document.querySelector(selector);
      const getTextOrDefault = (selector, defaultValue = "N/A") => {
        const element = $(selector);
        return element ? element.innerText : defaultValue;
      };

      return {
        profileName: getTextOrDefault('[data-testid="UserName"] div span'),
        username: getTextOrDefault(
          '[data-testid="UserName"] div:nth-of-type(2) span'
        ),
        followers: getTextOrDefault('a[href$="/verified_followers"] span span'),
        following: getTextOrDefault('a[href$="/following"] span span'),
      };
    });
  }

  async getRecentTweets(page) {
    await page.waitForSelector("article", { timeout: 40000 });

    await page.evaluate(async () => {
      window.scrollBy(0, window.innerHeight * 2);
      return new Promise((resolve) => setTimeout(resolve, 2000));
    });

    return await page.evaluate(() => {
      const tweetElements = [...document.querySelectorAll("article")];

      return tweetElements
        .map((el) => {
          const getTextOrDefault = (selector, defaultValue = "0") => {
            const element = el.querySelector(selector);
            return element ? element.innerText : defaultValue;
          };

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
        })
        .filter((tweet) => tweet.submitted !== "N/A")
        .sort((a, b) => new Date(b.submitted) - new Date(a.submitted))
        .slice(0, 1);
    });
  }

  formatTweetForDiscord(tweet, username) {
    return {
      embeds: [
        {
          title: `New Tweet from ${username}`,
          description: tweet.description,
          url: tweet.postLink,
          color: 3447003,
          fields: [
            { name: "Likes", value: tweet.likes, inline: true },
            { name: "Retweets", value: tweet.retweets, inline: true },
            { name: "Replies", value: tweet.replies, inline: true },
          ],
          timestamp: tweet.submitted,
          image: tweet.imageUrl !== "No image" ? { url: tweet.imageUrl } : null,
        },
      ],
    };
  }

  async checkAndUpdateLastTweet(username, tweet) {
    const lastTweet = await this.collection.findOne({ username });

    // First run scenario
    if (!lastTweet) {
      // Always send the first tweet
      await this.collection.updateOne(
        { username },
        {
          $set: {
            username,
            lastTweetTimestamp: tweet.submitted,
          },
        },
        { upsert: true }
      );
      return true;
    }

    // Regular comparison for new tweets
    if (new Date(tweet.submitted) > new Date(lastTweet.lastTweetTimestamp)) {
      await this.collection.updateOne(
        { username },
        {
          $set: {
            lastTweetTimestamp: tweet.submitted,
          },
        }
      );
      return true;
    }
    return false;
  }

  async scrapeProfiles(accounts) {
    const page = await this.browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["stylesheet", "font", "image"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    for (const account of accounts) {
      try {
        const url = await this.normalizeTwitterUrl(account);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });

        const profileData = await this.getProfileInfo(page);
        const recentTweets = await this.getRecentTweets(page);

        if (recentTweets.length > 0) {
          const isNewTweet = await this.checkAndUpdateLastTweet(
            account,
            recentTweets[0]
          );

          if (isNewTweet) {
            console.log(`New tweet from ${account}:`, recentTweets[0]);

            await this.sendToDiscord(recentTweets[0], profileData.username);
          }
        }
      } catch (error) {
        console.error(`Error scraping ${account}:`, error);
      }
    }
    await page.close();
  }

  async sendToDiscord(tweet, username) {
    await axios.post(
      config.webhookUrl,
      this.formatTweetForDiscord(tweet, username)
    );
  }
}

async function runProfileScraper() {
  let browser;
  let mongoClient;

  try {
    mongoClient = await MongoClient.connect(config.mongodb.uri);

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

    const scraper = new ProfileScraper(browser, mongoClient);
    await scraper.scrapeProfiles(config.targets.profiles);

    parentPort.postMessage("Profile scraping completed successfully");
  } catch (error) {
    console.error("Error in profile scraper:", error);
    parentPort.postMessage({ error: error.message });
  } finally {
    if (browser) await browser.close();
    if (mongoClient) await mongoClient.close();
  }
}

runProfileScraper();
