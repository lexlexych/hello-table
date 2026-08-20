# Database

PostgreSQL is the single source of truth for reservation and pickup correctness. Numbered,
dbmate-compatible migrations live in `migrations/`; replaceable function definitions live in
`functions/` and are reapplied after every migration. Never edit an applied migration: create a
new one. Every new function must also receive an explicit `REVOKE`/`GRANT` in `roles.sql`.

## Commands

`pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:rollback` (one migration), and
`DB_RESET_CONFIRM=1 pnpm db:reset`. Root database commands load the repository `.env` through
Node's `--env-file-if-exists`; an explicit `--url` still takes precedence over `DATABASE_URL`.
Reset refuses non-loopback database hosts even when the URL came from `.env`.

`pnpm db:passwords` sets the `agent_app`, `n8n_app`, `portal_app` and `website_app` passwords from the environment
without touching the schema. Use it whenever a
role password in the cluster drifts from what an application's connection string expects
(`28P01`).

**Roles are cluster-wide, not per-database.** `ALTER ROLE … PASSWORD` therefore affects
every database at once. The test suite must never do it: `db/tests/global-setup.ts` calls
`migrate(url, { syncRolePasswords: false })`, and `permissions.test.ts` switches identity
with `SET LOCAL ROLE` inside a transaction instead of logging in with a password. Test runs
leave the developer's working passwords alone.

## Roles

`roles.sql` is reapplied on every `pnpm db:migrate`, so grant changes need no migration.
`agent_app` is the voice-agent runtime role: it cannot access tables and can execute only
the RPCs of its registered tools: table availability and reservation, current menu, pickup
slots and creation, callback creation, plus `get_agent_runtime_settings`. The last RPC returns
only the per-restaurant voice mode needed before a session is constructed. `n8n_app` remains separate for
workflow launched from chats and forms; credentials are never shared between the two.
`portal_app` holds `SELECT/INSERT/UPDATE` on all tables plus `DELETE` on exactly three
reference tables — `restaurant_tables`, `menu_categories`, `menu_items` — which the portal
administrator edits. Operational tables hold personal data and are pruned only by
`purge_expired_personal_data()`. The only manual exception is
`delete_callback_request(restaurant, callback)`: `portal_app` may execute that function but
still has no table-level `DELETE`. The grant is deliberately kept out of
`ALTER DEFAULT PRIVILEGES` so a future table cannot inherit it silently.
`website_app` is the public-site server role: it cannot access tables and can execute only
`find_available_tables` and `create_reservation_for_table`.

Note for callers: `ON DELETE RESTRICT` raises SQLSTATE **23001** (`restrict_violation`),
not 23503.

## Portal day bookings

`book_table_for_day` and `cancel_table_booking` back the `/tables` screen. Unlike
`create_reservation_atomic`, which picks a table for a party and books one `slot_minutes`
window, they book a **caller-chosen** table from a given local time until local midnight of
the next day. Rows land in `reservations` so the voice agent sees the table as taken.
`max_party_size` is deliberately not enforced there: it caps phone bookings, and the table
is chosen by a human. Only `portal_app` holds `EXECUTE`.

## Local-time wrappers for the voice agent

`find_pickup_slots_local` and `create_pickup_order_local` are thin wrappers over
`find_pickup_slots` and `create_pickup_order_atomic`. The wrapped functions take and return
`timestamptz`, but `agent_app` cannot read tables and therefore cannot read
`restaurants.timezone`: it can neither build a moment from "tomorrow at eight" nor speak a
returned moment as local wall-clock time. The wrappers convert in both directions, derive the
order's `max(prep_minutes)` from the item list, and round a requested pickup time **up** to the
next quarter hour, which `pickup_slot_is_free` requires. All correctness — prices, total, slot
capacity, order number, atomicity — stays in the wrapped functions. Same reasoning as
`create_reservation_for_table`, which takes a date and a time instead of a moment.

`find_pickup_slots` adds the preparation lead to **now**, not to the caller's `p_earliest`.
Previously the lead was added on top of `p_earliest`, so a guest asking for 20:00 was offered
20:30 as the earliest slot. Every caller before the voice agent passed `p_earliest = NULL`,
where both forms are identical.

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
| 45015 | table_not_available |
| 45016 | table_already_booked |

## Callback messages

`callback_requests` is the shared operator queue. Voice requests use `source='voice'` and
`caller_phone`; the future Telegram input will use `source='telegram'` and
`telegram_user_id`. The CHECK constraints prohibit mixing both contacts in one row.
`create_callback_request` is the voice RPC and fixes its source itself, so the model cannot
choose or spoof a channel. Existing rows without a contact remain readable after migration,
but every new voice request requires a non-empty phone.

`delete_callback_request` removes at most one row matching both the configured restaurant and
the message UUID. A missing row and a UUID from another restaurant both return `false`.
Existing `call_logs.callback_id ON DELETE SET NULL` keeps non-personal call metrics while
removing the message and its contact immediately.

## Time zones

Opening hours are local wall-clock times converted by PostgreSQL to `timestamptz`. PostgreSQL's
rules decide nonexistent and ambiguous 02:00–03:00 times on DST transition nights. A
`timestamptz` `generate_series` advances in absolute time, so a rare opening window crossing a
DST boundary can shift the wall-clock grid by one hour. Restaurants should avoid scheduling
bookings in that transition interval.
