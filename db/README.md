# Database

PostgreSQL is the single source of truth for reservation and pickup correctness. Numbered,
dbmate-compatible migrations live in `migrations/`; replaceable function definitions live in
`functions/` and are reapplied after every migration. Never edit an applied migration: create a
new one. Every new function must also receive an explicit `REVOKE`/`GRANT` in `roles.sql`.

## Commands

`pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:rollback` (one migration), and
`DB_RESET_CONFIRM=1 pnpm db:reset`. The runner never loads `.env`; pass configuration through
the process environment. Reset refuses non-loopback database hosts.

## Application errors

| SQLSTATE | Message |
|---|---|
| 45000 | restaurant_not_found |
| 45001 | no_table_available |
| 45002 | slot_full |
| 45003 | item_unavailable |
| 45004 | closed_at_requested_time |
| 45005 | party_too_large |
| 45006 | slot_in_past |
| 45007 | empty_order |
| 45008 | invalid_quantity |
| 45009 | no_pickup_slot |
| 45010 | pickup_too_early |
| 45011 | order_number_exhausted |
| 45012 | phone_required |
| 45013 | invalid_category |
| 45014 | summary_too_long |

## Time zones

Opening hours are local wall-clock times converted by PostgreSQL to `timestamptz`. PostgreSQL's
rules decide nonexistent and ambiguous 02:00–03:00 times on DST transition nights. A
`timestamptz` `generate_series` advances in absolute time, so a rare opening window crossing a
DST boundary can shift the wall-clock grid by one hour. Restaurants should avoid scheduling
bookings in that transition interval.
