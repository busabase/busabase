# OpenAPI perf tests

Ad-hoc load testing for the `/api/v1` REST surface, kept here so a perf pass
is repeatable instead of one-off. Not part of CI — run manually when touching
a hot read/write path (search, paged lists, bulk import/merge).

## Run it

```bash
# 1. Build + start busabase (perf numbers in dev mode are meaningless —
#    Next dev-mode compilation dominates the timing)
pnpm --filter busabase build
pnpm --filter busabase start   # or: PG_DATABASE_URL=postgres://... pnpm --filter busabase start

# 2. Seed the baseline demo dataset (bases, records, skills, ...)
pnpm --filter busabase demo

# 3. Baseline checkpoint
pnpm --filter busabase perf:suite

# 4. Bulk-add records to the `blog` base for a large-scale checkpoint
SEED_TOTAL=8000 pnpm --filter busabase perf:seed
pnpm --filter busabase perf:suite

# 5. Concurrent create → review → merge write test
pnpm --filter busabase perf:writes
```

`DURATION` (seconds/scenario, default 10) and `CONNECTIONS` (default 20)
tune `perf:suite`; `WORKERS`/`DURATION` tune `perf:writes`; `SEED_TOTAL`
tunes `perf:seed` (batched in groups of 1000 — the bulk-change-request API
cap). `BUSABASE_URL` overrides the target server for all three scripts.

## Search quality evaluation

This is an offline regression evaluation, not synthetic production analytics.
It runs 20 seed-validated ground-truth queries (records, Bases, Docs, and file
body content) repeatedly through the real quick/full HTTP paths and writes a
JSON report. The default is 500 sequential sessions.

Use one file-backed PGLite database and one storage directory for both seed and
server. Reusing the database with a different storage directory makes file-body
results look absent even though their metadata rows still exist.

```bash
export PG_DATABASE_URL=pglite://.data/search-eval
export STORAGE_URL=local:.data/search-eval-assets

# Seed the real English default workspace, then serve that exact DB + storage.
pnpm --filter ./apps/busabase db:seed:all
pnpm --filter ./apps/busabase exec next dev --webpack -p 15425

# In another terminal:
SEARCH_EVAL_URL=http://127.0.0.1:15425 \
  pnpm --filter ./apps/busabase perf:search-quality
```

Controls:

- `SEARCH_EVAL_SESSIONS` defaults to `500`.
- `SEARCH_EVAL_OUTPUT` defaults to `/tmp/busabase-search-quality-eval.json`.
- `SEARCH_EVAL_URL` defaults to `http://127.0.0.1:15419`.
- Remote targets are refused by default. `SEARCH_EVAL_ALLOW_REMOTE=1` is an
  explicit acknowledgement that the run will generate real traffic and
  ordinary request-level telemetry.

The evaluator never calls `searchMetrics.report`; its no-click result is a
proxy based on whether the ground-truth target appears in quick rank 1-6 or
advanced rank 1-20. It also omits the browser-local Recently visited cache, so
quick coverage is conservative for targets a person has already opened.

## Test PGLite vs Postgres

Both backends are worth checking — PGLite is the default "zero setup" mode,
but a single WASM/embedded Postgres instance behaves very differently under
concurrency than a real one:

```bash
# PGLite (default): PG_DATABASE_URL=pglite://.data/busabase
pnpm --filter busabase build && pnpm --filter busabase start
# ...seed + perf:suite as above...

# Real Postgres: point at a scratch database, don't reuse a shared dev DB
docker exec <postgres-container> psql -U bika -d postgres -c "CREATE DATABASE busabase_perf;"
# apps/busabase/.env: PG_DATABASE_URL="postgres://bika:bikabika@localhost:5432/busabase_perf"
pnpm --filter busabase db:migrate
pnpm --filter busabase build && pnpm --filter busabase start
# ...seed + perf:suite as above...
```

## What to look for

- Compare `req/s` and `p50`/`p99` latency across a baseline run and a bulk-seeded
  run — an endpoint that's fine at 400 records but craters at 8000+ has a
  scaling bug (missing index, unbounded query, N+1), not just noise.
- A single-request timing (`curl -w "%{time_total}"`) isolates real query cost
  from concurrency queueing — if 20-concurrent p50 is much worse than
  20× the single-request time, something is serializing (connection pool,
  single-threaded CPU work, or — on PGLite specifically — the whole process).
- Check response *size*, not just latency (`curl -o /dev/null -w "%{size_download}"`).
  A slow endpoint under concurrency is sometimes actually a payload-size bug.
