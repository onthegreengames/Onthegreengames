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

## Planned Retool section: Returning Visitors & Intent Ranking (deferred)

**Status:** Specification only; the live Retool application has not been changed. Add this next to **Promo Journeys** when manual Retool editing or AI credits are available.

### What the page should show

- Rank **all returning browser visitors**, not just visitors who used a promo code. Show the most promising unconverted prospects first. Use a transparent **intent score** rather than claiming an actual statistical booking probability.
- Date-range pickers (Europe/London), selectable date basis (any activity / first visit / most recent visit), **minimum number of distinct sessions**, and filters for traffic source, campaign, device, promo code, deepest booking step, payment outcome, and new-versus-returning status.
- Cards for returning browser visitors, high-intent unconverted visitors, promo users, Stripe checkout starters, confirmed paid bookings, and excluded likely tests.
- A sortable table: anonymous visitor ID, distinct sessions, days active, first and last seen, initial/latest traffic source, key pages, date checks, promo applications, package/games selections, details reached, Stripe starts, confirmed bookings, last recorded step, and intent score.
- Tap any visitor to open a **chronological cross-session history**: all tracked page views and booking events grouped by session, showing timestamps, source/device, and the four-step funnel milestones. Show legacy event types for visits before the 22 October 2026 redesign. Include related booking/payment status only when a reliable booking reference/link exists; do not infer an identity from timing alone.
- Highlight returning visitors who check availability and use a promo code, and people who return to Booking Information, Terms or Packages after an application. Allow date and sort filters to update the table and its drill-down.
- Add **“Hide known tests”** (on by default), **“Show excluded”**, and an editable internal/test visitor exclusion list with optional reason and date. Start by reviewing browser IDs `cab07663-3456-4dd5-aadb-17c2bb4a4b10` (high-volume site testing) and `9bc37728-fe11-4213-8f1e-7b365817a7c0` (fictitious booking holds); review `74a4a58a` separately rather than automatically declaring them internal. Keep `738f3a99` (previously Visitor 9) visible.
- Show an explicit warning that anonymous browser identifiers are **not people**: other devices, cleared cookies, consent restrictions and shared devices can change apparent return/conversion rates. Behavioural ranking is a triage tool, not proof of intent or identity.

### Returning-visitor definition and scoring

Count a visitor as observed returning when their anonymous `visitor_id` has **at least two distinct `session_id`s**. Also display separate days active to help distinguish genuine return visits from repeated activity on one day. Avoid counting repeated `page_view` events as return visits.

Use a documented **0–100 intent index**, e.g. verified availability (+20), accepted promo (+15), package chosen (+10), extras completed (+10), details reached (+15), Stripe start (+15), repeat visit on another date (+10), revisiting Booking Information/Terms after a booking visit (+5). Cap at 100 and adjust weights later using actual paid conversion data. Separately label **Converted**, **Unconverted**, **Checkout started / unpaid**, **Likely internal**, **Suspected test/fictitious**, and **Unknown**; never rank an already-paid booking as an unconverted lead. Scores are heuristic, not calibrated percentages.

For date filters, select visitors with activity in the requested period but derive each visitor's *returning* status from their prior consented event history **up to the selected range end**, rather than only counting sessions inside the filter period. Label legacy-versus-unified funnel coverage; missing early package/extras events are **unknown**, not a drop-off.

### Read-only example query (returning visitors)

Use Retool date-picker inputs `{{ returningFrom.value }}` and `{{ returningTo.value }}`; parameterise in the existing PostgreSQL resource and adjust input names to the actual components.

```sql
WITH bounds AS (
  SELECT ({{ returningFrom.value }}::date AT TIME ZONE 'Europe/London') AS from_at,
         (({{ returningTo.value }}::date + 1) AT TIME ZONE 'Europe/London') AS to_at
), cohort AS (
  SELECT DISTINCT e.visitor_id
  FROM public.site_analytics_events e CROSS JOIN bounds b
  WHERE e.created_at >= b.from_at AND e.created_at < b.to_at
), history AS (
  SELECT e.visitor_id,
         count(DISTINCT e.session_id) AS sessions,
         count(DISTINCT (e.created_at AT TIME ZONE 'Europe/London')::date) AS days_active,
         min(e.created_at) AS first_seen,
         max(e.created_at) AS last_seen,
         count(*) FILTER (WHERE e.event_name = 'check_date_continue') AS dates_confirmed,
         count(*) FILTER (WHERE e.event_name = 'promo_code_applied') AS promo_applications,
         count(*) FILTER (WHERE e.event_name = 'package_selected') AS packages_selected,
         count(*) FILTER (WHERE e.event_name = 'extras_completed') AS extras_completed,
         count(*) FILTER (WHERE e.event_name = 'details_reached') AS details_reached,
         count(*) FILTER (WHERE e.event_name = 'payment_started') AS stripe_starts,
         count(*) FILTER (WHERE e.event_name = 'booking_completed') AS tracked_completions,
         count(*) FILTER (WHERE e.event_name = 'page_view'
                   AND e.page_path IN ('/booking-info','/terms')) AS help_page_views
  FROM public.site_analytics_events e
  JOIN cohort c ON c.visitor_id=e.visitor_id
  CROSS JOIN bounds b
  WHERE e.created_at < b.to_at
  GROUP BY e.visitor_id
)
SELECT h.*, 
       least(100,
         20*(h.dates_confirmed>0)::int +
         15*(h.promo_applications>0)::int +
         10*(h.packages_selected>0)::int +
         10*(h.extras_completed>0)::int +
         15*(h.details_reached>0)::int +
         15*(h.stripe_starts>0)::int +
         10*(h.days_active>1)::int +
          5*(h.help_page_views>0)::int
       ) AS intent_score
FROM history h
WHERE h.sessions >= 2
ORDER BY (h.tracked_completions = 0) DESC, intent_score DESC, h.last_seen DESC;
```

The query deliberately returns **all** qualifying visitors so Retool can apply a user-maintained exclusion list and optional filters without silently deleting any analytics. Keep one visitor-history query that fetches timestamped events by selected visitor ID (same approach as the Promo Journeys drill-down). An absence of `booking_completed` events is not proof of non-payment; confirm against the bookings/payments backend when linked.

## Historic comparisons

No analytic or booking rows were modified or backfilled. Reports mark:
- Before **22 October 2026**: `legacy`
- **22 October 2026**: `changeover` (both implementations can occur)
- After **22 October 2026**: `unified`

New step events only become available once the frontend is deployed, so do not chart early changeover zeros as genuine abandonment. Compare the two periods on shared, consented metrics such as session-to-completed-booking conversion, not unavailable old step names.

## Deployment, validation and safety

Supabase analytics event constraint and views were migrated prior to merging the updated client. GitHub CI tests with mocked network requests cover valid-only promo uses, date verification, stage progression, and secure Stripe redirect; no live charges or customer emails. Netlify production may be locked: deploy the latest `main` commit after merge. Retool interface changes are deferred until the user's AI credits reset.
