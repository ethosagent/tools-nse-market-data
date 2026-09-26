# nse-index-history

Status: **Approved with amendments (§8)** | Date: 2026-09-26 | Target release: 0.1.37 | Scope: index
OHLCV comes from NSE's daily all-indices file instead of Yahoo; add indices by NSE name; attach
constituents; every symbol carries a stored price source (§8).

> §8 records the owner's amendments. Where §8 and §3–§6 disagree, §8 wins: A1 supersedes D4, D11
> and D13; A6 replaces the single-line-per-symbol tool output.

## 1. Problem (verified 2026-09-26)

Index prices come only from Yahoo (`fetchOhlcv`, `src/fetcher.ts:124-129`, v8 chart with
`period1/period2`). Yahoo has daily history for a handful of Nifty indices only. Live DB
`~/.ethos/market-data/market.db`:

| State | Symbols |
|---|---|
| ~245 bars (healthy) | `^NSEI` `^NSMIDCP` `^NSEBANK` `^CNXIT` `^CNXPHARMA` `^CNX100` `^CNX200` `^CRSLDX` `^NSEMDCP50` `^INDIAVIX` |
| 1 bar | `^CNXAUTO` `^CNXENERGY` `^CNXFMCG` `^CNXMETAL` `^CNXPSUBANK` `^CNXREALTY` `^CNXSC` |
| 0 bars | `^CNXMC150` `^CNXSC250` `^CNXMC250` (the last errors on Yahoo) |

Three further facts found while reading the code:

- The 1-bar indices have `sync_meta.last_date = 2026-09-25`, so `updateSymbol` believes they are
  current and will never repair them. A repair must be an explicit backfill, not an update.
- `store.ts:1244,1258,1759,1980,2350` read `^NSMIDCP100` as the mid-cap segment index, but no
  such instrument is registered — mid-cap RS is always `null` today. `^CNXSC` (small segment) has
  one bar, so small-cap RS is effectively `null` too.
- `index_constituents` is **empty** in the live DB (0 rows), so `computeSectorState`
  (`store.ts:3141-3147`) finds no members for any sector index: sector breadth is blank.

Stored Yahoo bars match NSE's values exactly (float32 noise aside) but carry `volume = 0`;
e.g. `^NSEI` 2026-09-25 is `23035.0|23162.69921875|23020.94921875|23140.5|0` in the DB versus
`23035,23162.7,23020.95,23140.5,…,242720711` in NSE's file.

## 2. Probe evidence

**NSE daily all-indices file — works.**
`GET https://nsearchives.nseindia.com/content/indices/ind_close_all_25092026.csv` → `200`,
17,285 bytes, `text/csv`, 166 rows. `archives.nseindia.com` serves byte-identical content.

```
Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield
Nifty 50,25-09-2026,23035,23162.7,23020.95,23140.5,77.4,.34,242720711,18949.25,19.56,2.8,1.22
Nifty Smallcap 50,25-09-2026,9858.5,9896.85,9809.15,9883.45,43.75,.44,107461155,4892.6,31.64,3.36,.57
Nifty MidSmallcap 400,25-09-2026,20929.25,20961.9,20797.4,20904.95,-18.6,-.09,1380878561,38948.51,29.74,3.88,.58
NIFTY Midcap 100,25-09-2026,60970.05,61117.45,60595.45,60906.0,-84.15,-.14,661340034,19422.68,29.35,4.13,.56
India VIX,25-09-2026,12.6875,12.835,11.77,12.16,-0.53,-4.16,-,-,-,-,-
```

- OHLC + volume for every broad, sectoral, thematic and strategy index (plus G-Sec/bond rows).
  All 20 registered indices and all 18 first-cut indices (§4) are present. VIX volume is `-`.
- Spelling drifts in **case only**: `NIFTY Midcap 100` (2025/2026) vs `Nifty Midcap 100`
  (04-01-2016). Pre-Nov-2015 files use the old brand (`CNX Nifty`, `CNX Auto` on 01-04-2013).
- Depth: 200 for 26-09-2025, 03-01-2022, 01-07-2020, 04-01-2016, 01-04-2013, 01-06-2012.
- Non-trading day → `404` with a 3.5 KB HTML body (02-10-2025 holiday, 27-09-2025 Saturday).
- Headers: with the plugin's browser `User-Agent` every request returned 200. Without a
  User-Agent, and with curl's default one, `nsearchives` answered inconsistently (one `000`
  connection drop, one 200) — send the existing `NSE_HEADERS` from `src/bhavcopy.ts:55`.
- Rate: 25 sequential requests with no delay → 25 answers (200/404) in 5 s, no throttling.

**niftyindices.com history API — unusable.** `POST
https://www.niftyindices.com/Backpage.aspx/getHistoricaldatatabletoString` with the
`NIFTY SMALLCAP 50` body, with and without a cookie session from
`/reports/historical-data`, returns `302` → `/Sitefinity/Login?ReturnUrl=…` and body
`{"Message":"There was an error processing the request.",…}`. It is now login-walled.

**NSE JSON API — unusable.** `GET https://www.nseindia.com/` → `403`;
`/api/historical/indicesHistory?indexType=NIFTY%20SMALLCAP%2050&…` → `503`.

**Constituent CSVs — work, slugs irregular.**
`https://nsearchives.nseindia.com/content/indices/ind_<slug>list.csv` → `200`, header
`Company Name,Industry,Symbol,Series,ISIN Code`. Verified slugs (rows): `niftysmallcap50` (50),
`niftymidsmallcap400` (401), `niftymidcap100` (100), `niftymidcap150` (150),
`niftysmallcap100` (100), `niftysmallcap250` (251), `niftymicrocap250_` (254), `niftyauto`,
`niftyenergy`, `niftyfmcg`, `niftymetal`, `niftypsubank`, `niftyrealty`, `niftyfinance`,
`niftymedia`, `niftyhealthcare`, `niftyconsumerdurables`, `niftyoilgas`,
`niftyfinancialservices25-50`, `nifty_privatebank`, `niftymidsmallhealthcare_`. 404 for every
guessed slug of Chemicals, Cement, Fin Services Ex-Bank, MidSmall Financial Services,
MidSmall IT & Telecom, Nifty500 Healthcare, REITs & Realty.
`www.niftyindices.com/IndexConstituent/…` serves the same files (octet-stream).

## 3. Decisions

| # | Decision | Reason |
|---|---|---|
| D1 | **Index history source = NSE daily all-indices file** (`nsearchives`), fallback host `archives.nseindia.com` on network error/5xx. No Yahoo fallback for mapped indices. | Only source that works for every index; one file per day covers all indices; values match Yahoo where Yahoo has data. |
| D2 | New module `src/nse-indices.ts` (fetch, parse, range), not an extension of `bhavcopy.ts`. It reuses `NSE_HEADERS` (exported from `bhavcopy.ts`). | Different file, format and failure semantics; `fetchBhavcopy` treats every error as a holiday, which D5 forbids. |
| D3 | Registered indices keep their `^` keys. Midcap 100 is keyed `^NSMIDCP100` (the key `store.ts` already reads). Other new keys = `^` + NSE name uppercased with every non-`[A-Z0-9]` removed (`Nifty Smallcap 50` → `^NIFTYSMALLCAP50`). | Existing keys have history and scans; `^NSMIDCP100` switches on the dormant mid-cap RS; one mechanical rule beats Yahoo's inconsistent `^CNX…`/`….NS` names, and `.NS` would look like an equity (`tools.ts:1867`). |
| D4 | Mapping = column `instruments.nse_index_name TEXT` (via `addColumnIfNotExists`) + checked-in catalogue `data/nse_indices.json` `{symbol, nse_name, category, constituents_slug\|null}`. A key collision with a different name is refused. | Owner decision D5 (query-and-instrument-tools) forbids a new indexes table; the catalogue is the name ↔ symbol ↔ file table and lets add-by-name resolve offline. |
| D5 | Fetch semantics: `404` = no trading/not yet published → skip. Anything else → 3 retries (2 s/4 s/8 s) then **stop the range at that date**; rows before it are written and `last_date` advances only to the last fetched date. | A transient failure must leave a hole to refill, never a silently skipped day. |
| D6 | Names match after normalising (lower-case, collapse whitespace). A mapped index missing from an otherwise valid file does not advance its `last_date` and is reported. A file whose header lacks the six OHLCV columns throws. | Case drift is observed; a renamed index must surface, not go stale silently. |
| D7 | Rows written with `INSERT OR REPLACE`, `adj_close = close`, VIX `-` volume → `0`. P/E, P/B, yield ignored. | Matches `insertOhlcv`; no schema growth for data nothing reads. |
| D8 | Backfill default **365 days**, all 38 indices, **re-fetching the 10 healthy ones too**. `--from` may go back to 2016-01-01; earlier dates are refused. | One source per series (real volume replaces Yahoo's 0); 245 bars cover the 200-day indicators; pre-2016 files use `CNX` names that D6 does not alias. |
| D9 | Network first, write second: a range fetch collects every day in memory (~15 KB × 245), then **one** transaction writes all rows and `sync_meta`. Requests are sequential, 500 ms apart (~2.5 min/year). | Keeps the node-sqlite3-wasm write lock held for well under a second (§7 R4); 500 ms matches `nse-fetcher.ts`. |
| D10 | Raw daily files are cached at `<dbDir>/nse-index-close/ind_close_all_DDMMYYYY.csv` (200s only; the cache dir is a constructor option, `null` in tests). | Adding an index later re-reads a year from disk with zero NSE requests. |
| D11 | Daily sync: `updateAll`/`updateSymbol`/`backfillSymbol`/`backfillAll` route any symbol with `nse_index_name` to one shared NSE pass from `min(last_date)+1` to today. Equities and unmapped symbols stay on Yahoo. | No index depends on Yahoo history; N indices cost one request per day, not N. |
| D12 | First cut = 18 indices: the three requested (`Nifty Smallcap 50` broad, `Nifty MidSmallcap 400` broad, `NIFTY Midcap 100` cap_segment) + the 15 `sector` rows of the research CSV. One index per sector is `sector` (Financial Services, Media, Private Bank, Healthcare Index, Consumer Durables, Oil & Gas, Chemicals, Cement); overlapping variants are `thematic` (Fin Services 25/50, Fin Services Ex-Bank, MidSmall Healthcare, MidSmall Financial Services, MidSmall IT & Telecom, Nifty500 Healthcare, REITs & Realty). | `computeSectorState` ranks every `sector` index; three healthcare and three financial variants would crowd the rotation ranking. |
| D13 | The 18 first-cut rows **and** `nse_index_name` for the 20 existing ones go into `data/instruments.json`; `InstrumentSeedRow` and `upsertInstruments` carry the column. Indices added later by command live only in the DB. | `upsertInstruments` is `INSERT OR REPLACE` with an explicit column list — it would null the mapping — and the refresh sweep deactivates rows absent from the seed (D7 of the earlier plan). The later-add limitation is documented in the README. |
| D14 | Constituents: `replaceIndexConstituents(indexSymbol, rows)` (delete + insert, one transaction), members `<Symbol>.NS`, unknown members reported, never auto-registered. Refreshed on add, and by `update --mode all` for any mapped index whose `as_of_date` is >30 days old. Slug null → skipped with reason `no constituent file`. | NSE rebalances semi-annually; piggybacking on the sync avoids a new cron; upsert alone would keep removed members; also repopulates the empty table so sector breadth works. |
| D15 | Surface: CLI `index list [--available]`, `index add "<NSE name>" [--category C] [--from DATE]`, `index backfill [--symbols A,B] [--from DATE]`, `index constituents [--symbols A,B]`. Tool `nse_index_add {name, category?, backfill_days?=365}` (tools 27 → 28). `nse_market_backfill`/`nse_market_update` add `nsearchives.nseindia.com` to `allowedHosts`. | Validation is "name is in the latest NSE file" (no synthetic instruments, D1 of the earlier plan); `nse_instrument_add` validates against Yahoo and would reject these. |
| D16 | Unknown name → refused with the three closest names from the latest file (normalised Levenshtein). | Makes the "add more later" step self-correcting. |
| D17 | node:sqlite migration is **separate and later**, not a prerequisite. This change adds only a clearer lock error (T9). | Migration touches every `prepare/finalize` in a 3.8k-line store plus the read-only handle and seed path; D9 already keeps this feature's lock window short. |
| D18 | Release as **0.1.37** (patch) per the owner's instruction, following RELEASE.md. | 0.1.36 also shipped features as a patch; version number is the owner's call. |

## 4. First-cut index table

Existing (map only, then re-backfill): `^NSEI` Nifty 50 · `^NSMIDCP` Nifty Next 50 · `^CNX100`
Nifty 100 · `^CNX200` Nifty 200 · `^CRSLDX` Nifty 500 · `^NSEMDCP50` Nifty Midcap 50 ·
`^CNXMC150` Nifty Midcap 150 · `^CNXSC` NIFTY Smallcap 100 · `^CNXSC250` Nifty Smallcap 250 ·
`^CNXMC250` Nifty Microcap 250 · `^NSEBANK` Nifty Bank · `^CNXIT` Nifty IT · `^CNXPHARMA` Nifty
Pharma · `^CNXAUTO` Nifty Auto · `^CNXENERGY` Nifty Energy · `^CNXFMCG` Nifty FMCG · `^CNXMETAL`
Nifty Metal · `^CNXPSUBANK` Nifty PSU Bank · `^CNXREALTY` Nifty Realty · `^INDIAVIX` India VIX.

New (18): `^NIFTYSMALLCAP50`, `^NIFTYMIDSMALLCAP400`, `^NSMIDCP100`, `^NIFTYFINANCIALSERVICES`,
`^NIFTYMEDIA`, `^NIFTYPRIVATEBANK`, `^NIFTYHEALTHCAREINDEX`, `^NIFTYCONSUMERDURABLES`,
`^NIFTYOILGAS`, `^NIFTYCHEMICALS`, `^NIFTYCEMENT`, `^NIFTYFINANCIALSERVICES2550`,
`^NIFTYFINANCIALSERVICESEXBANK`, `^NIFTYMIDSMALLHEALTHCARE`, `^NIFTYMIDSMALLFINANCIALSERVICES`,
`^NIFTYMIDSMALLITTELECOM`, `^NIFTY500HEALTHCARE`, `^NIFTYREITSREALTY`.

The remaining ~84 indices in the research CSV (and newer file-only ones such as Nifty NBFC,
Power, Capital Goods) are added later with one command each: `index add "<name>"`.

## 5. Tasks

| # | Task | Files | Pinned by |
|---|---|---|---|
| T1 | Record fixtures: full `ind_close_all_25092026.csv`, `ind_close_all_04012016.csv` (case drift), a 404 HTML body, `ind_niftysmallcap50list.csv`. | `src/__tests__/fixtures/nse-indices/*` | used by T2–T8 |
| T2 | `parseIndexClose(csv)` → rows keyed by normalised name; header validation; `-` volume → 0; `DD-MM-YYYY` → ISO. | `src/nse-indices.ts` | `nse-indices.test.ts`: 166-row parse, Nifty 50 values, VIX volume 0, 2016 `Nifty Midcap 100` matches `NIFTY Midcap 100`, bad header throws |
| T3 | `fetchIndexClose(date)` / `fetchIndexCloseRange(from, to, names)`: headers, 500 ms spacing, host fallback, 404 skip, retry-then-stop (D5), disk cache (D10). Export `NSE_HEADERS` from `bhavcopy.ts`. | `src/nse-indices.ts`, `src/bhavcopy.ts` | mocked `fetch`: 404 day skipped; 503×4 stops range and reports `stoppedAt`; second run served from cache with 0 fetches; User-Agent sent |
| T4 | Schema: `nse_index_name` column; `InstrumentSeedRow` + `upsertInstruments` carry it. | `src/schema.ts`, `src/store.ts` | `store.test.ts`: seed row round-trips the column; re-upsert does not null it |
| T5 | `data/nse_indices.json` catalogue (38 mapped + CSV names with verified slugs) and `data/instruments.json` rows (D12, D13). | `data/*.json` | `store.test.ts`: every `index` row in `instruments.json` has an `nse_index_name` present in the 25-09-2026 fixture; no duplicate keys |
| T6 | Store routing: `syncNseIndices(symbols, from?)`, used by `updateAll`, `updateSymbol`, `backfillSymbol`, `backfillAll` for mapped symbols; one transaction after network (D9, D11). | `src/store.ts` | `store.test.ts`: 3 mapped indices + 1 equity → 1 NSE fetch/day and 1 Yahoo call; hole keeps `last_date` at the day before; missing name reported and not advanced |
| T7 | `addIndexByName(name, {category, from})`: resolve via file, derive key (D3), collision refuse, suggestions (D16), register, backfill, constituents. | `src/store.ts`, `src/nse-indices.ts` | `store.test.ts`: `Nifty Smallcap 50` → `^NIFTYSMALLCAP50`; `NIFTY Midcap 100` → `^NSMIDCP100`; `Nifty Smalcap 50` refused with suggestion |
| T8 | `replaceIndexConstituents` + fetch by slug + 30-day refresh in `updateAll` (D14). | `src/store.ts`, `src/nse-indices.ts` | `store.test.ts`: removed member disappears; unknown members reported; stale `as_of_date` triggers one fetch, fresh one none |
| T9 | Lock error: a write failing with "database is locked" is rethrown naming `<db>.lock` and saying to remove it only when no `nse-market-data`/`ethos` process is running. | `src/store.ts` | `store.test.ts`: simulated locked error → message contains lock path |
| T10 | CLI `index list/add/backfill/constituents`; help text; README section (source, keys, later-add limitation D13). | `src/cli.ts`, `README.md` | CLI arg parsing covered by store tests; README reviewed |
| T11 | Tool `nse_index_add`; `allowedHosts` on backfill/update tools; count 27 → 28. | `src/tools.ts` | `tools.test.ts`: length 28; `nse_index_add` unknown name → `ok:false code:'not_found'` |
| T12 | `make check`; CHANGELOG 0.1.37; `make version-bump-patch`; commit, push and publish per RELEASE.md **after owner confirmation** (AGENTS.md). | `CHANGELOG.md`, `package.json` | `make check` green |
| T13 | Reinstall: `~/.ethos/plugins/package.json` pin → `0.1.37`, `npm install` there, restart `ethos serve`; run `index backfill --from 2025-09-26` and `index constituents` on the live DB. | `~/.ethos/plugins/` | §6 |

## 6. Verification

Scratch copy first (live DB untouched): `cp ~/.ethos/market-data/market.db $SCRATCH/m.db`.

1. `nse-market-data --db $SCRATCH/m.db index add "Nifty Smallcap 50"`, then `"Nifty MidSmallcap
   400"`, `"NIFTY Midcap 100"`; `index backfill --symbols ^CNXAUTO --from 2025-09-26`.
2. `SELECT symbol, COUNT(*), MIN(date), MAX(date), SUM(volume>0) FROM ohlcv_daily WHERE symbol IN
   ('^NIFTYSMALLCAP50','^NIFTYMIDSMALLCAP400','^NSMIDCP100','^CNXAUTO') GROUP BY 1` → ~245 each,
   max `2026-09-25`, volume > 0 on every row; the second and third adds make 0 NSE requests
   for cached days (D10).
3. `index_constituents` has 50 / 400 / 100 / 15 members for those four.
4. Sync adds a day: in the copy, `DELETE FROM ohlcv_daily WHERE date='2026-09-25'` and set
   `sync_meta.last_date='2026-09-24'` for the four; run `update --mode all` → exactly one row
   each for 2026-09-25, NSE requested once for that date.
5. After T13 on the live DB: all 38 indices ~245 bars; `compute-indicators` then
   `compute-sector-state` gives non-null `pct_members_uptrend`; mid-cap RS non-null.
6. On Monday 2026-09-28 after ~19:00 IST, `update --mode all` adds 2026-09-28 to every index.

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | NSE blocks or changes headers. | Browser headers (T3), host fallback, D5 stops cleanly; D10 cache means a block never loses history. |
| R2 | Index renamed or file format changes. | D6: header check throws; missing name reported per index, `last_date` held. |
| R3 | Holidays / late publication. | 404 skipped without advancing past it; next run retries today. |
| R4 | node-sqlite3-wasm leaves a `market.db.lock` directory after a killed process and blocks all writes. (Observed live 2026-09-26 13:33 — a transient lock while `ethos serve` held the DB; gone on re-check.) | D9 limits the write window to one short transaction after all network I/O; T9 names the lock path. The node:sqlite migration is a separate plan (D17). |
| R5 | Constituent slugs 404 for 7 of 18 new indices. | D14: skipped with a reason; price history unaffected; slug is one catalogue edit later. |

## 8. Amendments (owner, 2026-09-26) — supersede D4 / D11 / D13 where they conflict

The owner approved the plan with these amendments, including the release. The store stays on
node-sqlite3-wasm (D17 unchanged).

Series codes verified against the real CM bhavcopy of 25-09-2026
(`BhavCopy_NSE_CM_0_0_0_20260925_F_0000.csv.zip`, 3,6xx rows): `EQ` 2,660, `SM` 380, `BE` 239,
`ST` 84, `IV` 15, `RR` 6, `E1` 2 (plus bond/G-sec series). Of the 267 live `-SM.NS` symbols,
185 traded as `SM` and 49 as `ST` that day; 33 did not trade. `NHIT`/`CAPINVIT`/`ANANTAM` are
`IV`, `ROCKPP`/`ATLPP` `E1`, `BAGMANE`/`KRT`/`EMBASSY` `RR`. The UDiFF file exists from 2024-01
(verified 03-01-2024); earlier dates are only in the old `cmDDMMMYYYYbhav.csv.zip` format.

| # | Decision | Reason |
|---|---|---|
| A1 | **Per-symbol price source stored in the DB.** `instruments.price_source TEXT` ∈ {`yahoo`,`bhavcopy`,`nse_index`} and `instruments.source_key TEXT` (yahoo: the Yahoo symbol, `RELIANCE.NS`; bhavcopy: `<NSE symbol>:<series>`, `AAKAAR:SM`; nse_index: the NSE index name, `Nifty Smallcap 50`). **Replaces** D4's `nse_index_name`. Every read/update/backfill path routes by `price_source`; nothing probes per run. `InstrumentSeedRow`, `upsertInstruments` and `addInstrument` carry both columns; `upsertInstruments` becomes `INSERT … ON CONFLICT DO UPDATE` with `COALESCE(excluded.x, instruments.x)` for the two columns, so a seed refresh never nulls them. `data/instruments.json` carries both for its 38 index rows (supersedes D13's column name). `data/nse_indices.json` stays the name ↔ symbol ↔ constituent-slug catalogue. | One routing fact per symbol, set once, visible to `nse_market_query`. |
| A2 | **Resolution happens once**, when a symbol with no `price_source` is added or backfilled. `instrument_type='index'` (or a `^` key) → `nse_index`; the name must be in the NSE file for the range, else the symbol fails with that reason and no source is stored. Otherwise Yahoo is fetched for the requested range: ≥ 50 % of the NSE trading days in the range (`^NSEI` bars in the range when that series is ≥ 80 % complete, else Mon–Fri count) → `yahoo`. Else, if `<symbol>:<series>` is in the CM bhavcopy for the range → `bhavcopy` (the key stores the most recent series seen). Else **refuse** with the reason (Yahoo's own error, or `0/N trading days … not in the NSE CM bhavcopy`). One refinement: Yahoo returned *some* rows but under 50 % and the bhavcopy does not have it (a BSE listing, a recent IPO not on NSE) → `yahoo`, reported as partial, rather than discarding real data. The candidate's Yahoo rows are held in memory until the source is decided, so a refused or bhavcopy-resolved symbol never keeps stray Yahoo bars. | Resolution is a one-time cost paid at add/backfill; updates never probe. |
| A3 | **Yahoo → bhavcopy key mapping.** `<SYM>-SM.NS` → `SYM:SM`, `-ST.NS` → `SYM:ST`, `-IV.NS` → `SYM:IV`, `-RR.NS` → `SYM:RR`, `-E1.NS` → `SYM:E1`, plain `<SYM>.NS` → `SYM:EQ`; `.BO` has no bhavcopy key (the CM bhavcopy is NSE-only). Matching uses **series families**: `SM`≡`ST` (an Emerge stock moves between the normal and trade-for-trade segment) and `EQ`≡`BE`≡`BZ` (same, main board); every other series matches exactly. | "Try both for -SM", made permanent: the family survives a later SM ↔ ST move without re-resolution. |
| A4 | **Re-evaluation only on persistent failure.** A `yahoo` symbol whose Yahoo fetch has no row for **3+ consecutive trading days that the bhavcopy has for it** is switched to `bhavcopy`. The streak is `sync_meta.yahoo_miss_streak INTEGER NOT NULL DEFAULT 0` (reset to 0 by any day Yahoo does return); the switch is recorded in a new table `source_switches (symbol, switched_at, from_source, to_source, reason)` and listed in the update summary. **Per-day fill:** each such missed day is written from the bhavcopy already downloaded in the same run. The bhavcopy pass therefore runs **before** the Yahoo pass in `update`, over `min(bhavcopy symbols' next date, today − 10 days)` → today. In `backfill` the pass runs **after** Yahoo (it needs the candidates) and also covers Yahoo symbols whose fetch failed (the previous EQ-only bhavcopy fallback, now series-aware); a backfill fill never switches a source. | Yahoo stays primary for what it serves; a dead Yahoo ticker heals itself in three trading days and says so. |
| A5 | **Daily update groups by source.** One NSE index-close file per day for all `nse_index` symbols (D1/D5/D6/D10 unchanged), one CM bhavcopy per day for all `bhavcopy` symbols (same fetch semantics as D5: 404 = holiday, 3 retries 2/4/8 s then stop the range, 500 ms spacing, host fallback, disk cache `<dbDir>/nse-bhavcopy/cm_YYYYMMDD.csv.gz` holding only symbol/series/OHLCV), Yahoo for the rest with **concurrency 5**, through the same worker pool `backfillAll` uses. Network first, then one short write transaction per source batch (D9): one for the index pass, one for the bhavcopy pass, one per 100 Yahoo symbols. A symbol with no `price_source` reaching `update` gets the A6 migration rule (no network) and it is persisted. Old-format bhavcopy is tried only for dates before 2024-01-01. **Supersedes D11.** *Note (2026-09-26):* `fetcher.ts` has a process-wide 400 ms spacing check (`throttledFetch`), but it is not atomic: concurrent workers read the same `lastCallTime`, wait the same remainder and fire together, so the effective rate is ≈ workers ÷ 0.4 s (measured: 25 calls in ~2 s with 5 workers; a sequential caller gets 2.5 req/s). The throttle is unchanged in 0.1.37 by owner decision; nothing here is described as a speedup. The speed answer is A11 (one bhavcopy per day). | One request per day per file source, whatever the symbol count; the wasm write lock is held for milliseconds. |
| A6 | **Progress is the priority.** `updateAll`/`updateWatchlist`/`backfillAll` (and through them the index and bhavcopy passes) take an `onProgress(event)` callback. One formatter (`src/progress.ts`) turns events into lines for the tools (`ctx.emit({type:'progress', toolName, message, audience:'user', percent})` from `nse_market_update`, `nse_market_backfill`, `nse_index_add`) and the CLI (`update`, `backfill`, `index …` print the same lines): a start line with totals by source (`Updating 3,247 symbols: 38 indices via NSE file, 273 via bhavcopy, 2,936 via Yahoo`); a symbol line at most every 25 symbols or 2 s, whichever first, with done/total, percent, the batch's symbols (first 3 bare names + `+N more`) and the failed count; `day k/n (DD-MM-YYYY)` lines for the file passes under the same throttle. The final ToolResult is a **short summary** — totals, duration, new rows per source, bhavcopy-filled days, source switches, and the failed list with reasons (first 20) — not one line per symbol. `backfillAll`/`updateAll`/`updateWatchlist` return that summary object (`SyncSummary`, with the per-symbol `results` inside); `failed` becomes `{symbol, source, reason}[]`. | The user must feel the run moving; the final message must be readable. |
| A7 | **First-install migration**, once per DB (recorded as `schema_version` 37): fill `price_source`/`source_key` where NULL — `instrument_type='index'` → `nse_index` with the catalogue name (else the instrument name); a Yahoo key ending `-SM/-ST/-IV/-RR/-E1.NS` (the 273) → `bhavcopy` with the A3 key; everything else → `yahoo` with its own symbol — and, when the DB already holds index instruments (a real install, not a blank DB), register the catalogue indices it lacks (the 18 new ones). Idempotent: rows that already have a source are never touched and a second open does nothing. New rows after the migration stay NULL until A2 resolves them. | Existing installs start routed; the new indices appear without a seed refresh (which would deactivate every imported instrument). |
| A8 | `nse_instrument_add` and `import-instruments` pass the source a backfill resolved into `addInstrument` (`SyncResult.priceSource`/`sourceKey`), because both backfill *before* the row exists. A symbol A2 refuses is still registered by `nse_instrument_add` (its existing "registered, backfill failed" path) with the refusal as the reason. | Keeps both tools' write-after-validate ordering. |
| A9 | `NSE_HEADERS` moves to `src/nse-archive.ts` (throttle, host fallback, retry-then-stop, 404 → missing), shared by `nse-indices.ts` and `bhavcopy.ts`; `bhavcopy.ts` re-exports it (refines D2). The old EQ-only `fetchBhavcopy`/`fetchBhavcopayRange` are replaced by series-aware `fetchCmBhavcopy`/`fetchCmBhavcopyRange`. | One place owns NSE HTTP semantics. |
| A10 | CLI additions beyond D15: `backfill --stored-source yahoo\|bhavcopy\|nse_index` (restrict `--all`/`--symbols` to symbols whose *stored* source is that one; renamed from `--source` by A11) and `sources` (counts per source, recent switches). | The live-DB verification needs "bhavcopy backfill for all bhavcopy-sourced symbols" as one command. |
| A11 | **Owner decision (2026-09-26): a `source` preference on update and backfill, default `bhavcopy`.** Tool param `source` ∈ {`bhavcopy`,`yahoo`} on `nse_market_update` and `nse_market_backfill`; CLI `--source bhavcopy\|yahoo` on `update` and `backfill`. **`bhavcopy` (default):** each trading day's CM bhavcopy is downloaded once and every non-index symbol it lists gets that day's row from it, whatever its stored `price_source` — key = the stored bhavcopy key, else the A3 mapping of the Yahoo symbol; a plain `.NS` key (`SYM:EQ`) matches the EQ family first and then any other equity-like series in the file (`SM ST SZ IV RR E1`), never a debt series. A symbol no fetched bhavcopy lists (`.BO`, renamed ticker, did not trade) falls back to its stored source: Yahoo for `yahoo`, nothing for `bhavcopy` (a non-trading SME day is not a failure). An unresolved symbol the bhavcopy lists gets the A7 rule as its stored source (no Yahoo probe); one it does not list goes through A2. **`yahoo`:** every `yahoo`-sourced symbol is fetched from Yahoo, overwriting those days (how split/bonus-adjusted prices are refreshed), with the A4 fill/switch; `bhavcopy`-sourced symbols stay on the bhavcopy. **Indices ignore `source`** (always the NSE file). `source` is a preference, never a failure: the summary lists the fallbacks with reasons (`41 via Yahoo: not in the bhavcopy`, `273 kept on bhavcopy: no Yahoo data`). **No new session → no Yahoo call:** the bhavcopy days of the run double as the session probe (404 = holiday/weekend/not yet published); a symbol with no fetched session after its `last_date` is skipped when the probe completed, and the summary says `No new trading day since <date>`. The 400 ms Yahoo throttle is unchanged. **Bhavcopy rows are raw:** `adj_close = close` (like index rows); split/bonus adjustment comes from `detect-splits`/corporate actions or a periodic `--source yahoo` run (README). The yahoo-mode 10-day fill lookback (A4) applies only with `source: yahoo`. `backfillSymbol` (used by `nse_instrument_add`/`import-instruments`) keeps the Yahoo preference so their validate-by-backfill semantics (A8) are unchanged. | One file per day serves ~3,200 symbols; Yahoo only for what NSE does not list, or on request for adjusted prices. |

### 8.1 Tasks added by the amendments

| # | Task | Pinned by |
|---|---|---|
| T14 | Schema: `price_source`, `source_key`, `sync_meta.yahoo_miss_streak`, `source_switches`; A7 migration. | `store.test.ts`: migration fills 3 kinds, registers catalogue indices only on a DB with indices, second open is a no-op; re-upsert keeps the columns |
| T15 | `bhavcopy.ts`: `parseCmBhavcopy` (all series), `fetchCmBhavcopyRange` via `nse-archive.ts`, cache; key mapping + families (A3). | `bhavcopy.test.ts` on the real trimmed 25-09-2026 fixture (SM/ST/IV/RR/E1/EQ/BE rows) |
| T16 | Store routing (A2, A4, A5): resolution, grouped update, fill, streak, switch. | `store-sources.test.ts`: resolution to each source + refusal; 1 file/day for N symbols; fill + switch after 3 days; Yahoo concurrency pool |
| T17 | `progress.ts` formatter + throttle; tools and CLI wired (A6). | `progress.test.ts`: throttling (not every symbol), summary shape, failed list |

| T18 | A11 source preference: store, tools (`source` enum), CLI `--source`; fallbacks in the summary; session probe. | `store-sources.test.ts`: default run with 3 EQ + 1 SM + 1 `.BO` + 2 indices → 1 bhavcopy + 1 index file per day, Yahoo only for the `.BO`; `source: yahoo` → Yahoo for the EQs, SM stays on the bhavcopy; no new session → no Yahoo call; summary lists fallbacks |

### 8.2 Verification (amends §6)

Scratch copy first (`$SCRATCH/m037.db`), CLI with `--db`: add the three indices; `index backfill
--symbols ^CNXAUTO` → ~245 bars with volume; backfill five bhavcopy-sourced SME symbols
(`AAKAAR-SM.NS`, `ACCPL-SM.NS`, `NHIT-IV.NS`, `FORCAS-SM.NS`, and `ANANTAM.BO` — whatever A2 gives)
→ about a year of bars; `update --mode all` on the copy, capturing progress lines and summary.
Then the live DB, after a backup to `$SCRATCH/market_backup_before_037.db` and a check that no
`ethos serve`/nse process holds it: migration (first open), `index backfill` for all indices
(365 d), `backfill --all --stored-source bhavcopy` (365 d), `index constituents`; report counts per
source, bars per group, and `check_onboarding.py`. A11 adds: time `update --mode all` (default
`bhavcopy`) and `update --mode watchlist --source yahoo` on the scratch copy, with per-source counts.
