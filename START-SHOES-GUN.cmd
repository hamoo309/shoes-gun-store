@echo off
setlocal
title SHOES GUN - Local Store
pushd "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22 or later, then try again.
  pause
  popd
  exit /b 1
)
node.exe "scripts\local-run.mjs" %*
set "SG_EXIT=%errorlevel%"
popd
if not "%SG_EXIT%"=="0" pause
exit /b %SG_EXIT%
