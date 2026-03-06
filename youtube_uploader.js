const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const log = require('./logger');
require('dotenv').config();

const TOKEN_PATH = path.join(__dirname, 'youtube_token.json');

/**
 * Get an authenticated YouTube client.
 * On first run, prints a URL for the user to authorize.
 * After authorization, stores the refresh token for future runs.
 */
async function getAuthClient() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET must be set in .env.\n' +
      'Create OAuth 2.0 credentials at https://console.cloud.google.com/apis/credentials\n' +
      'Enable the YouTube Data API v3.'
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'urn:ietf:wg:oauth:2.0:oob' // For CLI-based auth
  );

  // Check for existing token
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oauth2Client.setCredentials(token);

    // Refresh if expired
    if (token.expiry_date && token.expiry_date < Date.now()) {
      log.info('Refreshing YouTube access token...');
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2));
    }
    return oauth2Client;
  }

  // First-time setup: user must authorize
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
  });

  log.info('No YouTube token found. Authorize this app by visiting:');
  console.log('\n' + authUrl + '\n');

  // Read auth code from stdin
  const code = await new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Enter the authorization code: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  log.success('YouTube token saved.');
  return oauth2Client;
}

/**
 * Upload a video/audio file to YouTube with SEO metadata.
 * @param {string} filePath - Path to the media file
 * @param {object} seo - SEO data { title, description, tags }
 * @returns {string} The YouTube video URL
 */
async function uploadToYouTube(filePath, seo) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  log.info('Authenticating with YouTube...');
  const auth = await getAuthClient();
  const youtube = google.youtube({ version: 'v3', auth });

  log.info(`Uploading: ${path.basename(filePath)}`);
  log.info(`Title: ${seo.title}`);

  const res = await youtube.videos.insert({
    part: 'snippet,status',
    requestBody: {
      snippet: {
        title: seo.title,
        description: seo.description,
        tags: seo.tags,
        categoryId: '25', // News & Politics
        defaultLanguage: 'te',
        defaultAudioLanguage: 'te',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(filePath),
    },
  });

  const videoUrl = `https://www.youtube.com/watch?v=${res.data.id}`;
  log.success(`Upload complete! Video URL: ${videoUrl}`);
  log.info('Video is PUBLIC and live!');
  return videoUrl;
}

// CLI: node youtube_uploader.js <filepath>
if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.log('Usage: node youtube_uploader.js <media-file-path>');
    console.log('       Reads SEO from daily_output.json');
    process.exit(1);
  }

  const outputPath = path.join(__dirname, 'daily_output.json');
  if (!fs.existsSync(outputPath)) {
    console.error('daily_output.json not found. Run script_generator.js first.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
  uploadToYouTube(filePath, data.seo).catch(err => {
    log.error('Upload failed:', err.message);
    process.exit(1);
  });
}

module.exports = { uploadToYouTube, getAuthClient };
