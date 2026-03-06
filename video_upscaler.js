const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const log = require('./logger');

/**
 * AI Video Upscaling Module for NotebookLM Automation
 * Enhances downloaded videos to 4K quality using various AI tools
 */

class VideoUpscaler {
  constructor() {
    this.supportedTools = ['topaz', 'waifu2x', 'ffmpeg'];
    this.outputDir = path.join(__dirname, 'upscaled_videos');
    
    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Main upscaling function - automatically detects best available tool
   */
  async upscaleVideo(inputPath, options = {}) {
    const {
      targetResolution = '4K',
      quality = 'high',
      outputFormat = 'mp4'
    } = options;

    log.info(`🎬 Starting ${targetResolution} upscaling for: ${path.basename(inputPath)}`);
    
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }

    // Generate output path
    const fileName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(this.outputDir, `${fileName}_4K.${outputFormat}`);

    try {
      // Try upscaling tools in order of preference
      const upscalingResult = await this.tryUpscalingTools(inputPath, outputPath, quality);
      
      if (upscalingResult.success) {
        log.success(`✅ Video upscaled successfully: ${path.basename(outputPath)}`);
        return outputPath;
      } else {
        log.warn('⚠️ No AI upscaling tools found, using basic ffmpeg enhancement');
        return await this.basicEnhancement(inputPath, outputPath);
      }
    } catch (error) {
      log.error('❌ Upscaling failed:', error.message);
      throw error;
    }
  }

  /**
   * Try different upscaling tools in order of preference
   */
  async tryUpscalingTools(inputPath, outputPath, quality) {
    const tools = [
      { name: 'topaz', check: this.checkTopaz.bind(this), upscale: this.upscaleWithTopaz.bind(this) },
      { name: 'waifu2x', check: this.checkWaifu2x.bind(this), upscale: this.upscaleWithWaifu2x.bind(this) },
      { name: 'ffmpeg', check: this.checkFFmpeg.bind(this), upscale: this.upscaleWithFFmpeg.bind(this) }
    ];

    for (const tool of tools) {
      try {
        if (await tool.check()) {
          log.info(`🔧 Using ${tool.name} for upscaling...`);
          await tool.upscale(inputPath, outputPath, quality);
          return { success: true, tool: tool.name };
        }
      } catch (error) {
        log.warn(`⚠️ ${tool.name} failed:`, error.message);
      }
    }

    return { success: false };
  }

  /**
   * Check if Topaz Video AI is installed
   */
  async checkTopaz() {
    const topazPaths = [
      'C:\\Program Files\\Topaz Labs\\Topaz Video AI\\Topaz Video AI.exe',
      'C:\\Program Files (x86)\\Topaz Labs\\Topaz Video AI\\Topaz Video AI.exe'
    ];

    for (const topazPath of topazPaths) {
      if (fs.existsSync(topazPath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Upscale using Topaz Video AI
   */
  async upscaleWithTopaz(inputPath, outputPath, quality) {
    const topazPath = 'C:\\Program Files\\Topaz Labs\\Topaz Video AI\\Topaz Video AI.exe';
    
    const qualitySettings = {
      'low': '--model "Atlas" --scale 2',
      'medium': '--model "Proteus" --scale 3',
      'high': '--model "Proteus" --scale 4'
    };

    const settings = qualitySettings[quality] || qualitySettings['high'];
    
    const command = `"${topazPath}" --input "${inputPath}" --output "${outputPath}" ${settings} --gpu true`;
    
    return new Promise((resolve, reject) => {
      exec(command, { timeout: 300000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Topaz upscaling failed: ${error.message}`));
        } else {
          log.info('Topaz Video AI upscaling completed');
          resolve();
        }
      });
    });
  }

  /**
   * Check if waifu2x-Extension-GUI is installed
   */
  async checkWaifu2x() {
    const waifu2xPaths = [
      'C:\\Program Files\\waifu2x-Extension-GUI\\waifu2x-Extension-GUI.exe',
      path.join(__dirname, 'waifu2x-Extension-GUI\\waifu2x-Extension-GUI.exe')
    ];

    for (const waifu2xPath of waifu2xPaths) {
      if (fs.existsSync(waifu2xPath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Upscale using waifu2x-Extension-GUI
   */
  async upscaleWithWaifu2x(inputPath, outputPath, quality) {
    const waifu2xPath = 'C:\\Program Files\\waifu2x-Extension-GUI\\waifu2x-Extension-GUI.exe';
    
    const qualitySettings = {
      'low': '--scale 2 --denoise 1',
      'medium': '--scale 3 --denoise 2',
      'high': '--scale 4 --denoise 3'
    };

    const settings = qualitySettings[quality] || qualitySettings['high'];
    
    const command = `"${waifu2xPath}" --input "${inputPath}" --output "${outputPath}" ${settings} --model "Photo"`;
    
    return new Promise((resolve, reject) => {
      exec(command, { timeout: 600000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`waifu2x upscaling failed: ${error.message}`));
        } else {
          log.info('waifu2x upscaling completed');
          resolve();
        }
      });
    });
  }

  /**
   * Check if ffmpeg is installed
   */
  async checkFFmpeg() {
    return new Promise((resolve) => {
      exec('ffmpeg -version', (error) => {
        resolve(!error);
      });
    });
  }

  /**
   * Upscale using ffmpeg with AI filters
   */
  async upscaleWithFFmpeg(inputPath, outputPath, quality) {
    const qualityFilters = {
      'low': 'scale=1920:1080:flags=lanczos',
      'medium': 'scale=2560:1440:flags=lanczos',
      'high': 'scale=3840:2160:flags=lanczos'
    };

    const filter = qualityFilters[quality] || qualityFilters['high'];
    
    const command = `ffmpeg -i "${inputPath}" -vf "${filter},unsharp=5:5:1.0:5:5:0.0,hqdn3d=4:3:6:4" -c:v libx264 -crf 18 -preset slow -c:a copy "${outputPath}"`;
    
    return new Promise((resolve, reject) => {
      exec(command, { timeout: 600000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`FFmpeg upscaling failed: ${error.message}`));
        } else {
          log.info('FFmpeg upscaling completed');
          resolve();
        }
      });
    });
  }

  /**
   * Basic video enhancement using ffmpeg (fallback option)
   */
  async basicEnhancement(inputPath, outputPath) {
    const command = `ffmpeg -i "${inputPath}" -vf "scale=3840:2160:flags=lanczos,unsharp=3:3:1.0:3:3:0.0" -c:v libx264 -crf 23 -preset medium -c:a copy "${outputPath}"`;
    
    return new Promise((resolve, reject) => {
      exec(command, { timeout: 600000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Basic enhancement failed: ${error.message}`));
        } else {
          log.info('Basic video enhancement completed');
          resolve(outputPath);
        }
      });
    });
  }

  /**
   * Batch process multiple videos
   */
  async batchUpscale(videoPaths, options = {}) {
    log.info(`🎬 Starting batch upscaling of ${videoPaths.length} videos...`);
    
    const results = [];
    
    for (let i = 0; i < videoPaths.length; i++) {
      const videoPath = videoPaths[i];
      log.info(`Processing video ${i + 1}/${videoPaths.length}: ${path.basename(videoPath)}`);
      
      try {
        const upscaledPath = await this.upscaleVideo(videoPath, options);
        results.push({ original: videoPath, upscaled: upscaledPath, success: true });
      } catch (error) {
        log.error(`Failed to upscale ${path.basename(videoPath)}:`, error.message);
        results.push({ original: videoPath, upscaled: null, success: false, error: error.message });
      }
    }
    
    log.success(`✅ Batch upscaling completed. Success: ${results.filter(r => r.success).length}/${results.length}`);
    return results;
  }

  /**
   * Get system requirements check
   */
  async checkSystemRequirements() {
    const requirements = {
      topaz: await this.checkTopaz(),
      waifu2x: await this.checkWaifu2x(),
      ffmpeg: await this.checkFFmpeg(),
      gpu: await this.checkGPU()
    };

    log.info('System Requirements Check:');
    log.info(`- Topaz Video AI: ${requirements.topaz ? '✅ Installed' : '❌ Not found'}`);
    log.info(`- waifu2x: ${requirements.waifu2x ? '✅ Installed' : '❌ Not found'}`);
    log.info(`- FFmpeg: ${requirements.ffmpeg ? '✅ Installed' : '❌ Not found'}`);
    log.info(`- GPU Acceleration: ${requirements.gpu ? '✅ Available' : '❌ Not available'}`);

    return requirements;
  }

  /**
   * Check for GPU acceleration support
   */
  async checkGPU() {
    return new Promise((resolve) => {
      exec('nvidia-smi', (error) => {
        resolve(!error);
      });
    });
  }
}

// CLI usage
if (require.main === module) {
  const upscaler = new VideoUpscaler();
  
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  
  if (!inputPath || !outputPath) {
    console.log('Usage: node video_upscaler.js <input-video> <output-video>');
    console.log('Example: node video_upscaler.js ./downloaded_video.mp4 ./upscaled_video.mp4');
    process.exit(1);
  }

  upscaler.upscaleVideo(inputPath, outputPath)
    .then(result => {
      console.log(`✅ Upscaling completed: ${result}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Upscaling failed:', error);
      process.exit(1);
    });
}

module.exports = VideoUpscaler;