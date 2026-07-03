#!/bin/bash

# WABAGENT - Startup Script
# Architecture: Engine (Express/tsx) + App web (Next.js) — monorepo npm workspaces

set -e

echo "[WABAGENT] Starting..."
echo "Architecture: Engine (Express) + App web (Next.js)"

# Colors for logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get current directory
CURRENT_DIR=$(pwd)

# Directory configuration
ENGINE_DIR="$CURRENT_DIR"
WEB_DIR="$CURRENT_DIR/apps/web"

# Ports
ENGINE_PORT=3800
WEB_PORT=3001

# Check if we're in the right directory
if [ ! -f "src/index.ts" ] || [ ! -d "apps/web" ] || [ ! -f "package.json" ]; then
    echo -e "${RED}[Error] Run this script from the cyran-labs-engine directory${NC}"
    exit 1
fi

# Function to check if a port is free
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${YELLOW}[Port] $port already in use${NC}"
        return 1
    else
        echo -e "${GREEN}[Port] $port available${NC}"
        return 0
    fi
}

# Check required tools
check_requirements() {
    echo -e "${BLUE}[Check] Verifying requirements...${NC}"

    if ! command -v node &> /dev/null; then
        echo -e "${RED}[Error] Node.js not found${NC}"
        exit 1
    fi
    echo -e "${GREEN}[OK] Node.js $(node --version)${NC}"

    if ! command -v npm &> /dev/null; then
        echo -e "${RED}[Error] npm not found${NC}"
        exit 1
    fi
    echo -e "${GREEN}[OK] npm $(npm --version)${NC}"
}

# Setup: install deps + ensure env files
setup() {
    check_requirements

    echo -e "${BLUE}[Setup] Installing workspace dependencies (root + apps/web + packages/*)...${NC}"
    npm install

    # Engine .env + required secrets
    if [ ! -f ".env" ]; then
        echo -e "${YELLOW}[Setup] Creating .env from .env.example...${NC}"
        cp .env.example .env
    fi
    # ADMIN_JWT_SECRET (required for login) — generate if missing/empty
    if ! grep -qE "^ADMIN_JWT_SECRET=.+" .env; then
        echo -e "${YELLOW}[Setup] Generating ADMIN_JWT_SECRET (required for login)...${NC}"
        sed -i '' '/^ADMIN_JWT_SECRET=$/d' .env 2>/dev/null || true
        printf "ADMIN_JWT_SECRET=%s\n" "$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")" >> .env
    fi
    # CREDENTIALS_ENCRYPTION_KEY (required to store credentials) — generate if missing/empty
    if ! grep -qE "^CREDENTIALS_ENCRYPTION_KEY=.+" .env; then
        echo -e "${YELLOW}[Setup] Generating CREDENTIALS_ENCRYPTION_KEY...${NC}"
        sed -i '' '/^CREDENTIALS_ENCRYPTION_KEY=$/d' .env 2>/dev/null || true
        printf "CREDENTIALS_ENCRYPTION_KEY=%s\n" "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env
    fi
    echo -e "${GREEN}[OK] Engine .env present (ADMIN_JWT_SECRET + CREDENTIALS_ENCRYPTION_KEY set)${NC}"

    # Web .env (BFF -> engine)
    if [ ! -f "apps/web/.env" ]; then
        echo -e "${YELLOW}[Setup] Creating apps/web/.env (ENGINE_API_URL -> localhost:$ENGINE_PORT)...${NC}"
        echo "# URL de base de l'API admin engine (local)" > apps/web/.env
        echo "ENGINE_API_URL=http://localhost:$ENGINE_PORT/api/admin/v1" >> apps/web/.env
    fi
    echo -e "${GREEN}[OK] apps/web/.env present${NC}"

    echo -e "${GREEN}[Done] Setup complete! Next: ./start_wabagent.sh seed-admin <email> <password> then ./start_wabagent.sh start${NC}"
}

# Seed a super_admin user (one-shot, idempotent). SQLite local unless DATABASE_URL set.
seed_admin() {
    local email="${1:-admin@wabagent.local}"
    local password="${2:-changeme1234}"
    echo -e "${BLUE}[Seed] Creating super_admin ($email)...${NC}"
    npx tsx scripts/seed-admin.ts "$email" "$password"
    echo -e "${GREEN}[OK] Admin ready — login: $email / $password${NC}"
}

# Start Engine (Express/tsx) in a Terminal tab
start_engine() {
    if ! check_port $ENGINE_PORT; then
        echo -e "${YELLOW}[Engine] Port $ENGINE_PORT busy — assuming already running (or run restart_wabagent_clean.sh)${NC}"
    fi
    echo -e "${BLUE}[Start] Starting Engine (Port $ENGINE_PORT)...${NC}"
    echo -e "${GREEN}[URL] Admin API: http://localhost:$ENGINE_PORT/api/admin/v1${NC}"

    osascript <<EOF
tell application "Terminal"
    activate
    if (count of windows) = 0 then
        do script "cd \"$ENGINE_DIR\" && echo '[WABAGENT Engine] Starting...' && npm run dev"
    else
        tell application "System Events" to keystroke "t" using command down
        delay 0.3
        do script "cd \"$ENGINE_DIR\" && echo '[WABAGENT Engine] Starting...' && npm run dev" in front window
    end if
end tell
EOF

    sleep 3
    echo -e "${GREEN}[OK] Engine started${NC}"
}

# Start App web (Next.js) in a Terminal tab
start_web() {
    if ! check_port $WEB_PORT; then
        echo -e "${YELLOW}[Web] Port $WEB_PORT busy — assuming already running (or run restart_wabagent_clean.sh)${NC}"
    fi
    echo -e "${BLUE}[Start] Starting App web (Port $WEB_PORT)...${NC}"
    echo -e "${GREEN}[URL] App: http://localhost:$WEB_PORT${NC}"

    osascript <<EOF
tell application "Terminal"
    activate
    tell application "System Events" to keystroke "t" using command down
    delay 0.3
    do script "cd \"$WEB_DIR\" && echo '[WABAGENT Web] Starting...' && npm run dev" in front window
end tell
EOF

    sleep 3
    echo -e "${GREEN}[OK] App web started${NC}"
}

# Health check
health_check() {
    echo -e "${BLUE}[Health] Checking services...${NC}"

    if curl -s "http://localhost:$ENGINE_PORT/health" > /dev/null 2>&1; then
        echo -e "${GREEN}[OK] Engine healthy (port $ENGINE_PORT)${NC}"
    else
        echo -e "${RED}[Error] Engine not responding on port $ENGINE_PORT${NC}"
    fi

    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$WEB_PORT/fr/login" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
        echo -e "${GREEN}[OK] App web healthy (port $WEB_PORT, /fr/login -> 200)${NC}"
    else
        echo -e "${RED}[Error] App web not responding on port $WEB_PORT (got $code)${NC}"
    fi
}

# Main
main() {
    case "$1" in
        "setup")
            setup
            ;;
        "start")
            start_engine
            start_web
            echo ""
            echo -e "${GREEN}==========================================${NC}"
            echo -e "${GREEN}[WABAGENT] All services started!${NC}"
            echo -e "${GREEN}==========================================${NC}"
            echo -e "${BLUE}Engine API: http://localhost:$ENGINE_PORT/api/admin/v1${NC}"
            echo -e "${BLUE}App web:    http://localhost:$WEB_PORT${NC}"
            echo -e "${YELLOW}Login at http://localhost:$WEB_PORT (needs a seeded admin: ./start_wabagent.sh seed-admin)${NC}"
            echo ""
            ;;
        "engine")
            start_engine
            ;;
        "web")
            start_web
            ;;
        "seed-admin")
            seed_admin "$2" "$3"
            ;;
        "health")
            health_check
            ;;
        *)
            echo -e "${BLUE}[WABAGENT] Startup Script${NC}"
            echo -e "${GREEN}Architecture: Engine (Express/tsx, port $ENGINE_PORT) + App web (Next.js, port $WEB_PORT)${NC}"
            echo ""
            echo "Usage: $0 {setup|start|engine|web|seed-admin|health}"
            echo ""
            echo "Commands:"
            echo "  setup                       - Install deps + ensure .env files"
            echo "  start                       - Start engine + web (Terminal tabs)"
            echo "  engine                      - Start only the engine (port $ENGINE_PORT)"
            echo "  web                         - Start only the app web (port $WEB_PORT)"
            echo "  seed-admin [email] [pwd]    - Create a super_admin (default admin@wabagent.local / changeme1234)"
            echo "  health                      - Check services health"
            echo ""
            echo -e "${YELLOW}Recommended first run:${NC}"
            echo "  ./start_wabagent.sh setup"
            echo "  ./start_wabagent.sh seed-admin"
            echo "  ./start_wabagent.sh start"
            echo ""
            echo -e "${YELLOW}To restart cleanly:${NC}"
            echo "  ./restart_wabagent_clean.sh"
            ;;
    esac
}

main "$@"
