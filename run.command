#!/bin/bash
# Get the directory where this script is located
CDPATH="" cd -- "$(dirname -- "$0")" || exit 1

echo "=============================================="
echo "      AGRAJA IPTV PLAYER LAUNCHER (macOS)"
echo "=============================================="
echo ""
echo "Starting Vite development server..."
npm run dev &
SERVER_PID=$!

echo ""
echo "Waiting for server to spin up..."
sleep 2

echo ""
echo "Launching browser to IPTV interface..."
open http://localhost:5173

# Trap exit signal to kill the background node server process
cleanup() {
  echo ""
  echo "Stopping development server..."
  kill $SERVER_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Keep script running so the server stays alive until Terminal window is closed
wait $SERVER_PID
