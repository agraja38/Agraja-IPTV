@echo off
title Agraja IPTV Player Launcher
echo ==============================================
echo       AGRAJA IPTV PLAYER LAUNCHER
echo ==============================================
echo.

cd /d "%~dp0"

:: Add Node.js to PATH if not already present
where node >nul 2>nul
if errorlevel 1 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=C:\Program Files\nodejs;%PATH%"
    ) else if exist "C:\Program Files (x86)\nodejs\node.exe" (
        set "PATH=C:\Program Files (x86)\nodejs;%PATH%"
    )
)

:: Check if node_modules exists, if not run npm install
if not exist "node_modules\" (
    echo node_modules folder not found. Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo ERROR: 'npm install' failed. Please make sure Node.js is installed.
        pause
        exit
    )
)

:: Terminate any zombie process currently occupying port 5173
for /f "tokens=5" %%a in ('netstat -ano ^| findstr LISTENING ^| findstr :5173') do (
    taskkill /f /pid %%a >nul 2>nul
)

echo Starting Vite development server on 127.0.0.1:5173...
if exist "node_modules\vite\bin\vite.js" (
    start "Agraja IPTV Server" /min cmd /k "node node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173 --strictPort"
) else (
    start "Agraja IPTV Server" /min cmd /k "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
)

echo.
echo Waiting for server to spin up...

:: Poll port 5173 for up to 15 seconds
set "ready="
for /l %%i in (1,1,15) do (
    netstat -ano | findstr LISTENING | findstr :5173 >nul
    if not errorlevel 1 (
        set ready=1
        goto :launch
    )
    ping 127.0.0.1 -n 2 >nul
)

:launch
echo.
if defined ready (
    echo Server is ready!
) else (
    echo Warning: Server did not respond on port 5173 within 15 seconds.
)
echo.
echo Launching browser to IPTV interface...
start http://127.0.0.1:5173
echo.
echo App is running successfully.
echo.
ping 127.0.0.1 -n 4 >nul
exit



