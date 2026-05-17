#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# harris - Publish to npm + Push to GitHub
# ============================================================
# This script:
#   1. Verifies prerequisites (node, pnpm, gh CLI, npm login)
#   2. Checks npm package name availability
#   3. Configures package.json for single-package publish
#   4. Builds the project
#   5. Runs tests
#   6. Creates a GitHub repo and pushes
#   7. Publishes to npm
#
# Usage:
#   chmod +x publish.sh
#   ./publish.sh
#
# Flags:
#   --skip-tests     Skip test suite
#   --skip-npm       Skip npm publish (GitHub only)
#   --skip-github    Skip GitHub push (npm only)
#   --dry-run        Show what would happen without doing it
# ============================================================

# --- Config ---
PACKAGE_NAME="harris-swarm"
GITHUB_USER="sotiamaestro"
GITHUB_REPO="harris"
DESCRIPTION="Autonomous agent-to-agent swarm framework. Agents do not need humans - they need each other."
TOPICS="ai,agents,multi-agent,swarm,gemini,typescript,autonomous,llm,framework"

# --- Parse flags ---
SKIP_TESTS=false
SKIP_NPM=false
SKIP_GITHUB=false
DRY_RUN=false

for arg in "$@"; do
  case $arg in
    --skip-tests)  SKIP_TESTS=true ;;
    --skip-npm)    SKIP_NPM=true ;;
    --skip-github) SKIP_GITHUB=true ;;
    --dry-run)     DRY_RUN=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${BLUE}[harris]${NC} $1"; }
ok()    { echo -e "${GREEN}  ✓${NC} $1"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $1"; }
fail()  { echo -e "${RED}  ✗${NC} $1"; exit 1; }
step()  { echo -e "\n${CYAN}${BOLD}── $1 ──${NC}"; }

# ============================================================
# STEP 0: Prerequisites
# ============================================================
step "Checking prerequisites"

command -v node  >/dev/null 2>&1 || fail "node is not installed. Install Node.js 20+."
command -v pnpm  >/dev/null 2>&1 || fail "pnpm is not installed. Run: npm install -g pnpm"
command -v git   >/dev/null 2>&1 || fail "git is not installed."

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  fail "Node.js 20+ required. Current: $(node -v)"
fi
ok "Node.js $(node -v)"
ok "pnpm $(pnpm -v)"
ok "git $(git --version | cut -d' ' -f3)"

if [ "$SKIP_GITHUB" = false ]; then
  command -v gh >/dev/null 2>&1 || fail "GitHub CLI (gh) not installed. Run: brew install gh"
  gh auth status >/dev/null 2>&1 || fail "Not logged into GitHub CLI. Run: gh auth login"
  ok "GitHub CLI authenticated"
fi

if [ "$SKIP_NPM" = false ]; then
  npm whoami >/dev/null 2>&1 || fail "Not logged into npm. Run: npm login"
  NPM_USER=$(npm whoami)
  ok "npm authenticated as ${NPM_USER}"
fi

# ============================================================
# STEP 1: Check npm name availability
# ============================================================
if [ "$SKIP_NPM" = false ]; then
  step "Checking npm package name"

  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://registry.npmjs.org/${PACKAGE_NAME}")

  if [ "$HTTP_STATUS" = "404" ]; then
    ok "'${PACKAGE_NAME}' is available on npm"
  elif [ "$HTTP_STATUS" = "200" ]; then
    warn "'${PACKAGE_NAME}' already exists on npm"
    echo ""
    read -rp "  Package exists. Publish a new version? (y/n): " CONFIRM
    if [ "$CONFIRM" != "y" ]; then
      fail "Aborted. Choose a different package name by editing PACKAGE_NAME in this script."
    fi
  else
    warn "Could not check npm registry (HTTP ${HTTP_STATUS}). Proceeding anyway."
  fi
fi

# ============================================================
# STEP 2: Configure package.json for single-package publish
# ============================================================
step "Configuring package.json"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  fail "No package.json found. Run this script from the harris project root."
fi

# Create or update the root package.json with publish config
if [ "$DRY_RUN" = false ]; then

  # Back up original
  cp package.json package.json.bak

  # Use node to modify package.json cleanly
  node -e "
    const pkg = require('./package.json');

    pkg.name = '${PACKAGE_NAME}';
    pkg.version = pkg.version || '0.1.0';
    pkg.description = '${DESCRIPTION}';
    pkg.main = './packages/orchestrator/dist/index.js';
    pkg.types = './packages/orchestrator/dist/index.d.ts';
    pkg.exports = {
      '.': {
        import: './packages/orchestrator/dist/index.js',
        types: './packages/orchestrator/dist/index.d.ts'
      },
      './core': {
        import: './packages/core/dist/index.js',
        types: './packages/core/dist/index.d.ts'
      },
      './gemini': {
        import: './packages/gemini/dist/index.js',
        types: './packages/gemini/dist/index.d.ts'
      },
      './codebase': {
        import: './packages/codebase/dist/index.js',
        types: './packages/codebase/dist/index.d.ts'
      }
    };
    pkg.keywords = '${TOPICS}'.split(',');
    pkg.author = 'Harris Robinson';
    pkg.license = 'MIT';
    pkg.repository = {
      type: 'git',
      url: 'git+https://github.com/${GITHUB_USER}/${GITHUB_REPO}.git'
    };
    pkg.bugs = {
      url: 'https://github.com/${GITHUB_USER}/${GITHUB_REPO}/issues'
    };
    pkg.homepage = 'https://github.com/${GITHUB_USER}/${GITHUB_REPO}#readme';
    pkg.engines = { node: '>=20.0.0' };
    pkg.files = [
      'packages/*/dist/**',
      'README.md',
      'LICENSE'
    ];

    require('fs').writeFileSync(
      './package.json',
      JSON.stringify(pkg, null, 2) + '\\n'
    );
    console.log('  ✓ package.json configured');
  "

  # Create LICENSE if it doesn't exist
  if [ ! -f "LICENSE" ]; then
    cat > LICENSE << 'LICEOF'
MIT License

Copyright (c) 2026 Harris Robinson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
LICEOF
    ok "LICENSE created"
  else
    ok "LICENSE exists"
  fi

  # Create .npmignore
  cat > .npmignore << 'NPMEOF'
# Source files (dist is published)
packages/*/src
packages/*/tests
packages/*/tsconfig.json

# Dev tooling
tests/
examples/
docs/
.github/
biome.json
tsconfig.base.json
pnpm-workspace.yaml
pnpm-lock.yaml
package.json.bak

# Misc
.git
.gitignore
.env
*.log
node_modules
NPMEOF
  ok ".npmignore created"

  # Create .gitignore if it doesn't exist
  if [ ! -f ".gitignore" ]; then
    cat > .gitignore << 'GITEOF'
node_modules/
dist/
packages/*/dist/
*.log
.env
.env.*
.DS_Store
package.json.bak
coverage/
GITEOF
    ok ".gitignore created"
  fi

else
  ok "[DRY RUN] Would configure package.json with name '${PACKAGE_NAME}'"
fi

# ============================================================
# STEP 3: Build
# ============================================================
step "Building all packages"

if [ "$DRY_RUN" = false ]; then
  log "Building core..."
  npx tsup packages/core/src/index.ts --format esm --dts --clean --outDir packages/core/dist --silent
  ok "@harris/core built"

  log "Building codebase..."
  npx tsup packages/codebase/src/index.ts --format esm --dts --clean --outDir packages/codebase/dist --silent
  ok "@harris/codebase built"

  log "Building gemini..."
  npx tsup packages/gemini/src/index.ts --format esm --dts --clean --outDir packages/gemini/dist --silent
  ok "@harris/gemini built"

  log "Building orchestrator..."
  npx tsup packages/orchestrator/src/index.ts --format esm --dts --clean --outDir packages/orchestrator/dist --silent
  ok "@harris/orchestrator built"
else
  ok "[DRY RUN] Would build all four packages"
fi

# ============================================================
# STEP 4: Test
# ============================================================
if [ "$SKIP_TESTS" = false ]; then
  step "Running tests"

  if [ "$DRY_RUN" = false ]; then
    pnpm test
    ok "All tests passed"
  else
    ok "[DRY RUN] Would run pnpm test"
  fi
else
  warn "Tests skipped (--skip-tests)"
fi

# ============================================================
# STEP 5: Lint
# ============================================================
step "Running lint check"

if [ "$DRY_RUN" = false ]; then
  pnpm lint 2>/dev/null && ok "Lint passed" || warn "Lint had warnings (non-blocking)"
else
  ok "[DRY RUN] Would run pnpm lint"
fi

# ============================================================
# STEP 6: Copy README
# ============================================================
step "Ensuring README is in place"

if [ -f "README.md" ]; then
  ok "README.md exists"
else
  warn "No README.md found. Add one before publishing."
fi

# ============================================================
# STEP 7: GitHub
# ============================================================
if [ "$SKIP_GITHUB" = false ]; then
  step "Pushing to GitHub"

  if [ "$DRY_RUN" = false ]; then

    # Initialize git if needed
    if [ ! -d ".git" ]; then
      git init
      ok "Git initialized"
    fi

    # Check if remote exists
    if git remote get-url origin >/dev/null 2>&1; then
      CURRENT_REMOTE=$(git remote get-url origin)
      ok "Remote exists: ${CURRENT_REMOTE}"
    else
      # Create GitHub repo
      log "Creating GitHub repository..."
      gh repo create "${GITHUB_USER}/${GITHUB_REPO}" \
        --public \
        --description "${DESCRIPTION}" \
        --source . \
        --remote origin \
        2>/dev/null || {
          # Repo might already exist
          warn "Repo may already exist. Adding remote..."
          git remote add origin "https://github.com/${GITHUB_USER}/${GITHUB_REPO}.git" 2>/dev/null || true
        }
      ok "GitHub repo configured"
    fi

    # Set topics
    gh repo edit "${GITHUB_USER}/${GITHUB_REPO}" \
      --description "${DESCRIPTION}" \
      --add-topic ai \
      --add-topic agents \
      --add-topic multi-agent \
      --add-topic swarm \
      --add-topic gemini \
      --add-topic typescript \
      --add-topic autonomous \
      --add-topic llm \
      2>/dev/null || warn "Could not set all topics (non-blocking)"

    # Stage and commit
    git add -A
    git commit -m "feat: autonomous agent-to-agent swarm framework

- 7 specialist agents (Architect, Analyst, Builder, Reviewer, Tester, Debugger, Release)
- Peer-to-peer agent communication with structured JSON protocol
- Token budget management with zone-based behavior adaptation
- Loop detection, circuit breaking, and convergence enforcement
- First principles conflict resolution with Architect arbitration
- Optimistic concurrency for parallel file modifications
- Live Gemini 2.5 Pro/Flash integration
- Full test suite with failure scenario coverage" 2>/dev/null || warn "Nothing to commit (already up to date)"

    # Determine branch
    BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
    if [ -z "$BRANCH" ]; then
      git checkout -b main
      BRANCH="main"
    fi

    # Push
    git push -u origin "${BRANCH}" 2>/dev/null || git push origin "${BRANCH}"
    ok "Pushed to github.com/${GITHUB_USER}/${GITHUB_REPO}"

  else
    ok "[DRY RUN] Would create repo github.com/${GITHUB_USER}/${GITHUB_REPO} and push"
  fi
else
  warn "GitHub push skipped (--skip-github)"
fi

# ============================================================
# STEP 8: npm publish
# ============================================================
if [ "$SKIP_NPM" = false ]; then
  step "Publishing to npm"

  if [ "$DRY_RUN" = false ]; then

    echo ""
    log "About to publish '${PACKAGE_NAME}' to npm"
    log "Version: $(node -e "console.log(require('./package.json').version)")"
    echo ""
    read -rp "  Confirm publish? (y/n): " CONFIRM_PUBLISH

    if [ "$CONFIRM_PUBLISH" = "y" ]; then
      npm publish --access public
      ok "Published ${PACKAGE_NAME} to npm"
      echo ""
      log "Install with: ${BOLD}npm install ${PACKAGE_NAME}${NC}"
    else
      warn "npm publish skipped by user"
    fi

  else
    ok "[DRY RUN] Would publish '${PACKAGE_NAME}' to npm"
  fi
else
  warn "npm publish skipped (--skip-npm)"
fi

# ============================================================
# Done
# ============================================================
echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  harris - deployment complete${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════${NC}"
echo ""

if [ "$SKIP_GITHUB" = false ]; then
  echo -e "  ${CYAN}GitHub:${NC}  https://github.com/${GITHUB_USER}/${GITHUB_REPO}"
fi
if [ "$SKIP_NPM" = false ]; then
  echo -e "  ${CYAN}npm:${NC}     https://www.npmjs.com/package/${PACKAGE_NAME}"
  echo -e "  ${CYAN}Install:${NC} npm install ${PACKAGE_NAME}"
fi

echo ""
echo -e "  ${BOLD}Sic Parvis Magna${NC}"
echo ""
