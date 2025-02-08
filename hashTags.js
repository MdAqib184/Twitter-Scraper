import puppeteer from 'puppeteer';

async function scrapeTwitterHashtags(credentials, hashtags) {
  const browser = await puppeteer.launch({
    headless: "new",
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
  .then(results => console.log(JSON.stringify(results, null, 2)))
  .catch(error => console.error('Error:', error));