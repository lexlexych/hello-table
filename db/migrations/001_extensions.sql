-- Extensions used for fuzzy matching and exclusion constraints.
-- migrate:up
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- migrate:down
DROP EXTENSION IF EXISTS btree_gist;
DROP EXTENSION IF EXISTS unaccent;
DROP EXTENSION IF EXISTS pg_trgm;
