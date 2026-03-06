const { GoogleGenerativeAI } = require("@google/generative-ai");
const Parser = require("rss-parser");
const fs = require("fs");
const path = require("path");
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
  
  // Deduplicate by title similarity (within current batch)
  const seen = new Set();
  const unique = allArticles.filter(a => {
    const key = a.title.toLowerCase().substring(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Deduplicate against already-posted news from posts.json
  const postsFile = path.join(__dirname, 'posts.json');
  let postedTitles = [];
  if (fs.existsSync(postsFile)) {
    try {
      const posts = JSON.parse(fs.readFileSync(postsFile, 'utf-8'));
      postedTitles = posts.map(p => (p.selected_news || p.title || '').toLowerCase().substring(0, 40));
    } catch (_) {}
  }

  const fresh = unique.filter(a => {
    const key = a.title.toLowerCase().substring(0, 40);
    return !postedTitles.some(posted => posted === key || key.includes(posted) || posted.includes(key));
  });

  if (fresh.length < unique.length) {
    log.info(`Filtered out ${unique.length - fresh.length} already-posted article(s).`);
  }

  if (fresh.length === 0) {
    log.warn('All news articles have already been posted. No new content.');
    return [];
  }
  
  log.info(`Collected ${fresh.length} fresh unique articles across ${NEWS_FEEDS.length} feeds.`);
  return fresh.slice(0, 25); // Send top 25 to Gemini for viral scoring
}

async function generateTeluguScript(newsList) {
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
  const newsContext = newsList.map((n, i) => `[${i}] ${n.title} (${n.source})`).join("\n");

  // ── Phase 1: Pick the most viral topic ────────────────────────────
  log.info('Phase 1: Selecting the most viral topic...');
  const selectionPrompt = `
    You are a viral YouTube strategist for a Telugu news channel.
    Pick the ONE story most likely to GO VIRAL from this list:

    ${newsContext}

    Rate each on 1-10 for: shock value, Telugu-audience relevance, shareability, curiosity gap, timeliness.
    Return ONLY valid JSON (no markdown):
    {"selected_index": 0, "selected_news": "Full title of chosen story", "viral_score": 9, "category": "crime|entertainment|tech|sports|politics|local"}
  `;

  let selection;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await model.generateContent(selectionPrompt);
      let text = res.response.text().trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      selection = JSON.parse(text);
      if (!selection.selected_news) throw new Error('Missing selected_news');
      break;
    } catch (err) {
      log.warn(`Topic selection attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) throw err;
      const retryMatch = err.message.match(/retry in (\d+(?:\.\d+)?)s/i);
      const delay = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) * 1000 : attempt * 15000;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  log.info(`Selected topic (viral ${selection.viral_score}/10): ${selection.selected_news}`);

  // ── Phase 2: Deep-research the topic ──────────────────────────────
  log.info('Phase 2: Researching topic across multiple sources...');
  const research = await researchTopic(selection.selected_news);

  // ── Phase 3: Generate comprehensive script + SEO using research ───
  log.info('Phase 3: Generating comprehensive Telugu script with research...');
  const scriptPrompt = `
    You are a viral YouTube scriptwriter for a popular Telugu news channel.
    
    SELECTED TOPIC: ${selection.selected_news}
    CATEGORY: ${selection.category}
    VIRAL SCORE: ${selection.viral_score}/10

    Here is DETAILED RESEARCH from multiple news sources about this topic:
    ─────────────────────────────────────────
    ${research}
    ─────────────────────────────────────────

    Using ALL the above research, write a COMPREHENSIVE, DETAILED script.

    SCRIPT REQUIREMENTS:
    - Write 2,000-3,000 words COMPLETELY IN TELUGU
    - Include ALL facts, names, dates, and details from the research
    - Be conversational, dramatic, and perfect for video narration
    - Structure:
      * Hook: Powerful emotional question or shocking statement
      * Background: Context and history of the issue
      * The Story: Full detailed explanation with drama, suspense, multiple angles
      * Expert opinions / different perspectives
      * Impact: How it affects common people in AP/Telangana/India
      * What's next: Predictions, ongoing developments
      * Call to Action: Like, share, subscribe in Telugu
    - Include specific quotes, statistics, and facts from the research
    - Make it long enough for a 7-10 minute video

    SEO REQUIREMENTS (for YouTube):
    - Clickbait-style title: Telugu + English, under 70 chars
    - Description: 200 words with keywords in Telugu + English
    - 15 high-search-volume tags (each under 25 chars, Telugu + English mix, NO special characters)

    Return ONLY valid JSON (no markdown):
    {
      "selected_news": "${selection.selected_news}",
      "viral_score": ${selection.viral_score},
      "category": "${selection.category}",
      "script": "The full 2000-3000 word Telugu script...",
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
      const result = await model.generateContent(scriptPrompt);
      let text = result.response.text().trim();
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(text);

      if (!parsed.script || !parsed.seo) {
        throw new Error("Response missing required fields (script, seo)");
      }

      // Attach the research document for NotebookLM
      parsed.research = research;
      return parsed;
    } catch (error) {
      log.error(`Attempt ${attempt}/${maxRetries} - Gemini script generation failed:`, error.message);
      if (attempt < maxRetries) {
        const retryMatch = error.message.match(/retry in (\d+(?:\.\d+)?)s/i);
        const apiDelay = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) * 1000 : 0;
        const delay = Math.max(apiDelay, attempt * 20000);
        log.info(`Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw error;
      }
    }
  }
}

// ==================== RESEARCH HELPERS ====================

/**
 * Fetch and extract readable text from a news article URL.
 */
async function fetchArticleText(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const html = await response.text();
    // Strip non-content elements, then all HTML tags
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > 150 ? text.substring(0, 4000) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Research a selected topic deeply:
 *  - Search Google News RSS with multiple keyword variations
 *  - Fetch full article text from top results
 *  - Return a compiled research document string
 */
async function researchTopic(topicTitle) {
  log.info(`Deep-researching: "${topicTitle}"`);

  // Build varied search queries from the topic
  const baseKeywords = topicTitle
    .replace(/[|–—,]/g, ' ')
    .split(' ')
    .filter(w => w.length > 3)
    .slice(0, 6)
    .join(' ');

  const queries = [
    topicTitle,
    baseKeywords,
  ];

  const articles = [];
  const seenKeys = new Set();

  for (const query of queries) {
    for (const hl of ['en-IN', 'te']) {
      const encoded = encodeURIComponent(query + ' when:2d');
      const ceid = hl === 'te' ? 'IN:te' : 'IN:en';
      const feedUrl = `https://news.google.com/rss/search?q=${encoded}&hl=${hl}&gl=IN&ceid=${ceid}`;
      try {
        const feed = await parser.parseURL(feedUrl);
        for (const item of feed.items.slice(0, 8)) {
          const key = item.title.toLowerCase().substring(0, 40);
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          articles.push({
            title: item.title,
            link: item.link,
            snippet: item.contentSnippet || item.content || '',
            pubDate: item.pubDate,
          });
        }
      } catch (_) {}
    }
  }

  log.info(`Found ${articles.length} related articles. Fetching full text from top results...`);

  // Fetch full article text from top 8 article URLs
  const detailed = [];
  for (const article of articles.slice(0, 8)) {
    if (!article.link) continue;
    const text = await fetchArticleText(article.link);
    if (text) {
      detailed.push({ title: article.title, text });
      log.info(`  ✓ ${article.title.substring(0, 60)}`);
    }
  }
  log.info(`Extracted detailed content from ${detailed.length}/${articles.length} articles.`);

  // Compile research document
  let doc = `TOPIC: ${topicTitle}\n`;
  doc += `Sources: ${articles.length} articles found, ${detailed.length} with full text\n\n`;

  doc += '=== RELATED HEADLINES ===\n';
  for (const a of articles.slice(0, 20)) {
    doc += `• ${a.title}\n`;
    if (a.snippet) doc += `  ${a.snippet.substring(0, 200)}\n`;
  }

  if (detailed.length > 0) {
    doc += '\n=== DETAILED ARTICLE CONTENT ===\n';
    for (const d of detailed) {
      doc += `\n--- ${d.title} ---\n${d.text}\n`;
    }
  }

  return doc;
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
