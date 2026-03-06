const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = parseInt(process.env.BLOG_PORT || '3000', 10);
const POSTS_FILE = path.join(__dirname, 'posts.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

// Serve downloaded media files
app.use('/media', express.static(DOWNLOADS_DIR));

function getYouTubeId(url) {
  try { return new URL(url).searchParams.get('v') || ''; } catch { return ''; }
}

function loadPosts() {
  try {
    if (!fs.existsSync(POSTS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// API: get all posts
app.get('/api/posts', (req, res) => {
  try {
    res.json(loadPosts());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

// API: get single post
app.get('/api/posts/:id', (req, res) => {
  try {
    const posts = loadPosts();
    const post = posts.find(p => String(p.id) === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load post' });
  }
});

// Main blog page
app.get('/', (req, res) => {
  const posts = loadPosts();

  const postCards = posts.length === 0
    ? '<div class="empty">No posts yet. Run <code>npm run loop</code> to start generating content!</div>'
    : posts.map(post => {
        const date = new Date(post.date).toLocaleDateString('en-IN', {
          year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const categoryClass = (post.category || 'general').toLowerCase();
        const youtubeEmbed = post.youtubeUrl
          ? `<div class="video-embed"><iframe src="https://www.youtube.com/embed/${getYouTubeId(post.youtubeUrl)}" frameborder="0" allowfullscreen></iframe></div>`
          : (post.videoFile ? `<div class="video-embed"><video controls src="/media/${encodeURIComponent(post.videoFile)}"></video></div>` : '');
        const viralBadge = post.viral_score
          ? `<span class="viral-badge" title="Viral Score">${post.viral_score}/10</span>`
          : '';
        const tags = (post.tags || []).slice(0, 8).map(t =>
          `<span class="tag">${escapeHtml(t)}</span>`
        ).join('');

        return `
        <article class="post-card">
          <div class="post-header">
            <span class="category ${categoryClass}">${escapeHtml(post.category || 'general')}</span>
            ${viralBadge}
            <span class="date">${date}</span>
          </div>
          ${youtubeEmbed}
          <h2 class="post-title">${escapeHtml(post.title)}</h2>
          <p class="post-desc">${escapeHtml(post.description || '').substring(0, 300)}...</p>
          <div class="tags">${tags}</div>
          <a href="/post/${post.id}" class="read-more">Read Full Script →</a>
        </article>`;
      }).join('\n');

  res.send(blogTemplate('Telugu News Bot', postCards, posts.length));
});

// Single post page
app.get('/post/:id', (req, res) => {
  const posts = loadPosts();
  const post = posts.find(p => String(p.id) === req.params.id);
  if (!post) return res.status(404).send(blogTemplate('Not Found', '<div class="empty">Post not found.</div>', 0));

  const date = new Date(post.date).toLocaleDateString('en-IN', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const youtubeEmbed = post.youtubeUrl
    ? `<div class="video-embed large"><iframe src="https://www.youtube.com/embed/${getYouTubeId(post.youtubeUrl)}" frameborder="0" allowfullscreen></iframe></div>`
    : (post.videoFile ? `<div class="video-embed large"><video controls src="/media/${encodeURIComponent(post.videoFile)}"></video></div>` : '');
  const tags = (post.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  const scriptHtml = escapeHtml(post.script || '').replace(/\n/g, '<br>');

  const content = `
    <a href="/" class="back-link">← Back to all posts</a>
    <article class="post-full">
      <div class="post-header">
        <span class="category ${(post.category || 'general').toLowerCase()}">${escapeHtml(post.category || 'general')}</span>
        ${post.viral_score ? `<span class="viral-badge">${post.viral_score}/10</span>` : ''}
        <span class="date">${date}</span>
      </div>
      <h1>${escapeHtml(post.title)}</h1>
      ${post.selected_news ? `<div class="source-news"><strong>Source:</strong> ${escapeHtml(post.selected_news)}</div>` : ''}
      ${youtubeEmbed}
      <div class="description">${escapeHtml(post.description || '')}</div>
      <div class="tags">${tags}</div>
      <h3>Full Script</h3>
      <div class="script-content">${scriptHtml}</div>
      ${post.youtubeUrl ? `<a href="${escapeHtml(post.youtubeUrl)}" target="_blank" class="yt-link">Watch on YouTube →</a>` : ''}
    </article>`;

  res.send(blogTemplate(post.title, content, posts.length));
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function blogTemplate(title, body, totalPosts) {
  return `<!DOCTYPE html>
<html lang="te">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} | Telugu News Bot</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f1a;
      color: #e0e0e0;
      min-height: 100vh;
    }
    header {
      background: linear-gradient(135deg, #1a1a3e, #2d1b69);
      padding: 1.5rem 2rem;
      border-bottom: 2px solid #6c3ce0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo {
      font-size: 1.5rem;
      font-weight: 700;
      color: #fff;
    }
    .logo span { color: #a78bfa; }
    .stats {
      color: #9ca3af;
      font-size: 0.9rem;
    }
    .stats strong { color: #a78bfa; }
    main {
      max-width: 900px;
      margin: 2rem auto;
      padding: 0 1.5rem;
    }
    .post-card {
      background: #1a1a2e;
      border: 1px solid #2a2a4a;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      transition: border-color 0.2s;
    }
    .post-card:hover { border-color: #6c3ce0; }
    .post-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
    }
    .category {
      padding: 0.2rem 0.6rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .category.crime { background: #dc2626; color: #fff; }
    .category.entertainment { background: #f59e0b; color: #000; }
    .category.tech { background: #3b82f6; color: #fff; }
    .category.sports { background: #10b981; color: #fff; }
    .category.politics { background: #8b5cf6; color: #fff; }
    .category.local { background: #ec4899; color: #fff; }
    .category.general, .category.trending { background: #6b7280; color: #fff; }
    .viral-badge {
      background: linear-gradient(135deg, #f59e0b, #ef4444);
      color: #fff;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 700;
    }
    .date { color: #6b7280; font-size: 0.8rem; margin-left: auto; }
    .video-embed {
      margin: 1rem 0;
      border-radius: 8px;
      overflow: hidden;
      position: relative;
      padding-top: 56.25%;
      background: #000;
    }
    .video-embed iframe, .video-embed video {
      position: absolute;
      top: 0; left: 0;
      width: 100%;
      height: 100%;
    }
    .post-title {
      font-size: 1.25rem;
      color: #fff;
      margin-bottom: 0.5rem;
      line-height: 1.4;
    }
    .post-full h1 {
      font-size: 1.75rem;
      color: #fff;
      margin-bottom: 1rem;
      line-height: 1.3;
    }
    .post-desc {
      color: #9ca3af;
      font-size: 0.9rem;
      line-height: 1.6;
      margin-bottom: 0.75rem;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-bottom: 0.75rem;
    }
    .tag {
      background: #2a2a4a;
      color: #a78bfa;
      padding: 0.15rem 0.5rem;
      border-radius: 3px;
      font-size: 0.7rem;
    }
    .read-more {
      color: #a78bfa;
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 600;
    }
    .read-more:hover { text-decoration: underline; }
    .back-link {
      display: inline-block;
      color: #a78bfa;
      text-decoration: none;
      margin-bottom: 1.5rem;
      font-size: 0.9rem;
    }
    .back-link:hover { text-decoration: underline; }
    .source-news {
      background: #2a2a4a;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      font-size: 0.85rem;
      color: #9ca3af;
    }
    .description {
      color: #d1d5db;
      line-height: 1.7;
      margin-bottom: 1rem;
    }
    .script-content {
      background: #16162a;
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 1.5rem;
      line-height: 1.8;
      color: #d1d5db;
      font-size: 0.95rem;
      margin-bottom: 1rem;
    }
    .yt-link {
      display: inline-block;
      background: #dc2626;
      color: #fff;
      padding: 0.5rem 1.25rem;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      margin-top: 0.5rem;
    }
    .yt-link:hover { background: #b91c1c; }
    .empty {
      text-align: center;
      color: #6b7280;
      padding: 3rem;
      font-size: 1.1rem;
    }
    .empty code {
      background: #2a2a4a;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      color: #a78bfa;
    }
    footer {
      text-align: center;
      padding: 2rem;
      color: #4b5563;
      font-size: 0.8rem;
      border-top: 1px solid #1f1f3a;
    }
    @media (max-width: 600px) {
      header { flex-direction: column; gap: 0.5rem; }
      .post-card { padding: 1rem; }
      main { padding: 0 1rem; }
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">📺 Telugu <span>News Bot</span></div>
    <div class="stats"><strong>${totalPosts}</strong> posts published | Runs every 5 hours</div>
  </header>
  <main>${body}</main>
  <footer>Telugu News Bot &mdash; Auto-generated content powered by Gemini AI &amp; NotebookLM</footer>
</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`Blog running at http://localhost:${PORT}`);
});
