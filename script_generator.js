const { GoogleGenerativeAI } = require("@google/generative-ai");
const Parser = require("rss-parser");
const fs = require("fs");
const log = require('./logger');
require("dotenv").config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const parser = new Parser();

// Multiple RSS feeds for broad trending Telugu/India news
const NEWS_FEEDS = [
  // Telugu trending & local
  'https://news.google.com/rss/search?q=trending+telugu+when:1d&hl=te&gl=IN&ceid=IN:te',
  'https://news.google.com/rss/search?q=andhra+pradesh+OR+telangana+when:1d&hl=en-IN&gl=IN&ceid=IN:en',
  // Crime & sensational
  'https://news.google.com/rss/search?q=crime+india+when:1d&hl=en-IN&gl=IN&ceid=IN:en',
  // Trending India
  'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFZxYUdjU0FtVnVHZ0pKVGlnQVAB?hl=en-IN&gl=IN&ceid=IN:en',
  // Entertainment / Tollywood
  'https://news.google.com/rss/search?q=tollywood+OR+telugu+cinema+when:1d&hl=en-IN&gl=IN&ceid=IN:en',
  // Technology & AI
  'https://news.google.com/rss/search?q=artificial+intelligence+OR+technology+when:1d&hl=en-IN&gl=IN&ceid=IN:en',
  // Sports
  'https://news.google.com/rss/search?q=cricket+india+OR+IPL+when:1d&hl=en-IN&gl=IN&ceid=IN:en',
];

async function getTrendingTeluguNews() {
  log.info('Fetching trending news across all categories...');
  const allArticles = [];
  
  for (const feedUrl of NEWS_FEEDS) {
    try {
      const feed = await parser.parseURL(feedUrl);
      const articles = feed.items.slice(0, 5).map(item => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        source: feedUrl.includes('crime') ? 'crime' :
                feedUrl.includes('tollywood') ? 'entertainment' :
                feedUrl.includes('cricket') ? 'sports' :
                feedUrl.includes('telugu') ? 'telugu-local' :
                feedUrl.includes('intelligence') ? 'tech' : 'trending'
      }));
      allArticles.push(...articles);
    } catch (error) {
      log.warn(`Failed to fetch feed: ${error.message}`);
    }
  }
  
  // Deduplicate by title similarity
  const seen = new Set();
  const unique = allArticles.filter(a => {
    const key = a.title.toLowerCase().substring(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  log.info(`Collected ${unique.length} unique articles across ${NEWS_FEEDS.length} feeds.`);
  return unique.slice(0, 25); // Send top 25 to Gemini for viral scoring
}

async function generateTeluguScript(newsList) {
  log.info('Generating script with Gemini (Translating to Telugu)...');
  // Use the full model path
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

  const newsContext = newsList.map((n, i) => `[${i}] ${n.title}`).join("\n");
  
  const prompt = `
    You are a viral YouTube scriptwriter for a popular Telugu news channel.
    Your goal: pick the ONE story most likely to GO VIRAL and get maximum views.

    Here are today's trending news items from different categories:
    ${newsContext}

    STEP 1 — VIRAL SCORING:
    Rate each news item on a 1-10 scale for viral potential based on:
    - Shock value / emotional impact
    - Relevance to Telugu audience (AP, Telangana, India)
    - Shareability (will people forward this?)
    - Curiosity gap (makes people NEED to click)
    - Timeliness (breaking > old)
    Pick the item with the HIGHEST viral score.

    STEP 2 — WRITE THE SCRIPT:
    Write a 1,000-word deep-dive script COMPLETELY IN TELUGU for the selected story.
    The script should be conversational, dramatic, and perfect for a video narration.
    Structure:
    - Hook: Start with a powerful, emotional question or shocking statement in Telugu
    - The Story: Full detailed explanation with drama and suspense
    - Why it matters: How it affects common people in Telugu states
    - What's next: Predictions or expert opinions
    - Call to Action: Like, share, subscribe in Telugu

    STEP 3 — SEO (for YouTube):
    - Clickbait-style title in Telugu + English (under 70 chars)
    - Description with keywords (Telugu + English, 200 words)
    - 20 high-search-volume tags (Telugu + English mix)

    Return ONLY valid JSON:
    {
      "selected_news": "Title of chosen story",
      "viral_score": 9,
      "category": "crime|entertainment|tech|sports|politics|local",
      "script": "The full Telugu script",
      "seo": {
        "title": "...",
        "description": "...",
        "tags": ["tag1", "tag2"]
      }
    }
  `;

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      let text = result.response.text().trim();
      // Clean up any markdown code fences Gemini might wrap the JSON in
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(text);

      // Basic validation
      if (!parsed.script || !parsed.seo) {
        throw new Error("Response missing required fields (script, seo)");
      }
      return parsed;
    } catch (error) {
      log.error(`Attempt ${attempt}/${maxRetries} - Gemini Generation failed:`, error.message);
      if (attempt < maxRetries) {
        // Parse retry delay from API error if available (e.g. "Please retry in 45s")
        const retryMatch = error.message.match(/retry in (\d+(?:\.\d+)?)s/i);
        const apiDelay = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) * 1000 : 0;
        const delay = Math.max(apiDelay, attempt * 20000);
        log.info(`Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw error;
      }
    }
  }
}

async function main() {
  const news = await getTrendingTeluguNews();
  if (news.length === 0) return;

  const finalOutput = await generateTeluguScript(news);
  fs.writeFileSync("daily_output.json", JSON.stringify(finalOutput, null, 2));
  log.success('Script and SEO metadata saved to daily_output.json');
}

if (require.main === module) {
  main();
}

module.exports = { getTrendingTeluguNews, generateTeluguScript };
