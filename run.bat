@echo off
title Agraja IPTV Player Launcher
echo ==============================================
echo       AGRAJA IPTV PLAYER LAUNCHER
echo ==============================================
echo.
echo Starting Vite development server...
cd /d "%~dp0"
start /min cmd /c npm run dev
echo.
echo Waiting for server to spin up...
timeout /t 2 /nobreak >nul
echo.
echo Launching browser to IPTV interface...
start http://localhost:5173
echo.
echo App is running successfully.
echo.
timeout /t 3 >nul
exit
