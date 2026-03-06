# 📺 NotebookLM Telugu News Automation Bot

Fully automated pipeline that fetches trending Telugu news, generates viral scripts using Google Gemini AI, creates videos via NotebookLM, uploads to YouTube, and publishes to a self-hosted blog — all running as a continuous service.

![Node.js](https://img.shields.io/badge/Node.js-v18+-green?logo=node.js)
![Playwright](https://img.shields.io/badge/Playwright-Browser%20Automation-blue?logo=playwright)
![Gemini](https://img.shields.io/badge/Google%20Gemini-AI%20Scripting-orange?logo=google)
![YouTube](https://img.shields.io/badge/YouTube-Auto%20Upload-red?logo=youtube)

## 🔥 What It Does

```
Trending News → Gemini AI Script → NotebookLM Video → YouTube Upload → Blog Post
```

1. **Scouts 7 RSS feeds** — Telugu local, AP/Telangana, crime, Tollywood, tech/AI, sports, trending India
2. **Viral scoring** — Gemini AI rates each story (1-10) on shock value, shareability, curiosity gap & Telugu relevance
3. **Telugu script generation** — 1,000-word deep-dive in Telugu for the highest-scoring story
4. **NotebookLM video creation** — Pastes script into NotebookLM, generates Audio/Video Overview
5. **1080p FFmpeg conversion** — Converts audio to high-quality 1080p video with title overlay
6. **YouTube upload** — Publishes as public with SEO-optimized title, description & tags
7. **Blog post** — Saves to a dark-themed blog website for browsing all published content

## 📁 Project Structure

```
├── bot.js                 # Main automation orchestrator (11-step pipeline)
├── script_generator.js    # News fetching + Gemini AI script generation
├── youtube_uploader.js    # OAuth2 YouTube upload with SEO metadata
├── server.js              # Express blog server (dark-themed UI)
├── scheduler.js           # Cron-based scheduling
├── logger.js              # Structured logging (console + file)
├── login_helper.js        # One-time Google login helper
├── check_models.js        # Gemini API health check
├── package.json
├── .env                   # API keys & config (not committed)
├── .gitignore
├── posts.json             # Auto-generated blog post database
└── daily_output.json      # Latest script output cache
```

## 🚀 Quick Start

### Prerequisites

- **Node.js** v18+
- **FFmpeg** installed and in PATH
- **Google Chrome** installed
- **Google Gemini API key** ([Get one here](https://aistudio.google.com/app/apikey))
- **YouTube OAuth credentials** ([Google Cloud Console](https://console.cloud.google.com/apis/credentials))

### 1. Clone & Install

```bash
git clone https://github.com/ammiforu/notebooklm-automation.git
cd notebooklm-automation
npm install
```

### 2. Configure Environment

Create a `.env` file:

```env
# Google Gemini API
GEMINI_API_KEY=your_gemini_api_key

# YouTube OAuth2 Credentials
YOUTUBE_CLIENT_ID=your_client_id
YOUTUBE_CLIENT_SECRET=your_client_secret

# Scheduler (cron syntax — default: daily at 8 AM)
CRON_SCHEDULE=0 8 * * *

# Log level: DEBUG, INFO, WARN, ERROR
LOG_LEVEL=INFO

# Continuous mode delay (minutes between runs)
LOOP_DELAY_MINUTES=300

# Video mode: 'audio' (1080p via FFmpeg) or 'video' (NotebookLM native)
VIDEO_MODE=audio

# Blog server port
BLOG_PORT=3456
```

### 3. Login to Google (one-time)

```bash
npm run login
```

This opens a browser — sign into your Google account that has NotebookLM access. Close the browser when done. Your session is saved in `user_data/`.

### 4. Run

```bash
# Single run
npm start

# Continuous mode (runs every 5 hours)
npm run loop

# Start blog server
npm run blog

# Run everything (bot loop + blog)
npm run service
```

## 📋 Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run the full pipeline once |
| `npm run loop` | Continuous mode (every 5 hours) |
| `npm run blog` | Start blog server |
| `npm run service` | Run bot loop + blog together |
| `npm run login` | Manual Google login (one-time setup) |
| `npm run generate` | Generate script only (no video/upload) |
| `npm run upload` | Upload a file to YouTube |
| `npm run schedule` | Start cron scheduler |
| `npm run check` | Test Gemini API key |

## 🌐 Blog Website

The built-in blog runs at `http://localhost:3456` and features:

- **Dark purple theme** with responsive design
- **Post cards** with YouTube embeds, viral scores, category badges
- **Full post pages** with complete Telugu script
- **REST API** at `/api/posts` for programmatic access
- Color-coded categories: 🔴 Crime, 🟡 Entertainment, 🔵 Tech, 🟢 Sports, 🟣 Politics, 🩷 Local

## ⚙️ Video Modes

| Mode | Quality | How It Works |
|------|---------|-------------|
| `audio` (default) | **1080p** | Audio Overview → FFmpeg converts to 1080p MP4 with title overlay |
| `video` | Lower | NotebookLM's native Video Overview (auto-generated slideshow) |

Set via `VIDEO_MODE` in `.env`.

## 🛡️ Security

- `.env` with API keys is **never committed** (in `.gitignore`)
- YouTube OAuth tokens stored locally in `youtube_token.json` (gitignored)
- Browser session data in `user_data/` (gitignored)
- Stealth plugin hides automation signals from Google

## 📰 News Sources

The bot aggregates from 7 Google News RSS feeds:

- Telugu trending & local news
- Andhra Pradesh / Telangana
- Crime & sensational
- Trending India
- Tollywood / Telugu cinema
- Technology & AI
- Cricket & sports

Gemini AI picks the **most viral story** based on shock value, Telugu relevance, shareability, curiosity gap, and timeliness.

## 🏗️ Architecture

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│  RSS Feeds  │───▶│  Gemini AI   │───▶│  NotebookLM  │
│  (7 feeds)  │    │ Viral Score  │    │  Audio/Video │
└─────────────┘    │ Telugu Script│    │  Generation  │
                   └──────────────┘    └──────┬───────┘
                                              │
                   ┌──────────────┐    ┌──────▼───────┐
                   │   Blog UI    │◀───│   YouTube    │
                   │  posts.json  │    │   Upload     │
                   └──────────────┘    └──────────────┘
```

## License

ISC
