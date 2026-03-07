const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { getTrendingTeluguNews, generateTeluguScript } = require('./script_generator');
const { uploadToYouTube, setThumbnail } = require('./youtube_uploader');
const log = require('./logger');
require('dotenv').config();

chromium.use(stealth());

const NOTEBOOKLM_URL = 'https://notebooklm.google.com/';
const FFMPEG = require('ffmpeg-static');
const VIDEO_MODE = process.env.VIDEO_MODE || 'video';

/**
 * Delete old notebooks from the dashboard to avoid clutter.
 */
async function cleanupOldNotebooks(page, keepCount = 1) {
  log.info('Checking for old notebooks to clean up...');

  const notebookCards = page.locator('[role="listitem"], .notebook-card, [data-notebook-id]');
  const count = await notebookCards.count();

  if (count <= keepCount) {
    log.info(`Found ${count} notebook(s), nothing to clean up.`);
    return;
  }

  const toDelete = count - keepCount;
  log.info(`Found ${count} notebooks. Deleting ${toDelete} oldest...`);

  for (let i = 0; i < toDelete; i++) {
    try {
      const card = notebookCards.last();
      if (!(await card.isVisible())) break;

      const moreBtn = card.locator('button[aria-label*="more" i], button[aria-label*="menu" i], button:has-text("more_vert")').first();
      if (await moreBtn.isVisible()) {
        await moreBtn.click();
      } else {
        await card.click({ button: 'right' });
      }

      const deleteOption = page.locator('[role="menuitem"]:has-text("Delete"), button:has-text("Delete")').first();
      await deleteOption.waitFor({ state: 'visible', timeout: 5000 });
      await deleteOption.click();

      const confirmBtn = page.locator('button:has-text("Delete"), button:has-text("Confirm")').last();
      try {
        await confirmBtn.waitFor({ state: 'visible', timeout: 3000 });
        await confirmBtn.click();
      } catch (_) {}

      await page.waitForLoadState('domcontentloaded');
      log.success(`Deleted notebook ${i + 1}/${toDelete}`);
    } catch (err) {
      log.warn(`Could not delete notebook ${i + 1}: ${err.message}`);
      break;
    }
  }
}

// ==================== VIDEO OVERVIEW HELPER ====================
async function generateVideoOverview(page, context) {
  log.step(7, 'Triggering Video Overview generation...');

  // Dismiss any leftover CDK overlays/dialogs that might block clicks
  try {
    const backdrop = page.locator('.cdk-overlay-backdrop-showing');
    if (await backdrop.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  } catch (_) {}

  const videoOverviewLink = page.locator('text="Video Overview"').first();
  await videoOverviewLink.waitFor({ state: 'visible', timeout: 30000 });
  await videoOverviewLink.click();
  await page.waitForTimeout(2000);

  // Look for a dialog (customization) or a page-level Generate button
  const dialog = page.locator('[role="dialog"], mat-dialog-container').last();
  const dialogVisible = await dialog.isVisible().catch(() => false);

  if (dialogVisible) {
    log.info('Video customization dialog opened.');
    const generateBtn = dialog.locator(
      'button:has-text("Generate"), button:has-text("Create"), button:has-text("Start")'
    ).first();
    if (await generateBtn.isVisible()) {
      await generateBtn.click();
    }
    try {
      await dialog.waitFor({ state: 'hidden', timeout: 30000 });
    } catch (_) {
      await page.keyboard.press('Escape');
    }
  } else {
    const pageGenerateBtn = page.locator(
      'button:has-text("Generate"), button:has-text("Create video"), button:has-text("Start")'
    ).first();
    if (await pageGenerateBtn.isVisible().catch(() => false)) {
      await pageGenerateBtn.click();
    } else {
      const customizeVideoBtn = page.locator('button[aria-label*="Video" i]').first();
      if (await customizeVideoBtn.isVisible().catch(() => false)) {
        await customizeVideoBtn.click();
        await page.waitForTimeout(2000);
        const dialog2 = page.locator('[role="dialog"], mat-dialog-container').last();
        if (await dialog2.isVisible().catch(() => false)) {
          const genBtn = dialog2.locator('button:has-text("Generate"), button:has-text("Create")').first();
          if (await genBtn.isVisible()) {
            await genBtn.click();
            try { await dialog2.waitFor({ state: 'hidden', timeout: 30000 }); } catch (_) {}
          }
        }
      }
    }
  }

  // Watch for new tabs
  let activePage = page;
  context.on('page', (newPage) => {
    log.info('New tab opened: ' + newPage.url());
    activePage = newPage;
  });

  // Poll for video readiness
  log.info('Waiting for video generation (up to 15 minutes)...');
  const maxWaitMs = 900000;
  const pollMs = 15000;
  const startTime = Date.now();
  let videoFound = false;

  while (Date.now() - startTime < maxWaitMs) {
    for (const pg of [page, activePage]) {
      try {
        const ready = pg.locator([
          'video',
          'button:has-text("play_arrow")',
          'button:has-text("play_circle")',
          'button[aria-label*="Play" i]',
          'button[aria-label*="Download" i]',
          'button[aria-label*="Pause" i]',
          '[role="slider"]',
        ].join(', ')).first();
        if (await ready.isVisible().catch(() => false)) {
          videoFound = true;
          activePage = pg;
          break;
        }
      } catch (_) {}
    }
    if (videoFound) break;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    log.info(`Still generating... (${elapsed}s elapsed)`);
    await new Promise(r => setTimeout(r, pollMs));
  }

  if (!videoFound) {
    for (const pg of context.pages()) {
      try {
        const ready = pg.locator('video, button[aria-label*="Play" i], button[aria-label*="Download" i]').first();
        if (await ready.isVisible().catch(() => false)) {
          videoFound = true;
          activePage = pg;
          break;
        }
      } catch (_) {}
    }
  }
  if (!videoFound) throw new Error('Video generation timed out after 15 minutes');
  log.success('Video generated!');

  // Download
  log.step(8, 'Downloading video...');
  const videoMoreBtn = activePage.locator('button[aria-label="More"]').last();
  await videoMoreBtn.waitFor({ state: 'visible', timeout: 5000 });
  await videoMoreBtn.click();

  const downloadLink = activePage.locator('[role="menuitem"]').filter({ hasText: 'Download' })
    .or(activePage.locator('button').filter({ hasText: 'Download' }))
    .or(activePage.getByText('Download')).first();
  await downloadLink.waitFor({ state: 'visible', timeout: 5000 });

  let download;
  try {
    const dlPromise = activePage.waitForEvent('download', { timeout: 120000 });
    await downloadLink.click();
    download = await dlPromise;
  } catch (dlErr) {
    throw new Error(`Video download failed or timed out: ${dlErr.message}`);
  }

  const suggestedName = download.suggestedFilename() || `telugu_news_${Date.now()}.mp4`;
  const dlPath = path.join(__dirname, 'downloads', suggestedName);
  fs.mkdirSync(path.join(__dirname, 'downloads'), { recursive: true });
  await download.saveAs(dlPath);

  // Validate downloaded file
  if (!fs.existsSync(dlPath) || fs.statSync(dlPath).size < 10000) {
    throw new Error(`Downloaded file is missing or too small: ${dlPath}`);
  }
  log.success(`Video saved to: ${dlPath} (${Math.round(fs.statSync(dlPath).size / 1024)}KB)`);
  return dlPath;
}

// ==================== POST-PROCESS VIDEO (trim end screen + remove watermark) ====================
function postProcessVideo(inputPath) {
  log.info('Post-processing video: removing watermark & end screen...');
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  const outputPath = path.join(dir, `${base}_clean${ext}`);

  // Get duration
  let duration;
  try {
    const probe = execFileSync(FFMPEG, [
      '-i', inputPath, '-f', 'null', '-'
    ], { timeout: 30000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  } catch (e) {
    // ffmpeg prints info to stderr even on success
    const match = (e.stderr || e.message || '').match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (match) {
      duration = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
    }
  }

  // Trim last 8 seconds (NotebookLM end screen) and use delogo to blur the watermark area
  // Watermark is typically in the bottom-right corner
  const trimEnd = duration ? duration - 8 : null;
  const args = ['-y', '-i', inputPath];

  if (trimEnd && trimEnd > 10) {
    args.push('-t', String(trimEnd));
  }

  // Just trim the end screen (last 8 seconds) — skip delogo as it's unreliable across ffmpeg versions
  args.push(
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
    '-c:a', 'copy',
    outputPath
  );

  try {
    execFileSync(FFMPEG, args, { timeout: 300000 });
    log.success(`Cleaned video saved to: ${outputPath}`);
    return outputPath;
  } catch (err) {
    log.warn(`Post-processing failed: ${err.message}. Using original video.`);
    return inputPath;
  }
}

// ==================== THUMBNAIL GENERATION VIA GEMINI BROWSER ====================
async function generateThumbnailWithGemini(browserContext, title, category, selectedNews) {
  log.info('Generating thumbnail via Gemini in browser...');

  const thumbDir = path.join(__dirname, 'downloads');
  fs.mkdirSync(thumbDir, { recursive: true });
  const thumbPath = path.join(thumbDir, `thumbnail_${Date.now()}.png`);

  // Build a compelling thumbnail prompt
  const categoryStyle = {
    crime: 'dark dramatic background, red warning colors, police lights, sense of danger',
    entertainment: 'colorful glamorous background, movie poster style, star-studded, bright lights',
    tech: 'futuristic digital background, blue and purple neon, circuit board pattern, modern tech',
    sports: 'stadium background, action shot, green field, dynamic motion blur',
    politics: 'government building background, formal setting, national flag colors, serious tone',
    local: 'Indian city background, local streets, vibrant colors, community feel',
  };
  const style = categoryStyle[category] || 'dramatic news studio background, bold colors, professional';

  const prompt = `Generate a photorealistic YouTube thumbnail image (16:9 aspect ratio, 1280x720). Topic: ${selectedNews || title}. Style: ${style}. Requirements: Eye-catching and dramatic, designed to maximize clicks. Bold visual composition with high contrast. NO TEXT or letters on the image at all. Professional YouTube thumbnail quality. Emotional and attention-grabbing visual that represents the news topic. Vivid saturated colors.`;

  const geminiPage = await browserContext.newPage();
  try {
    await geminiPage.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await geminiPage.waitForTimeout(3000);

    // Wait for the chat input to be ready
    const inputSelector = [
      '.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'rich-textarea div[contenteditable="true"]',
      'textarea',
      '[aria-label*="Enter" i][contenteditable="true"]',
      'div.input-area [contenteditable="true"]',
    ].join(', ');

    const inputBox = geminiPage.locator(inputSelector).first();
    await inputBox.waitFor({ state: 'visible', timeout: 30000 });
    log.info('Gemini chat input found. Typing thumbnail prompt...');

    // Click to focus and type the prompt
    await inputBox.click();
    await geminiPage.waitForTimeout(500);
    await inputBox.fill(prompt);
    await geminiPage.waitForTimeout(500);

    // Submit the prompt by pressing Enter
    await geminiPage.keyboard.press('Enter');
    log.info('Prompt sent. Waiting for image generation...');

    // Wait for image to appear in the response (up to 3 minutes)
    const imageSelector = [
      '.response-container img[src*="blob:"]',
      '.response-container img[src*="data:"]',
      '.model-response-text img',
      'message-content img',
      '.response img',
      'img.generated-image',
      '.image-container img',
      'img[alt*="Generated" i]',
      '.response-container canvas',
    ].join(', ');

    const maxWaitMs = 180000;
    const pollMs = 5000;
    const startTime = Date.now();
    let imageFound = false;
    let imageElement = null;

    while (Date.now() - startTime < maxWaitMs) {
      // Check for generated images in the response
      const images = geminiPage.locator(imageSelector);
      const count = await images.count().catch(() => 0);
      if (count > 0) {
        imageElement = images.first();
        const src = await imageElement.getAttribute('src').catch(() => '');
        if (src && src.length > 10) {
          imageFound = true;
          break;
        }
      }

      // Also check for any img inside the latest response turn
      const turnImages = geminiPage.locator('.conversation-turn:last-child img, .model-response:last-child img, [data-turn-role="model"] img');
      const turnCount = await turnImages.count().catch(() => 0);
      if (turnCount > 0) {
        imageElement = turnImages.first();
        const src = await imageElement.getAttribute('src').catch(() => '');
        if (src && src.length > 10) {
          imageFound = true;
          break;
        }
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      log.info(`Waiting for Gemini image... (${elapsed}s elapsed)`);
      await geminiPage.waitForTimeout(pollMs);
    }

    if (!imageFound || !imageElement) {
      log.warn('Gemini image generation timed out or no image found.');
      return null;
    }

    log.success('Image generated! Downloading...');

    // Try to download via right-click context menu or direct src
    // First attempt: get the image src and download it
    const src = await imageElement.getAttribute('src').catch(() => '');

    if (src && src.startsWith('data:')) {
      // data URI — extract base64
      const base64Match = src.match(/base64,(.+)/);
      if (base64Match) {
        const buffer = Buffer.from(base64Match[1], 'base64');
        fs.writeFileSync(thumbPath, buffer);
        log.success(`Thumbnail saved: ${thumbPath} (${Math.round(buffer.length / 1024)}KB)`);
        return thumbPath;
      }
    }

    if (src && (src.startsWith('blob:') || src.startsWith('http'))) {
      // Use page.evaluate to fetch the image as a blob and convert to base64
      const base64Data = await geminiPage.evaluate(async (imgSrc) => {
        try {
          const resp = await fetch(imgSrc);
          const blob = await resp.blob();
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
          });
        } catch {
          return null;
        }
      }, src);

      if (base64Data) {
        const base64Match = base64Data.match(/base64,(.+)/);
        if (base64Match) {
          const buffer = Buffer.from(base64Match[1], 'base64');
          fs.writeFileSync(thumbPath, buffer);
          log.success(`Thumbnail saved: ${thumbPath} (${Math.round(buffer.length / 1024)}KB)`);
          return thumbPath;
        }
      }
    }

    // Fallback: screenshot the image element
    log.info('Falling back to screenshot of generated image...');
    await imageElement.screenshot({ path: thumbPath });
    const stat = fs.statSync(thumbPath);
    if (stat.size > 5000) {
      log.success(`Thumbnail saved via screenshot: ${thumbPath} (${Math.round(stat.size / 1024)}KB)`);
      return thumbPath;
    }

    log.warn('Screenshot too small, thumbnail may be invalid.');
    return null;
  } catch (err) {
    log.warn(`Gemini browser thumbnail failed: ${err.message}`);
    return null;
  } finally {
    await geminiPage.close().catch(() => {});
  }
}

// ==================== AUDIO OVERVIEW + FFMPEG HELPER ====================
async function generateAudioOverviewAndConvert(page, context, data) {
  log.step(7, 'Triggering Audio Overview generation (high-quality mode)...');

  // Click "Customize Audio Overview" (the edit/pencil button)
  const customizeBtn = page.locator('button[aria-label*="Customize" i]')
    .or(page.locator('button[aria-label*="Audio Overview" i]'))
    .or(page.locator('button:has-text("Customize")'))
    .first();
  await customizeBtn.waitFor({ state: 'visible', timeout: 30000 });
  await customizeBtn.click();
  await page.waitForTimeout(2000);

  // Click Default or leave default, then Generate
  const dialog = page.locator('[role="dialog"], mat-dialog-container').last();
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  // Click "Default" radio if present
  const defaultRadio = dialog.locator('mat-radio-button:has-text("Default"), label:has-text("Default")').first();
  if (await defaultRadio.isVisible().catch(() => false)) {
    await defaultRadio.click();
    await page.waitForTimeout(500);
  }

  // Click Generate
  const generateBtn = dialog.locator('button:has-text("Generate")').first();
  await generateBtn.waitFor({ state: 'visible', timeout: 5000 });
  await generateBtn.click();
  log.info('Audio generation started...');

  try {
    await dialog.waitFor({ state: 'hidden', timeout: 30000 });
  } catch (_) {
    await page.keyboard.press('Escape');
  }

  // Poll for audio readiness (play button or audio player appears)
  log.info('Waiting for audio generation (up to 15 minutes)...');
  const maxWaitMs = 900000;
  const pollMs = 15000;
  const startTime = Date.now();
  let audioReady = false;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const playBtn = page.locator(
        'button:has-text("play_arrow"), button:has-text("play_circle"), button[aria-label*="Play" i]'
      ).first();
      if (await playBtn.isVisible().catch(() => false)) {
        audioReady = true;
        break;
      }
    } catch (_) {}
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    log.info(`Audio generating... (${elapsed}s elapsed)`);
    await new Promise(r => setTimeout(r, pollMs));
  }

  if (!audioReady) throw new Error('Audio generation timed out after 15 minutes');
  log.success('Audio generated!');

  // Download audio
  log.step(8, 'Downloading audio...');
  const moreBtn = page.locator('button[aria-label="More"]').last();
  await moreBtn.waitFor({ state: 'visible', timeout: 5000 });
  await moreBtn.click();

  const downloadLink = page.locator('[role="menuitem"]').filter({ hasText: 'Download' })
    .or(page.locator('button').filter({ hasText: 'Download' }))
    .or(page.getByText('Download')).first();
  await downloadLink.waitFor({ state: 'visible', timeout: 5000 });

  const dlPromise = page.waitForEvent('download');
  await downloadLink.click();
  const download = await dlPromise;

  const audioName = download.suggestedFilename() || `telugu_audio_${Date.now()}.m4a`;
  const audioPath = path.join(__dirname, 'downloads', audioName);
  fs.mkdirSync(path.join(__dirname, 'downloads'), { recursive: true });
  await download.saveAs(audioPath);
  log.success(`Audio saved to: ${audioPath}`);

  // Convert audio to 1080p video with FFmpeg
  log.info('Converting audio to 1080p video with FFmpeg...');
  const videoName = audioName.replace(/\.[^.]+$/, '.mp4');
  const videoPath = path.join(__dirname, 'downloads', videoName);

  // Create a dark gradient background image for the video
  const bgPath = path.join(__dirname, 'downloads', '_bg.png');
  try {
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi',
      '-i', 'color=c=0x1a1a2e:s=1920x1080:d=1,format=rgb24',
      '-frames:v', '1', bgPath
    ], { timeout: 15000 });
  } catch (_) {
    // Fallback: create a simple dark frame
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi',
      '-i', 'color=c=black:s=1920x1080:d=1',
      '-frames:v', '1', bgPath
    ], { timeout: 15000 });
  }

  // Build video: loop background image + audio → 1080p MP4
  const title = data.seo && data.seo.title ? data.seo.title : 'Telugu News';
  execFileSync('ffmpeg', [
    '-y',
    '-loop', '1', '-i', bgPath,
    '-i', audioPath,
    '-c:v', 'libx264', '-tune', 'stillimage',
    '-c:a', 'aac', '-b:a', '192k',
    '-vf', `drawtext=text='${title.replace(/'/g, "\\'")}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2:font=Arial`,
    '-shortest',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    videoPath
  ], { timeout: 600000 }); // 10 min timeout for FFmpeg

  log.success(`1080p video created: ${videoPath}`);

  // Clean up temp background
  try { fs.unlinkSync(bgPath); } catch (_) {}

  return videoPath;
}

// ==================== ADD SOURCE TO NOTEBOOK HELPER ====================
async function addSourceToNotebook(page, title, content) {
  // Open the "Add sources" dialog
  try {
    if (await page.isVisible('text="Add sources"')) {
      await page.click('text="Add sources"');
    } else {
      // After first source, the button becomes a "+" icon
      const plusButton = page.locator('button:has([alt="Add sources"]), button:has-text("+"), button[aria-label*="source" i]').first();
      if (await plusButton.isVisible()) {
        await plusButton.click();
      }
    }
  } catch (_) {}

  await page.click('text="Copied text"');

  // Target the actual mat-dialog-container (avoid emoji keyboard [role="dialog"])
  const modal = page.locator('mat-dialog-container').last();
  await modal.waitFor({ state: 'visible', timeout: 10000 });

  const textareas = modal.locator('textarea');
  const count = await textareas.count();

  if (count >= 2) {
    log.info(`Filling title and content in modal (Found ${count} textareas)...`);
    await textareas.nth(0).fill(title);
    await textareas.nth(1).click();
    await textareas.nth(1).fill(content);
  } else if (count === 1) {
    log.info(`Filling content in modal (Found 1 textarea)...`);
    await textareas.first().click();
    await textareas.first().fill(content);
  } else {
    const enabledTextareas = page.locator('textarea:not([disabled])');
    if (await enabledTextareas.count() > 0) {
      await enabledTextareas.first().fill(content);
    } else {
      throw new Error('Could not find an enabled textarea to paste source.');
    }
  }

  // Force input event to enable Insert button
  await page.keyboard.press('Space');

  const insertBtn = modal.locator('button:has-text("Insert")');
  await insertBtn.waitFor({ state: 'visible' });

  log.info("Waiting for 'Insert' button to be enabled...");
  try {
    await page.waitForFunction(() => {
      const el = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes("Insert"));
      return el && !el.disabled && !el.getAttribute('disabled');
    }, { timeout: 15000 });
  } catch (_) {
    log.warn('Insert button still disabled, trying force click...');
  }

  await insertBtn.click({ force: true });
  await insertBtn.waitFor({ state: 'hidden', timeout: 15000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000); // Brief pause for source processing to start
}

async function runAutomation() {
  const userDataDir = path.join(__dirname, 'user_data');
  const outputFilePath = path.join(__dirname, 'daily_output.json');

  // 1. Generate the Telugu Script & SEO
  log.step(1, 'Scouting Telugu News & Generating Script...');
  let data;
  try {
    const news = await getTrendingTeluguNews();
    if (news.length === 0) {
      log.info('No new news to cover — all articles already posted. Skipping this run.');
      return;
    }
    data = await generateTeluguScript(news);
    if (data.viral_score && data.viral_score < 5) {
      log.info(`Viral score too low (${data.viral_score}/10). Skipping video generation.`);
      return;
    }
    fs.writeFileSync(outputFilePath, JSON.stringify(data, null, 2));
    log.success('Script generated and saved.');
  } catch (genErr) {
    // If generation fails (e.g. rate limit), try to reuse existing script
    if (fs.existsSync(outputFilePath)) {
      log.warn(`Script generation failed: ${genErr.message}`);
      log.info('Reusing existing daily_output.json...');
      data = JSON.parse(fs.readFileSync(outputFilePath, 'utf-8'));
    } else {
      throw genErr;
    }
  }

  // 2. Launch NotebookLM
  log.step(2, 'Opening NotebookLM...');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-gpu-sandbox',
    ],
    timeout: 60000,
  });

  const page = await context.newPage();
  let activePage = page; // may change if video opens in new tab
  
  try {
    await page.goto(NOTEBOOKLM_URL, { waitUntil: 'domcontentloaded' });

    // 3. Clean up old notebooks
    log.step(3, 'Cleaning up old notebooks...');
    await cleanupOldNotebooks(page);

    // 4. Create New Notebook
    log.step(4, 'Creating new notebook...');
    try {
      const createBtn = page.locator('text="Create new notebook"');
      await createBtn.waitFor({ state: 'visible', timeout: 10000 });
      await createBtn.click();
    } catch (e) {
      log.warn("'Create new notebook' button not found, maybe we are already in one?");
    }

    // Wait for notebook to load — look for the source panel or chat area
    await page.waitForLoadState('domcontentloaded');
    await page.locator('textarea, [role="textbox"]').or(page.getByText('Add sources')).first().waitFor({
      state: 'visible',
      timeout: 15000,
    });

    // 5. Upload research + script as sources to NotebookLM
    log.step(5, 'Uploading source content to NotebookLM...');

    // Build a comprehensive source document from research + script (single source is more reliable)
    const sourceContent = data.research
      ? `${data.research}\n\n=== TELUGU SCRIPT ===\n${data.script}`
      : data.script;

    await addSourceToNotebook(page, 'Research & Script', sourceContent);
    log.success('Source inserted successfully.');

    // Wait for the source to be processed (don't use networkidle — NotebookLM keeps connections open)
    await page.waitForLoadState('domcontentloaded');

    // 6. Wait for source processing to complete
    log.step(6, 'Waiting for source to be processed...');
    try {
      await page.locator('button[aria-label="Copy summary"], button:has-text("copy_all")').first()
        .waitFor({ state: 'visible', timeout: 120000 });
      log.success('Source processed (summary ready).');
    } catch (_) {
      log.info('Summary not detected, waiting 30s for source processing...');
      await page.waitForTimeout(30000);
    }

    let downloadPath;

    if (VIDEO_MODE === 'video') {
      downloadPath = await generateVideoOverview(page, context);
    } else {
      downloadPath = await generateAudioOverviewAndConvert(page, context, data);
    }

    // 8b. Post-process: remove watermark & end screen
    log.step('8b', 'Post-processing video (removing watermark & end screen)...');
    downloadPath = postProcessVideo(downloadPath);

    // 9. Generate thumbnail with Gemini Image API
    log.step(9, 'Generating YouTube thumbnail with Gemini...');
    let thumbnailPath = null;
    try {
      thumbnailPath = await generateThumbnailWithGemini(
        context,
        data.seo.title,
        data.category,
        data.selected_news
      );
    } catch (thumbErr) {
      log.warn('Thumbnail generation failed:', thumbErr.message);
    }

    // 10. YouTube Upload
    let videoUrl = null;
    if (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) {
      log.step(10, 'Uploading to YouTube...');
      try {
        videoUrl = await uploadToYouTube(downloadPath, data.seo);
        log.success(`YouTube upload complete: ${videoUrl}`);

        // Set custom thumbnail if generated
        if (thumbnailPath && videoUrl) {
          log.info('Setting custom thumbnail on YouTube video...');
          try {
            await setThumbnail(videoUrl, thumbnailPath);
            log.success('Custom thumbnail set!');
          } catch (thumbSetErr) {
            log.warn('Could not set thumbnail:', thumbSetErr.message);
          }
        }
      } catch (uploadErr) {
        log.error('YouTube upload failed:', uploadErr.message);
        log.info('You can manually upload later: node youtube_uploader.js ' + downloadPath);
      }
    } else {
      log.info('YouTube credentials not configured. Skipping upload.');
    }

    // 11. Save post to blog database (atomic write)
    log.step(11, 'Saving post to blog...');
    try {
      const postsFile = path.join(__dirname, 'posts.json');
      const tempFile = postsFile + '.tmp';
      const posts = fs.existsSync(postsFile) ? JSON.parse(fs.readFileSync(postsFile, 'utf-8')) : [];
      posts.unshift({
        id: Date.now(),
        date: new Date().toISOString(),
        title: data.seo.title,
        description: data.seo.description,
        tags: data.seo.tags,
        script: data.script,
        category: data.category || 'general',
        viral_score: data.viral_score || null,
        selected_news: data.selected_news || null,
        youtubeUrl: videoUrl,
        videoFile: downloadPath ? path.basename(downloadPath) : null,
        mode: VIDEO_MODE,
      });
      // Write to temp file first, then rename (atomic)
      fs.writeFileSync(tempFile, JSON.stringify(posts, null, 2));
      JSON.parse(fs.readFileSync(tempFile, 'utf-8')); // validate before replacing
      fs.renameSync(tempFile, postsFile);
      log.success('Post saved to blog database.');
    } catch (postErr) {
      log.warn('Could not save post to blog:', postErr.message);
      try { fs.unlinkSync(path.join(__dirname, 'posts.json.tmp')); } catch (_) {}
    }

    // 12. SEO Output
    log.info('--- YOUTUBE SEO READY ---');
    log.info(`TITLE: ${data.seo.title}`);
    log.info(`DESC: ${data.seo.description}`);
    log.info(`TAGS: ${data.seo.tags.join(', ')}`);
    log.info('-------------------------');

  } catch (err) {
    log.error('Automation Error:', err.message);
    try {
      if (page && !page.isClosed()) {
        await page.screenshot({ path: 'error_screenshot.png' });
      }
    } catch (_) {
      log.warn('Could not save error screenshot (page may be closed).');
    }
    throw err; // Re-throw so continuous mode can track failures
  } finally {
    if (context) {
      try {
        await context.close();
      } catch (closeErr) {
        log.warn(`Browser cleanup: ${closeErr.message}`);
      }
    }
  }
}

// Continuous mode: run in a loop with delay between runs
const LOOP_DELAY_MS = parseInt(process.env.LOOP_DELAY_MINUTES || '60', 10) * 60 * 1000;
const CONTINUOUS = process.argv.includes('--loop') || process.argv.includes('--continuous');

async function main() {
  if (CONTINUOUS) {
    log.info(`=== CONTINUOUS MODE: Running every ${LOOP_DELAY_MS / 60000} minutes ===`);
    let runCount = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;
    while (true) {
      runCount++;
      log.info(`\n========== RUN #${runCount} started at ${new Date().toLocaleString()} ==========\n`);
      try {
        await runAutomation();
        consecutiveErrors = 0; // Reset on success
      } catch (err) {
        consecutiveErrors++;
        log.error(`Run #${runCount} failed (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, err.message);
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          log.error(`CRITICAL: ${MAX_CONSECUTIVE_ERRORS} consecutive failures. Shutting down to prevent resource waste.`);
          log.error('Fix the issue and restart the bot.');
          process.exit(1);
        }
      }
      log.info(`Run #${runCount} complete. Next run in ${LOOP_DELAY_MS / 60000} minutes...`);
      await new Promise(r => setTimeout(r, LOOP_DELAY_MS));
    }
  } else {
    await runAutomation();
  }
}

main();
