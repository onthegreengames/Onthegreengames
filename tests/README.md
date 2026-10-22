# Unified booking-flow validation

- `node tests/booking-endpoints.cjs`: mocks Supabase transport; verifies extras are forwarded and browser totals are ignored.
- Install `jsdom@26` outside the site directory, then run `NODE_PATH=/path/to/node_modules node tests/booking-flow.cjs`: exercises the accordion, Mix requirements, BYO minimum, promo invalidation, mobile summary order, and saved-booking recovery. Stripe and booking requests are mocked.
- `tests/package-extras.sql`: database integration assertions inside an explicit rollback transaction. Uses the existing OCT50 promotion, so the promo assertion is time-dependent. Verifies all package prices, extras, duplicates, unavailable games, legacy quotes, saved line items and non-discounted travel. No test booking or customer is retained.

Migration `20261022185740_package_game_extras.sql` is backwards compatible: the original quote APIs remain unchanged, the booking RPC accepts an optional `extra_game_codes` array, and the new quote RPCs are restricted to `service_role`. Apply it before deploying the updated Netlify endpoints and booking page. Existing bookings are not repriced or edited.

No live charge or customer email is sent by these tests. Existing Stripe checkout and webhook implementations are unchanged and use the authoritative saved booking total.

- The first date-and-venue step blocks the package step until `OTGGDateVerified` is called. DOM assertions check that edits invalidate the context, changed travel fees update totals, and selected extras are preserved when returning to packages.
- `booking-date.js` reuses the original public Supabase blocked-date, opening-date and postcode-fee lookups. All availability must be rechecked on Continue; production checkout still validates prices and dates server-side.
