const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { getTrendingTeluguNews, generateTeluguScript } = require('./script_generator');
const { uploadToYouTube } = require('./youtube_uploader');
const log = require('./logger');
require('dotenv').config();

chromium.use(stealth());

const NOTEBOOKLM_URL = 'https://notebooklm.google.com/';
// 'video' = NotebookLM Video Overview (lower quality, auto-generated)
// 'audio' = NotebookLM Audio Overview + FFmpeg conversion to 1080p video
const VIDEO_MODE = process.env.VIDEO_MODE || 'audio';

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

  const dlPromise = activePage.waitForEvent('download');
  await downloadLink.click();
  const download = await dlPromise;

  const suggestedName = download.suggestedFilename() || `telugu_news_${Date.now()}.mp4`;
  const dlPath = path.join(__dirname, 'downloads', suggestedName);
  fs.mkdirSync(path.join(__dirname, 'downloads'), { recursive: true });
  await download.saveAs(dlPath);
  log.success(`Video saved to: ${dlPath}`);
  return dlPath;
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

async function runAutomation() {
  const userDataDir = path.join(__dirname, 'user_data');
  const outputFilePath = path.join(__dirname, 'daily_output.json');

  // 1. Generate the Telugu Script & SEO
  log.step(1, 'Scouting Telugu News & Generating Script...');
  let data;
  try {
    const news = await getTrendingTeluguNews();
    if (news.length === 0) {
      log.error('No news found. Exiting.');
      return;
    }
    data = await generateTeluguScript(news);
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

    // 5. Upload the Script as a Source
    log.step(5, 'Uploading script content...');
    try {
      if (await page.isVisible('text="Add sources"')) {
        await page.click('text="Add sources"');
      } else {
        const plusButton = page.locator('button:has([alt="Add sources"]), button:has-text("+")');
        if (await plusButton.isVisible()) {
          await plusButton.click();
        }
      }
    } catch (e) {}

    await page.click('text="Copied text"'); 
    
    // Target textareas inside the modal/dialog
    const modal = page.locator('mat-dialog-container, [role="dialog"]');
    await modal.waitFor({ state: 'visible', timeout: 10000 });
    
    const textareas = modal.locator('textarea');
    const count = await textareas.count();
    
    if (count >= 2) {
      log.info(`Filling title and content in modal (Found ${count} textareas)...`);
      await textareas.nth(0).fill(`Telugu AI News - ${new Date().toLocaleDateString()}`);
      await textareas.nth(1).click();
      await textareas.nth(1).fill(data.script);
    } else if (count === 1) {
      log.info('Filling content in modal (Found 1 textarea)...');
      await textareas.first().click();
      await textareas.first().fill(data.script);
    } else {
      log.warn('No textareas found in modal, trying global enabled textareas...');
      const enabledTextareas = page.locator('textarea:not([disabled])');
      if (await enabledTextareas.count() > 0) {
        await enabledTextareas.first().fill(data.script);
      } else {
        throw new Error('Could not find an enabled textarea to paste the script.');
      }
    }

    // Force an input event to ensure the "Insert" button enables
    await page.keyboard.press('Space');

    // Wait for the Insert button to become enabled (event-based, not timeout)
    const insertBtn = modal.locator('button:has-text("Insert")');
    await insertBtn.waitFor({ state: 'visible' });
    
    log.info("Waiting for 'Insert' button to be enabled...");
    try {
      await page.waitForFunction(() => {
        const el = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes("Insert"));
        return el && !el.disabled && !el.getAttribute('disabled');
      }, { timeout: 15000 });
    } catch (e) {
      log.warn('Button still disabled after wait, trying force click...');
    }

    await insertBtn.click({ force: true });
    
    // Wait for the modal to close
    await insertBtn.waitFor({ state: 'hidden', timeout: 15000 });
    log.success('Script inserted successfully.');

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
      // ==================== VIDEO MODE ====================
      // Use NotebookLM's built-in Video Overview (lower resolution)
      downloadPath = await generateVideoOverview(page, context);
    } else {
      // ==================== AUDIO MODE (default) ====================
      // Higher quality: Audio Overview → FFmpeg 1080p conversion
      downloadPath = await generateAudioOverviewAndConvert(page, context, data);
    }

    // 9. YouTube Upload
    let videoUrl = null;
    if (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) {
      log.step(9, 'Uploading to YouTube...');
      try {
        videoUrl = await uploadToYouTube(downloadPath, data.seo);
        log.success(`YouTube upload complete: ${videoUrl}`);
      } catch (uploadErr) {
        log.error('YouTube upload failed:', uploadErr.message);
        log.info('You can manually upload later: node youtube_uploader.js ' + downloadPath);
      }
    } else {
      log.info('YouTube credentials not configured. Skipping upload.');
    }

    // 10. Save post to blog database
    log.step(10, 'Saving post to blog...');
    try {
      const postsFile = path.join(__dirname, 'posts.json');
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
      fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2));
      log.success('Post saved to blog database.');
    } catch (postErr) {
      log.warn('Could not save post to blog:', postErr.message);
    }

    // 11. SEO Output
    log.info('--- YOUTUBE SEO READY ---');
    log.info(`TITLE: ${data.seo.title}`);
    log.info(`DESC: ${data.seo.description}`);
    log.info(`TAGS: ${data.seo.tags.join(', ')}`);
    log.info('-------------------------');

  } catch (err) {
    log.error('Automation Error:', err.message);
    try {
      await page.screenshot({ path: 'error_screenshot.png' });
    } catch (_) {
      log.warn('Could not save error screenshot (page may be closed).');
    }
  } finally {
    try {
      await context.close();
    } catch (_) {}
  }
}

// Continuous mode: run in a loop with delay between runs
const LOOP_DELAY_MS = parseInt(process.env.LOOP_DELAY_MINUTES || '60', 10) * 60 * 1000;
const CONTINUOUS = process.argv.includes('--loop') || process.argv.includes('--continuous');

async function main() {
  if (CONTINUOUS) {
    log.info(`=== CONTINUOUS MODE: Running every ${LOOP_DELAY_MS / 60000} minutes ===`);
    let runCount = 0;
    while (true) {
      runCount++;
      log.info(`\n========== RUN #${runCount} started at ${new Date().toLocaleString()} ==========\n`);
      try {
        await runAutomation();
      } catch (err) {
        log.error(`Run #${runCount} failed:`, err.message);
      }
      log.info(`Run #${runCount} complete. Next run in ${LOOP_DELAY_MS / 60000} minutes...`);
      await new Promise(r => setTimeout(r, LOOP_DELAY_MS));
    }
  } else {
    await runAutomation();
  }
}

main();
