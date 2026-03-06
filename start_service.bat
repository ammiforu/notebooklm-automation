@echo off
REM Start the Telugu News Bot loop and Blog server
REM This script is called by Windows Task Scheduler on startup

cd /d "%~dp0"

REM Start blog server in background
start "TeluguNewsBlog" /min cmd /c "node server.js"

REM Start bot loop (runs every 5 hours)
start "TeluguNewsBot" /min cmd /c "node bot.js --loop"
