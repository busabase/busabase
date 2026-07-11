-- Custom SQL migration file, put your code below! --

-- Backs the ilike('%...%') substring-match fallback in logic/search.ts with a
-- usable index (gin_trgm_ops) — without it, that OR branch forces a
-- sequential scan for every global search query, including no-hit ones.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
