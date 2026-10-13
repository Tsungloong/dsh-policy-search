@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Please run npm ci once, then start this demo again.
  pause
  exit /b 1
)
node src\cli.js --demo
pause
