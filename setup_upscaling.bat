@echo off
echo 🚀 Setting up 4K Video Upscaling for NotebookLM Automation...
echo.

echo Step 1: Installing required dependencies...
npm install fluent-ffmpeg chokidar

echo.
echo Step 2: Creating necessary directories...
if not exist "upscaled_videos" mkdir upscaled_videos
if not exist "downloaded_videos" mkdir downloaded_videos

echo.
echo Step 3: Checking system requirements...
echo.

echo Checking FFmpeg installation...
ffmpeg -version >nul 2>&1
if %errorlevel% == 0 (
    echo ✅ FFmpeg is installed and ready
) else (
    echo ❌ FFmpeg not found. Please install FFmpeg:
    echo    Download from: https://ffmpeg.org/download.html
    echo    Add to PATH environment variable
    echo.
)

echo Checking NVIDIA GPU support...
nvidia-smi >nul 2>&1
if %errorlevel% == 0 (
    echo ✅ NVIDIA GPU detected - GPU acceleration available
) else (
    echo ⚠️  No NVIDIA GPU detected - will use CPU processing
    echo.
)

echo Step 4: Testing video upscaler...
node -e "const VideoUpscaler = require('./video_upscaler'); const upscaler = new VideoUpscaler(); upscaler.checkSystemRequirements().then(() => console.log('✅ System check completed'));"

echo.
echo 📋 Setup Complete!
echo.
echo Available commands:
echo   node video_upscaler.js <input> <output>     - Upscale a single video
echo   node integration_example.js test              - Test the workflow
echo   node integration_example.js setup             - Show detailed setup guide
echo   node integration_example.js integration       - Get bot.js integration code
echo.
echo 🎬 Next Steps:
echo   1. Install FFmpeg if not already installed
echo   2. Consider installing Topaz Video AI for best quality (optional)
echo   3. Test with: node integration_example.js test
echo   4. Integrate into your bot.js using the provided code
echo.
pause