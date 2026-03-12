# Weekly Auto-Release GitHub Action Design

## Summary

Create a single GitHub Actions workflow that runs every Monday at UTC 12:00, automatically bumps the patch version, builds the project, and publishes a GitHub Release with `package.zip`.

## Requirements

- Trigger: cron `0 12 * * 1` (Monday UTC 12:00) + `workflow_dispatch` for manual
- Always release, even if no new commits since last release
- Version: patch increment (1.7.2 -> 1.7.3 -> 1.7.4)
- Update version in both `package.json` and `plugin.json`
- Build: `npm install && npm run build` -> produces `package.zip`
- Create git tag + GitHub Release with `package.zip` attached
- Auto-generate changelog from commits since last tag

## Workflow Design

**File:** `.github/workflows/weekly-release.yml`

**Steps:**

1. `actions/checkout@v4` with full history (`fetch-depth: 0`) for changelog generation
2. `actions/setup-node@v4` with Node 20
3. Shell script to:
   - Read current version from `package.json`
   - Increment patch number
   - Write new version back to `package.json` and `plugin.json` (using `jq` or `node -e`)
4. `npm install`
5. `npm run build`
6. Generate changelog: `git log <last-tag>..HEAD --oneline`
7. Configure git user, commit version bump, push to main
8. Create tag and GitHub Release via `gh release create`, upload `package.zip`

**Permissions:** `contents: write` for push + release creation

**Git identity:** `github-actions[bot]`
