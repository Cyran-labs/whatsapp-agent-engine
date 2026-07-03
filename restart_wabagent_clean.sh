#!/bin/bash

# WABAGENT - Kill and restart cleanly
echo "[WABAGENT] Cleaning up processes..."
echo "==========================================="

# Kill processes on WABAGENT ports (engine 3800, web 3001, e2e 3002/4999)
echo "Stopping processes on ports 3800, 3001, 3002, 4999..."
lsof -ti:3800 | xargs kill -9 2>/dev/null || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:3002 | xargs kill -9 2>/dev/null || true
lsof -ti:4999 | xargs kill -9 2>/dev/null || true

# Kill any WABAGENT-related node processes
echo "Stopping tsx (engine) and next (web) processes..."
pkill -f "tsx watch src/index.ts" 2>/dev/null || true
pkill -f "tsx src/index.ts" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true

# Close all Terminal windows (tabs are in the same window, closing it kills all)
osascript <<EOF 2>/dev/null || true
tell application "Terminal"
    close every window
end tell
EOF

# Wait a moment
sleep 2

echo "[WABAGENT] Ports and terminals cleaned!"
echo ""

# Now start the full stack
./start_wabagent.sh start
