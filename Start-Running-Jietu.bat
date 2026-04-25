@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [Error] npm not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [Info] node_modules not found, installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [Error] npm install failed.
    pause
    exit /b 1
  )
)

echo [Info] Starting Running Jietu v2.0...
call npm start

endlocal
