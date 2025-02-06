import puppeteer from "puppeteer";

const getProfileInfo = async (page) => {
  // Wait longer for content to load
  await page.waitForSelector('[data-testid="UserName"]', { timeout: 10000 });
  
  return await page.evaluate(() => {
    const $ = (selector) => document.querySelector(selector);
    const getTextOrDefault = (selector, defaultValue = 'N/A') => {
      const element = $(selector);
      return element ? element.innerText : defaultValue;
    };

    try {
      return {
        profileName: getTextOrDefault('[data-testid="UserName"] div span'),
        username: getTextOrDefault('[data-testid="UserName"] div:nth-of-type(2) span'),
        followers: getTextOrDefault('a[href$="/verified_followers"] span span'),
        following: getTextOrDefault('a[href$="/following"] span span'),
      };
    } catch (error) {
      console.error('Error extracting profile info:', error);
      return {
        profileName: 'N/A',
        username: 'N/A',
        followers: 'N/A',
        following: 'N/A'
      };
    }
  });
};

const getRecentTweets = async (page) => {
  await page.waitForSelector('article', { timeout: 20000 });
  
  // First, let's scroll a bit to ensure recent tweets are loaded
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      window.scrollBy(0, window.innerHeight * 2);
      setTimeout(resolve, 2000);  // Wait for content to load
    });
  });

  const tweets = await page.evaluate(() => {
    try {
      // Get all tweet articles and convert to array
      const tweetElements = [...document.querySelectorAll("article")];
      
      // Map each tweet element to its data
      const tweets = tweetElements.map((el) => {
        const getTextOrDefault = (selector, defaultValue = '0') => {
          const element = el.querySelector(selector);
          return element ? element.innerText : defaultValue;
        };

        // Extract timestamp for sorting
        const timestamp = el.querySelector("time")?.dateTime || 'N/A';
        
        return {
          submitted: timestamp,
          submittedFormatted: new Date(timestamp).toLocaleString(),
          postLink: el.querySelector("time")?.parentElement?.href
            ? `https://x.com${el.querySelector("time").parentElement.getAttribute("href")}`
            : 'N/A',
          description: getTextOrDefault('div[lang]'),
          replies: getTextOrDefault('[data-testid="reply"]'),
          retweets: getTextOrDefault('[data-testid="retweet"]'),
          likes: getTextOrDefault('[data-testid="like"]'),
          imageUrl: el.querySelector('img[alt="Image"]')?.src || 'No image'
        };
      });

      // Sort tweets by date (most recent first) and take the first 5
      return tweets
        .filter(tweet => tweet.submitted) // Remove any tweets without valid timestamps
        .sort((a, b) => new Date(b.submitted) - new Date(a.submitted))
        .slice(0, 5);
        
    } catch (error) {
      console.error('Error extracting tweet metrics:', error);
      return [];
    }
  });

  return tweets;
};

const getTwitterData = async (url) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Block unnecessary resources for faster loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['stylesheet', 'font', 'image'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(url, { 
      waitUntil: "domcontentloaded",
      timeout: 40000 
    });

    const profileData = await getProfileInfo(page);
    const recentTweets = await getRecentTweets(page);

    return {
      ...profileData,
      tweetCount: recentTweets.length,
      tweets: recentTweets,
      scrapedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('Error during scraping:', error);
    return {
      error: 'Failed to fetch Twitter data',
      details: error.message,
      timestamp: new Date().toISOString()
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

// Example usage
const run = async () => {
  try {
    console.log('Starting scrape...');
    const data = await getTwitterData("https://x.com/elonmusk");
    console.log('Recent tweets:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Failed to run scraper:', error);
  }
};

run();