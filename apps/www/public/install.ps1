# OrcBot Production Installer (Windows)
# -----------------------------------
$ErrorActionPreference = "Stop"

Write-Host "🤖 Starting OrcBot Global Installation..." -ForegroundColor Cyan

# 1. Dependency Checks
Write-Host "🔍 Checking environment..." -ForegroundColor Yellow

if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: Node.js is not installed. Please install Node.js 18 or higher." -ForegroundColor Red
    exit
}

$nodeVer = (node -v).TrimStart('v').Split('.')[0]
if ([int]$nodeVer -lt 18) {
    Write-Host "❌ Error: OrcBot requires Node.js 18+. You have $(node -v)." -ForegroundColor Red
    exit
}

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: Git is not installed. Please install Git to clone the repository." -ForegroundColor Red
    exit
}

# 2. Setup Directory
$baseDir = "$HOME\.orcbot-source"
Write-Host "📂 Setting up source directory at $baseDir..." -ForegroundColor Yellow
if (Test-Path $baseDir) { Remove-Item -Path $baseDir -Recurse -Force }
git clone https://github.com/fredabila/orcbot.git $baseDir
Set-Location $baseDir

# 3. Installation
Write-Host "📦 Installing dependencies (this may take a minute)..." -ForegroundColor Yellow
npm install

Write-Host "🔨 Building the platform..." -ForegroundColor Yellow
npm run build

Write-Host "🔗 Linking globally..." -ForegroundColor Yellow
# On Windows, npm link usually requires an administrative terminal if prefix is in Program Files
# but many users use NVM or user-scope prefixes.
npm link

# 4. Critical Tooling
Write-Host "🌐 Installing autonomous browser engines..." -ForegroundColor Yellow
npx playwright install chromium

# 5. Configuration
Write-Host "⚙️  Launching Setup Wizard..." -ForegroundColor Cyan
orcbot setup

Write-Host "✅ OrcBot is now installed globally!" -ForegroundColor Green
Write-Host "You can run 'orcbot run' from any terminal directory." -ForegroundColor White
Write-Host "Try it now: orcbot --help" -ForegroundColor Cyan
