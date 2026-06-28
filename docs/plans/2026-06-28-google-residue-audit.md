# Google Residue Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Audit the repository for Google-related residual logic and remove it only if it exists, then ship the previously prepared API error-handling improvement.

**Architecture:** Search all first-party source, config, workflow, and documentation files for Google Ads/Analytics references while excluding third-party dependencies. If no first-party matches exist, avoid no-op cleanup edits and only retain the meaningful `public/app.js` error-handling fix that explains missing `/api/*` backends.

**Tech Stack:** JavaScript, Cloudflare Pages Functions, GitHub Actions, ripgrep

---

### Task 1: Audit First-Party Files

**Files:**
- Inspect: `public/app.js`
- Inspect: `public/index.html`
- Inspect: `functions/api/[[path]].js`
- Inspect: `.github/workflows/deploy.yml`
- Inspect: `README.md`

**Step 1: Search the repository for first-party Google references**

Run: `rg -n "google|analytics|gtag|googletag|adsbygoogle|doubleclick|measurement_id|google-analytics|googlesyndication" public functions scripts .github README.md package.json wrangler.toml server.mjs`

Expected: no matches in first-party files

**Step 2: Verify search scope**

Confirm any hits are only under `node_modules/` or other generated content that is not committed as product logic.

**Step 3: Decide cleanup action**

If first-party matches exist, remove them with the smallest safe edit.
If no first-party matches exist, make no cleanup edit.

### Task 2: Preserve Useful Runtime Error Handling

**Files:**
- Modify: `public/app.js`

**Step 1: Keep the fetch response parsing guard**

Ensure `post()` reads response text first, parses JSON safely, and reports missing `/api/*` backends clearly.

**Step 2: Validate syntax**

Run: `node --check public/app.js`

Expected: exit code `0`

### Task 3: Commit and Push

**Files:**
- Commit: `public/app.js`
- Commit: `docs/plans/2026-06-28-google-residue-audit.md`

**Step 1: Review git diff**

Run: `git diff -- public/app.js docs/plans/2026-06-28-google-residue-audit.md`

**Step 2: Commit with a focused message**

Suggested commit:

```bash
git add public/app.js docs/plans/2026-06-28-google-residue-audit.md
git commit -m "fix: clarify missing api backend responses"
```

**Step 3: Push the current branch**

Run: `git push`

Expected: remote branch updates successfully

### Task 4: Hand Off Cloudflare Deployment Steps

**Files:**
- Reference: `.github/workflows/deploy.yml`
- Reference: `README.md`

**Step 1: Explain repository connection**

Describe how to create a Cloudflare Pages project connected to the GitHub repo.

**Step 2: Explain required settings**

Call out:
- Production branch: `main`
- Build command: empty
- Build output directory: `public`
- Required GitHub Actions secrets if using workflow deploy: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

**Step 3: Explain local upload fallback**

Provide the `npm run pack:upload` path when the user wants a manual Pages upload that includes `_worker.js`.
