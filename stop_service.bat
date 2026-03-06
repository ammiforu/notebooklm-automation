@echo off
REM Stop the Telugu News Bot and Blog server
taskkill /fi "WINDOWTITLE eq TeluguNewsBot" /f 2>nul
taskkill /fi "WINDOWTITLE eq TeluguNewsBlog" /f 2>nul
echo Services stopped.
