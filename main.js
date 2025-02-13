// main.js
const { Worker } = require("worker_threads");
const cron = require("node-cron");
const path = require("path");

// Configuration remains the same as your original
const CONFIG = {
  mongodb: {
    uri: "mongodb+srv://admin-uwais:password%40123@cluster0.2ieu9.mongodb.net/?retryWrites=true&w=majority",
    dbName: "twitter_scraper",
  },
  twitter: {
    credentials: {
      username: "MPain2095",
      password: "BLUE2025#",
    },
  },
  discord: {
    profileWebhook:
      "https://discord.com/api/webhooks/1337468470962426037/i9hSk6hdEH6TGVb0LtLSBZcKByNGy96ppyUyEFyWbLHopC-Kv0mOiLzuwOwJAbwiWXn2",
    hashtagWebhook:
      "https://discord.com/api/webhooks/1337713733941727232/XQKhYWfWYUcIEfXiSapGKSpAlWqx2Dvfmm169c6u3nwYpHPEAimnooai8bzKTKE0_kre",
  },
  targets: {
    profiles: ["elonmusk", "orangie"],
    hashtags: ["#memecoins", "#dogecoin", "#blockchain", "#crypto"],
  },
};

// Keep track of active workers
let activeWorkers = {
  profile: null,
  hashtag: null,
};

function createWorker(scriptPath, workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(scriptPath, { workerData });

    worker.on("message", resolve);
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });

    return worker;
  });
}

async function runScrapers() {
  try {
    console.log("Starting scraper workers:", new Date().toISOString());

    // Create profile worker if not exists
    if (!activeWorkers.profile) {
      activeWorkers.profile = createWorker(
        path.join(__dirname, "profileScraper.js"),
        {
          config: {
            ...CONFIG,
            webhookUrl: CONFIG.discord.profileWebhook,
          },
        }
      );
    }

    // Create hashtag worker if not exists
    if (!activeWorkers.hashtag) {
      activeWorkers.hashtag = createWorker(
        path.join(__dirname, "hashtagScraper.js"),
        {
          config: {
            ...CONFIG,
            webhookUrl: CONFIG.discord.hashtagWebhook,
          },
        }
      );
    }

    // Run workers in parallel
    const results = await Promise.all([
      activeWorkers.profile,
      activeWorkers.hashtag,
    ]);
    console.log("Scraping completed:", results);
  } catch (error) {
    console.error("Error running scrapers:", error);
    // Reset workers on error
    activeWorkers = {
      profile: null,
      hashtag: null,
    };
  }
}

// Graceful shutdown handling
process.on("SIGINT", async () => {
  console.log("Shutting down workers...");
  activeWorkers = {
    profile: null,
    hashtag: null,
  };
  process.exit(0);
});

// Start the cron job
console.log("Starting Twitter scraper cron job...");
cron.schedule("* * * * *", runScrapers);
