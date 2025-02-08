// import puppeteer from "puppeteer";

// const getHashtagTweets = async (hashtags) => {
//   let browser;
//   const results = {};
  
//   try {
//     browser = await puppeteer.launch({
//       headless: false,
//       args: [
//         '--no-sandbox',
//         '--disable-setuid-sandbox',
//         '--disable-dev-shm-usage',
//         '--disable-accelerated-2d-canvas',
//         '--disable-gpu'
//       ]
//     });

//     const page = await browser.newPage();
//     await page.setRequestInterception(true);
//     page.on('request', (req) => {
//       if (['stylesheet', 'font', 'image'].includes(req.resourceType())) {
//         req.abort();
//       } else {
//         req.continue();
//       }
//     });

//     await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
//     await page.setViewport({ width: 1280, height: 800 });

//     for (const hashtag of hashtags) {
//       const term = hashtag.startsWith('#') ? hashtag.slice(1) : hashtag;
//       const url = `https://x.com/search?q=%23${term}src=typed_query&f=live`;
//       console.log(`Scraping hashtags: ${url}`);
      
//       try {
//         await page.goto(url, { 
//             waitUntil: "domcontentloaded",
//             timeout: 40000 
//         });
//         await page.waitForSelector('article', { timeout: 40000 });
        
//         await page.evaluate(async () => {
//           for (let i = 0; i < 3; i++) {
//             window.scrollBy(0, window.innerHeight);
//             await new Promise(resolve => setTimeout(resolve, 1000));
//           }
//         });

//         const tweets = await page.evaluate(() => {
//           const tweetElements = [...document.querySelectorAll("article")];
          
//           return tweetElements.map((el) => {
//             const getTextOrDefault = (selector, defaultValue = '0') => {
//               const element = el.querySelector(selector);
//               return element ? element.innerText : defaultValue;
//             };

//             const timestamp = el.querySelector("time")?.dateTime || 'N/A';
//             const authorElement = el.querySelector('div[data-testid="User-Name"]');
            
//             return {
//               author: authorElement ? authorElement.innerText.split('\n')[0] : 'N/A',
//               username: authorElement ? authorElement.innerText.split('\n')[1] : 'N/A',
//               submitted: timestamp,
//               submittedFormatted: new Date(timestamp).toLocaleString(),
//               postLink: el.querySelector("time")?.parentElement?.href
//                 ? `https://x.com${el.querySelector("time").parentElement.getAttribute("href")}`
//                 : 'N/A',
//               description: getTextOrDefault('div[lang]'),
//               replies: getTextOrDefault('[data-testid="reply"]'),
//               retweets: getTextOrDefault('[data-testid="retweet"]'),
//               likes: getTextOrDefault('[data-testid="like"]')
//             };
//           })
//           .filter(tweet => tweet.submitted)
//           .sort((a, b) => new Date(b.submitted) - new Date(a.submitted))
//           .slice(0, 10);
//         });

//         results[hashtag] = {
//           tweets,
//           scrapedAt: new Date().toISOString()
//         };
//       } catch (error) {
//         results[hashtag] = {
//           error: 'Failed to fetch tweets',
//           details: error.message
//         };
//       }
//     }

//     return results;

//   } finally {
//     if (browser) await browser.close();
//   }
// };

// // Example usage
// const run = async () => {
//     console.log("starting scrape...")
//   const hashtags = ['#crypto'];
//   const data = await getHashtagTweets(hashtags);
//   console.log(JSON.stringify(data, null, 2));
// };

// run();

import puppeteer from 'puppeteer';

async function scrapeTwitterHashtags(credentials, hashtags) {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  try {
    // Login
    await page.goto('https://twitter.com/i/flow/login');
    await page.waitForSelector('input[autocomplete="username"]');
    await page.type('input[autocomplete="username"]', credentials.username);
    await page.keyboard.press('Enter');
    
    // Handle password
    await page.waitForSelector('input[type="password"]');
    await page.type('input[type="password"]', credentials.password);
    await page.keyboard.press('Enter');
    
    // Wait for login to complete
    await page.waitForSelector('a[aria-label="Home"]', { timeout: 30000 });
    
    const results = {};
    
    // Scrape each hashtag
    for (const hashtag of hashtags) {
      const term = hashtag.startsWith('#') ? hashtag.slice(1) : hashtag;
      await page.goto(`https://twitter.com/search?q=%23${term}&src=typed_query&f=live`);
      await page.waitForSelector('article');
      
      // Scroll a bit to load more tweets
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 2);
        return new Promise(resolve => setTimeout(resolve, 2000));
      });
      
      // Extract tweets
      const tweets = await page.evaluate(() => {
        return [...document.querySelectorAll('article')].map(tweet => ({
          author: tweet.querySelector('div[data-testid="User-Name"]')?.innerText.split('\n')[0] || 'N/A',
          username: tweet.querySelector('div[data-testid="User-Name"]')?.innerText.split('\n')[1] || 'N/A',
          text: tweet.querySelector('div[lang]')?.innerText || 'N/A',
          timestamp: tweet.querySelector('time')?.dateTime || 'N/A',
          likes: tweet.querySelector('[data-testid="like"]')?.innerText || '0',
          retweets: tweet.querySelector('[data-testid="retweet"]')?.innerText || '0',
          replies: tweet.querySelector('[data-testid="reply"]')?.innerText || '0'
        }));
      });
      
      results[hashtag] = {
        tweets: tweets.slice(0, 10),
        scrapedAt: new Date().toISOString()
      };
    }
    
    return results;
    
  } catch (error) {
    console.error('Scraping failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Example usage:
const credentials = {
  username: 'your_username',
  password: 'your_password'
};

const hashtags = ['#crypto', '#bitcoin'];

scrapeTwitterHashtags(credentials, hashtags)
  console.log("starting scrape...")
  .then(results => console.log(JSON.stringify(results, null, 2)))
  .catch(error => console.error('Error:', error));