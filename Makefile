.DEFAULT_GOAL := help

help:
	@echo "Usage: make [target]"
	@echo ""
	@echo "Setup"
	@echo "  prepare              - npm install"
	@echo ""
	@echo "Development"
	@echo "  build                - tsup → dist/"
	@echo "  dev                  - tsup --watch"
	@echo ""
	@echo "Quality"
	@echo "  test                 - vitest run"
	@echo "  typecheck            - tsc --noEmit"
	@echo "  lint                 - biome check ."
	@echo "  format               - biome check --write . (auto-fix)"
	@echo "  check                - typecheck + lint + test (run before declaring done)"
	@echo ""
	@echo "Versioning"
	@echo "  version              - Print current version from package.json"
	@echo "  version-bump-patch   - 0.1.0 → 0.1.1"
	@echo "  version-bump-minor   - 0.1.0 → 0.2.0"
	@echo "  version-bump-major   - 0.1.0 → 1.0.0"
	@echo ""
	@echo "Release"
	@echo "  verify               - Run pre-flight gates (clean tree, on main, no existing tag)"
	@echo "  release              - verify + check + build + tag + push (CI publishes to npm)"
	@echo "  release-dry          - Dry run: verify + check + build + npm publish --dry-run"
	@echo "  release-npm          - Publish to npm directly (no tag, idempotent escape hatch)"
	@echo "  smoke                - Verify published version matches package.json on npm registry"
	@echo "  seed-db              - Generate 5-year seed DB (OHLCV only) → data/seed.db.gz"
	@echo ""
	@echo "Housekeeping"
	@echo "  clean                - Remove node_modules and dist/"
	@echo "  help                 - Print this help"

# ---------- setup ----------

prepare:
	npm install

# ---------- development ----------

build:
	npm run build

dev:
	npm run dev

# Generate the 5-year seed database bundled with the npm package (OHLCV only, no indicators).
# Indicators are computed by the user after install via: nse-market-data compute-indicators
# Run this once before `make release` when you want to ship fresh historical data.
# Requires: built dist/ (run `make build` first), network access to Yahoo Finance/NSE.
# Takes ~2-4 hours for all active symbols. Output: data/seed.db.gz
seed-db: build
	@echo "Generating 5-year seed DB for all active NSE symbols (OHLCV only)..."
	@rm -f ./data/seed.db ./data/seed.db-wal ./data/seed.db-shm ./data/seed.db.gz
	@SEED_START=$$(node -e "const d=new Date();d.setFullYear(d.getFullYear()-5);console.log(d.toISOString().slice(0,10))") && \
	 NSE_MARKET_DATA_DB=./data/seed.db node dist/cli.js refresh-instruments && \
	 NSE_MARKET_DATA_DB=./data/seed.db node dist/cli.js refresh-scans && \
	 NSE_MARKET_DATA_DB=./data/seed.db node dist/cli.js backfill --all --from $$SEED_START --concurrency 5 --mark-failed-inactive && \
	 echo "Compressing..." && \
	 gzip -k -f ./data/seed.db && \
	 echo "Done: $$(du -h data/seed.db.gz | cut -f1)"
	@node -e "\
	  const fs = require('node:fs');\
	  const pkg = require('./node_modules/node-sqlite3-wasm');\
	  const { Database } = pkg;\
	  const db = new Database('data/seed.db', { readOnly: true });\
	  const s1 = db.prepare('SELECT COUNT(*) as n FROM ohlcv_daily');\
	  const rows = s1.get().n;\
	  s1.finalize();\
	  const s2 = db.prepare('SELECT COUNT(*) as n FROM sync_meta');\
	  const symbols = s2.get().n;\
	  s2.finalize();\
	  db.close();\
	  fs.writeFileSync('data/seed-manifest.json', JSON.stringify({ generatedAt: new Date().toISOString(), symbols, rows }, null, 2) + '\n');\
	  console.log('Wrote data/seed-manifest.json: ' + symbols + ' symbols, ' + rows + ' rows');\
	"
	@rm -f ./data/seed.db ./data/seed.db-wal ./data/seed.db-shm

# ---------- quality ----------

test:
	npm run test

typecheck:
	npm run typecheck

lint:
	npm run lint

format:
	npm run lint:fix

# Typecheck + lint + test — mirrors CI. Run before every commit.
check:
	npm run check

# ---------- versioning ----------

version:
	@node -p "require('./package.json').version"

version-bump-patch:
	@node -e "\
	  const fs = require('node:fs');\
	  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));\
	  const v = pkg.version.split('.');\
	  v[2] = String(Number(v[2]) + 1);\
	  pkg.version = v.join('.');\
	  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');\
	  console.log('Bumped to ' + pkg.version);\
	"

version-bump-minor:
	@node -e "\
	  const fs = require('node:fs');\
	  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));\
	  const v = pkg.version.split('.');\
	  v[1] = String(Number(v[1]) + 1); v[2] = '0';\
	  pkg.version = v.join('.');\
	  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');\
	  console.log('Bumped to ' + pkg.version);\
	"

version-bump-major:
	@node -e "\
	  const fs = require('node:fs');\
	  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));\
	  const v = pkg.version.split('.');\
	  v[0] = String(Number(v[0]) + 1); v[1] = '0'; v[2] = '0';\
	  pkg.version = v.join('.');\
	  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');\
	  console.log('Bumped to ' + pkg.version);\
	"

# ---------- release ----------

verify:
	@VERSION=$$(node -p "require('./package.json').version"); \
	ERRORS=0; \
	echo "=== Pre-flight gates for v$$VERSION ==="; \
	echo ""; \
	if [ "$$VERSION" = "0.0.0" ]; then \
	  echo "FAIL G1: version is 0.0.0 — run make version-bump-patch first"; ERRORS=1; \
	else echo "PASS G1: version is $$VERSION"; fi; \
	if git status --porcelain | grep -q .; then \
	  echo "FAIL G2: uncommitted changes — commit or stash before releasing"; ERRORS=1; \
	else echo "PASS G2: working tree clean"; fi; \
	if [ "$$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then \
	  echo "FAIL G3: not on main branch"; ERRORS=1; \
	else echo "PASS G3: on main"; fi; \
	if git tag | grep -q "^v$$VERSION$$"; then \
	  echo "FAIL G4: tag v$$VERSION already exists"; ERRORS=1; \
	else echo "PASS G4: tag v$$VERSION does not exist yet"; fi; \
	echo ""; \
	if [ "$$ERRORS" -ne 0 ]; then \
	  echo "Pre-flight failed — fix the issues above before releasing."; exit 1; \
	else echo "All gates passed — ready to release."; fi

release-dry:
	@VERSION=$$(node -p "require('./package.json').version"); \
	echo "=== Release dry run for v$$VERSION ==="; \
	echo ""; \
	$(MAKE) verify; \
	npm run check; \
	npm run build; \
	npm publish --dry-run; \
	echo ""; \
	echo "Dry run complete. No changes made. Run 'make release' to publish."

release:
	@VERSION=$$(node -p "require('./package.json').version"); \
	echo "=== Releasing v$$VERSION ==="; \
	echo ""; \
	$(MAKE) verify; \
	npm run check; \
	npm run build; \
	echo ""; \
	echo "Tagging and pushing..."; \
	git tag "v$$VERSION"; \
	git push -u origin HEAD && git push --tags; \
	echo ""; \
	if [ -f data/seed.db.gz ]; then \
	  echo "Uploading seed files to GitHub release v$$VERSION..."; \
	  gh release create "v$$VERSION" data/seed.db.gz data/seed-manifest.json \
	    --title "v$$VERSION" --generate-notes 2>/dev/null || \
	  gh release upload "v$$VERSION" data/seed.db.gz data/seed-manifest.json --clobber 2>/dev/null || \
	    echo "  (seed upload skipped — run manually: gh release upload v$$VERSION data/seed.db.gz data/seed-manifest.json)"; \
	fi; \
	echo "Tagged v$$VERSION and pushed — GitHub Actions will publish to npm"; \
	echo "Run 'make smoke' in ~3 minutes to verify."

release-npm:
	@VERSION=$$(node -p "require('./package.json').version"); \
	echo "Publishing @ethosagent/tools-nse-market-data@$$VERSION to npm..."; \
	npm publish --access public; \
	echo ""; \
	echo "Published v$$VERSION. Run: make smoke"

smoke:
	@VERSION=$$(node -p "require('./package.json').version"); \
	echo "Smoke test: checking npm registry for v$$VERSION..."; \
	PUBLISHED=$$(npm view @ethosagent/tools-nse-market-data version 2>/dev/null); \
	if [ "$$PUBLISHED" = "$$VERSION" ]; then \
	  echo "PASS: @ethosagent/tools-nse-market-data@$$VERSION is live on npm"; \
	else \
	  echo "FAIL: expected $$VERSION, got '$$PUBLISHED' from npm registry"; exit 1; \
	fi

# ---------- housekeeping ----------

clean:
	rm -rf node_modules dist

.PHONY: help prepare build dev seed-db test typecheck lint format check \
        version version-bump-patch version-bump-minor version-bump-major \
        verify release release-dry release-npm smoke clean
