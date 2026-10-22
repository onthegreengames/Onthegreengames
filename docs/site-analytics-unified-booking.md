# OTGG site analytics: unified booking journey (2026-10-22)

## What's live after deploying this commit

The four-step booking page emits opt-in first-party analytics events when customers actually complete actions. This does not alter booking prices, customer data, Stripe, or transactional email workflows.

- `check_date_started` and `date_selected`: calendar usage on `/booking` (previously `/check-date`).
- `availability_available` / `availability_unavailable`: result changes from the existing date checker.
- `check_date_continue`: only after date/venue checks succeed, not just a Continue click; saved valid context restored on load is not recorded as a new conversion.
- `booking_started`: booking page opened (retained for backward compatibility; **not** package selection).
- `package_selected`: continued to the games step, with package code in `event_detail`.
- `extra_game_added`: an individual game added while customising (interest, not confirmed hire).
- `extras_completed`: package/game selection passes validation and details step opens. `event_detail` includes package code, count of additional games and mini-golf holes.
- `details_reached`: details/payment section opened.
- `promo_code_applied`: the server accepted a code for the current selection.
- `payment_started`: approved Stripe-hosted checkout URL is returned; selecting a payment radio button alone does not count.
- `booking_completed`: existing confirmed-payment page signal is unchanged.

Tracking remains subject to explicit analytics consent. Events contain no customer name, email, venue name or postcode.

## Retool read-only views (already granted to `otgg_dashboard`)

Use these queries when ready to update the Retool site analytics UI, with no database migration required:

```sql
SELECT * FROM dashboard.site_analytics_funnel_v2_daily
WHERE journey_version = 'unified'
ORDER BY metric_date DESC;
```

This is a **session** funnel: booking page opened → date verified → package selected → extras completed → details reached → payment started → booking completed.

```sql
SELECT * FROM dashboard.site_analytics_package_choices_daily
ORDER BY metric_date DESC, sessions_selected DESC;

SELECT * FROM dashboard.site_analytics_extra_game_interest_daily
ORDER BY metric_date DESC, sessions_added DESC;
```

```sql
SELECT * FROM dashboard.site_analytics_promo_journey_daily
ORDER BY metric_date DESC, promo_code;

SELECT * FROM dashboard.site_analytics_promo_visitor_outcomes
ORDER BY metric_date DESC, promo_code;
```

**Promo definitions:**
- `applied_sessions`: unique sessions applying the code.
- `paid_bookings`: confirmed/part-paid/fully-paid bookings **from the bookings database**, grouped by booking creation date, regardless of whether analytics tracking was permitted.
- `pending_bookings` / `expired_or_cancelled_bookings`: booking holds **not** counted as revenue.
- `no_tracked_paid_booking_sessions`: applications not followed by a tracked paid booking in the same session; not necessarily customers who never bought.
- `visitors_without_tracked_paid_booking`: consented browser visitors who applied the code and have no tracked payment confirmation for that code **across their sessions**.
- The `after_24h` fields provide a more useful matured non-conversion cohort; still not a definitive abandoned-booking count because the person might switch browsers, devices or decline tracking later.

`dashboard.site_analytics_promo_performance` still has its **original column names** (existing Retool widgets remain compatible) but its `bookings`, `booking_value` and `discount_value` now exclude unpaid/expired holds.

## Historic comparisons

No analytic or booking rows were modified or backfilled. Reports mark:
- Before **22 October 2026**: `legacy`
- **22 October 2026**: `changeover` (both implementations can occur)
- After **22 October 2026**: `unified`

New step events only become available once the frontend is deployed, so do not chart early changeover zeros as genuine abandonment. Compare the two periods on shared, consented metrics such as session-to-completed-booking conversion, not unavailable old step names.

## Deployment, validation and safety

Supabase analytics event constraint and views were migrated prior to merging the updated client. GitHub CI tests with mocked network requests cover valid-only promo uses, date verification, stage progression, and secure Stripe redirect; no live charges or customer emails. Netlify production may be locked: deploy the latest `main` commit after merge. Retool interface changes are deferred until the user's AI credits reset.
