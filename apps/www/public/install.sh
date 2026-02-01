#!/bin/bash
set -e # Exit on error

# OrcBot Production Installer
# ---------------------------
# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}🤖 Starting OrcBot Global Installation...${NC}"

# 1. Dependency Checks
echo -e "${YELLOW}🔍 Checking environment...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Error: Node.js is not installed. Please install Node.js 18 or higher.${NC}"
    exit 1
fi

NODE_VER=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VER" -lt 18 ]; then
    echo -e "${RED}❌ Error: OrcBot requires Node.js 18+. You have v$(node -v).${NC}"
    exit 1
fi

if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Error: Git is not installed. Please install Git to clone the repository.${NC}"
    exit 1
fi

# 2. Setup Directory
BASE_DIR="$HOME/.orcbot-source"
echo -e "${YELLOW}📂 Setting up source directory at $BASE_DIR...${NC}"
rm -rf "$BASE_DIR" # Clean start for production readiness
git clone https://github.com/fredabila/orcbot.git "$BASE_DIR"
cd "$BASE_DIR"

# 3. Installation
echo -e "${YELLOW}📦 Installing dependencies (this may take a minute)...${NC}"
npm install

echo -e "${YELLOW}🔨 Building the platform...${NC}"
npm run build

echo -e "${YELLOW}🔗 Linking globally...${NC}"
# Use sudo if permission is denied, or assume user handles their npm prefix
if command -v sudo &> /dev/null; then
    sudo npm link
else
    npm link
fi

# 4. Critical Tooling
echo -e "${YELLOW}🌐 Installing autonomous browser engines...${NC}"
npx playwright install chromium

# 5. Configuration
echo -e "${YELLOW}⚙️  Launching Setup Wizard...${NC}"
orcbot setup

echo -e "${GREEN}✅ OrcBot is now installed globally!${NC}"
echo -e "You can run ${CYAN}'orcbot run'${NC} from any terminal directory."
echo -e "Try it now: ${CYAN}orcbot --help${NC}"
