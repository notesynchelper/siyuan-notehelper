# Weekly Auto-Release GitHub Action Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a GitHub Actions workflow that auto-bumps patch version, builds, and publishes a release every Monday at UTC 12:00.

**Architecture:** Single workflow file triggered by cron + manual dispatch. Uses node script inline to bump version in `package.json` and `plugin.json`, runs `npm run build`, then commits version bump, creates tag, and publishes GitHub Release with `package.zip`.

**Tech Stack:** GitHub Actions, Node 20, npm, gh CLI (pre-installed on runners)

---

### Task 1: Create the workflow file

**Files:**
- Create: `.github/workflows/weekly-release.yml`

**Step 1: Create directories**

```bash
mkdir -p .github/workflows
```

**Step 2: Write the workflow file**

Create `.github/workflows/weekly-release.yml` with the following content:

```yaml
name: Weekly Release

on:
  schedule:
    # Every Monday at UTC 12:00
    - cron: '0 12 * * 1'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Bump patch version
        id: bump
        run: |
          # Read current version from package.json
          CURRENT=$(node -p "require('./package.json').version")
          echo "Current version: $CURRENT"

          # Increment patch: 1.7.2 -> 1.7.3
          IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
          NEW_PATCH=$((PATCH + 1))
          NEW_VERSION="${MAJOR}.${MINOR}.${NEW_PATCH}"
          echo "New version: $NEW_VERSION"

          # Update package.json
          node -e "
            const fs = require('fs');
            const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            pkg.version = '${NEW_VERSION}';
            fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
          "

          # Update plugin.json
          node -e "
            const fs = require('fs');
            const plugin = JSON.parse(fs.readFileSync('plugin.json', 'utf8'));
            plugin.version = '${NEW_VERSION}';
            fs.writeFileSync('plugin.json', JSON.stringify(plugin, null, 2) + '\n');
          "

          echo "version=${NEW_VERSION}" >> "$GITHUB_OUTPUT"

      - name: Install dependencies
        run: npm install

      - name: Build
        run: npm run build

      - name: Generate changelog
        id: changelog
        run: |
          # Get the latest tag
          LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
          echo "Latest tag: $LATEST_TAG"

          if [ -n "$LATEST_TAG" ]; then
            LOG=$(git log "${LATEST_TAG}..HEAD" --oneline --no-merges)
          else
            LOG=$(git log --oneline -20 --no-merges)
          fi

          if [ -z "$LOG" ]; then
            LOG="Scheduled release (no new commits)"
          fi

          # Write to file to preserve newlines
          echo "$LOG" > /tmp/changelog.txt
          echo "Changelog:"
          cat /tmp/changelog.txt

      - name: Commit version bump and create tag
        run: |
          VERSION="${{ steps.bump.outputs.version }}"
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add package.json plugin.json
          git commit -m "chore: bump version to v${VERSION}"
          git tag "v${VERSION}"
          git push origin main --tags

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          VERSION="${{ steps.bump.outputs.version }}"
          CHANGELOG=$(cat /tmp/changelog.txt)

          BODY="## v${VERSION} Release

          ### Changes
          ${CHANGELOG}

          ---
          *Automated weekly release*"

          gh release create "v${VERSION}" \
            --title "v${VERSION}" \
            --notes "$BODY" \
            package.zip
```

**Step 3: Verify YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/weekly-release.yml'))"`
Expected: No errors

**Step 4: Commit**

```bash
git add .github/workflows/weekly-release.yml
git commit -m "ci: add weekly auto-release GitHub Action"
```

### Task 2: Verify build produces package.zip at expected path

**Step 1: Confirm webpack output path**

The workflow expects `package.zip` at the repo root. Check `webpack.config.js`:
- ZipPlugin outputs to `path.resolve(__dirname)` (repo root) with filename `package.zip`
- Confirmed: `package.zip` will be at repo root after `npm run build`

No changes needed. This is a verification-only task.

### Task 3: Push and verify

**Step 1: Push to main**

```bash
git push origin main
```

**Step 2: Manually trigger workflow to verify**

```bash
gh workflow run weekly-release.yml
```

**Step 3: Watch the run**

```bash
gh run list --workflow=weekly-release.yml --limit 1
gh run watch
```

Expected: Workflow succeeds, creates a new release with `package.zip`.
