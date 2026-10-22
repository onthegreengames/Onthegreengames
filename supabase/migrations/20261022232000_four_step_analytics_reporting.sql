-- Four-step booking analytics, 22 October 2026.
-- Preserves historic event rows and all existing dashboard view interfaces.
-- Retool user remains read-only. Consent enforcement stays in website tracking.
ALTER TABLE public.site_analytics_events
  DROP CONSTRAINT IF EXISTS site_analytics_events_event_name_check;
ALTER TABLE public.site_analytics_events
  ADD CONSTRAINT site_analytics_events_event_name_check
  CHECK (event_name = ANY (ARRAY[
    'page_view','check_date_started','date_selected',
    'availability_available','availability_unavailable','check_date_continue',
    'booking_started','package_selected','extra_game_added',
    'extras_completed','details_reached','promo_code_applied',
    'payment_started','booking_completed','balance_payment_completed'
  ]::text[]));

-- New funnel: use one row per session, not click counts, for step conversion.
-- 22 October is deliberately a mixed changeover day; no missing events are backfilled.
CREATE OR REPLACE VIEW dashboard.site_analytics_funnel_v2_daily AS
WITH stage_flags AS (
  SELECT e.session_id,
    bool_or(e.event_name = 'page_view' AND e.page_path = '/booking') AS opened_booking,
    bool_or(e.event_name = 'check_date_started') AS date_step_started,
    bool_or(e.event_name = 'availability_available') AS date_available,
    bool_or(e.event_name = 'check_date_continue') AS date_verified,
    bool_or(e.event_name = 'package_selected') AS package_selected,
    bool_or(e.event_name = 'extras_completed') AS extras_completed,
    bool_or(e.event_name = 'details_reached') AS details_reached,
    bool_or(e.event_name = 'payment_started') AS payment_started,
    bool_or(e.event_name = 'booking_completed') AS booking_completed
  FROM public.site_analytics_events e
  GROUP BY e.session_id
), daily AS (
  SELECT (s.started_at AT TIME ZONE 'Europe/London')::date AS metric_date,
    count(*) AS sessions,
    count(*) FILTER (WHERE f.opened_booking) AS booking_page_sessions,
    count(*) FILTER (WHERE f.date_step_started) AS date_step_sessions,
    count(*) FILTER (WHERE f.date_available) AS date_available_sessions,
    count(*) FILTER (WHERE f.date_verified) AS date_verified_sessions,
    count(*) FILTER (WHERE f.package_selected) AS package_selected_sessions,
    count(*) FILTER (WHERE f.extras_completed) AS extras_completed_sessions,
    count(*) FILTER (WHERE f.details_reached) AS details_reached_sessions,
    count(*) FILTER (WHERE f.payment_started) AS payment_started_sessions,
    count(*) FILTER (WHERE f.booking_completed) AS booking_completed_sessions
  FROM dashboard.site_analytics_sessions s
  JOIN stage_flags f ON f.session_id = s.session_id
  GROUP BY 1
)
SELECT d.*,
  CASE
    WHEN metric_date < DATE '2026-10-22' THEN 'legacy'
    WHEN metric_date = DATE '2026-10-22' THEN 'changeover'
    ELSE 'unified'
  END::text AS journey_version,
  round(100.0 * date_verified_sessions / nullif(date_step_sessions,0),2) AS date_to_verified_pct,
  round(100.0 * package_selected_sessions / nullif(date_verified_sessions,0),2) AS verified_to_package_pct,
  round(100.0 * extras_completed_sessions / nullif(package_selected_sessions,0),2) AS package_to_extras_pct,
  round(100.0 * details_reached_sessions / nullif(extras_completed_sessions,0),2) AS extras_to_details_pct,
  round(100.0 * payment_started_sessions / nullif(details_reached_sessions,0),2) AS details_to_payment_pct,
  round(100.0 * booking_completed_sessions / nullif(payment_started_sessions,0),2) AS payment_to_booking_pct,
  round(100.0 * booking_completed_sessions / nullif(booking_page_sessions,0),2) AS booking_page_conversion_pct
FROM daily d;

-- Selected packages (when couples *continue* after choosing a package).
CREATE OR REPLACE VIEW dashboard.site_analytics_package_choices_daily AS
SELECT (e.created_at AT TIME ZONE 'Europe/London')::date AS metric_date,
  e.event_detail AS package_code,
  count(*) AS selections,
  count(DISTINCT e.session_id) AS sessions_selected,
  count(DISTINCT e.visitor_id) AS visitors_selected
FROM public.site_analytics_events e
WHERE e.event_name = 'package_selected' AND e.event_detail IS NOT NULL
GROUP BY 1,2;

-- Games added to the selection; this measures interest, not confirmed game hire.
CREATE OR REPLACE VIEW dashboard.site_analytics_extra_game_interest_daily AS
SELECT (e.created_at AT TIME ZONE 'Europe/London')::date AS metric_date,
  e.event_detail AS game_code,
  count(*) AS additions,
  count(DISTINCT e.session_id) AS sessions_added,
  count(DISTINCT e.visitor_id) AS visitors_added
FROM public.site_analytics_events e
WHERE e.event_name = 'extra_game_added' AND e.event_detail IS NOT NULL
GROUP BY 1,2;

-- Keep the existing Retool-facing promo view and its columns, but stop treating
-- expired or unpaid holds as converted/booked revenue.
CREATE OR REPLACE VIEW dashboard.site_analytics_promo_performance AS
WITH applied AS (
  SELECT (e.created_at AT TIME ZONE 'Europe/London')::date AS metric_date,
    upper(e.promo_code) AS promo_code, count(*) AS promo_applies,
    count(DISTINCT e.session_id) AS sessions_applied,
    count(DISTINCT e.visitor_id) AS visitors_applied
  FROM public.site_analytics_events e
  WHERE e.event_name = 'promo_code_applied' AND e.promo_code IS NOT NULL
  GROUP BY 1,2
), booked AS (
  SELECT (b.created_at AT TIME ZONE 'Europe/London')::date AS metric_date,
    upper(b.promo_code) AS promo_code,
    count(*) FILTER (WHERE b.status IN (
      'confirmed_part_paid','paid','completed','Confirmed','Part Paid','Paid'
    )) AS bookings,
    coalesce(sum(b.total_price) FILTER (WHERE b.status IN (
      'confirmed_part_paid','paid','completed','Confirmed','Part Paid','Paid'
    )),0::numeric) AS booking_value,
    coalesce(sum(b.promo_discount_amount) FILTER (WHERE b.status IN (
      'confirmed_part_paid','paid','completed','Confirmed','Part Paid','Paid'
    )),0::numeric) AS discount_value
  FROM public.bookings b
  WHERE b.promo_code IS NOT NULL
  GROUP BY 1,2
)
SELECT coalesce(a.metric_date,b.metric_date) AS metric_date,
  coalesce(a.promo_code,b.promo_code) AS promo_code,
  coalesce(a.promo_applies,0::bigint) AS promo_applies,
  coalesce(a.sessions_applied,0::bigint) AS sessions_applied,
  coalesce(a.visitors_applied,0::bigint) AS visitors_applied,
  coalesce(b.bookings,0::bigint) AS bookings,
  coalesce(b.booking_value,0::numeric) AS booking_value,
  coalesce(b.discount_value,0::numeric) AS discount_value
FROM applied a
FULL JOIN booked b ON b.metric_date = a.metric_date AND b.promo_code = a.promo_code;

-- Applied-but-not-booked is reported at the *tracking-session* level.
-- It cannot definitively identify a person who booked on another device,
-- another session, or without analytics consent.
CREATE OR REPLACE VIEW dashboard.site_analytics_promo_journey_daily AS
WITH first_applies AS (
  SELECT DISTINCT ON (e.session_id, upper(e.promo_code))
    e.session_id, e.visitor_id, upper(e.promo_code) AS promo_code,
    e.created_at AS applied_at,
    (e.created_at AT TIME ZONE 'Europe/London')::date AS metric_date
  FROM public.site_analytics_events e
  WHERE e.event_name = 'promo_code_applied'
    AND e.promo_code IS NOT NULL
  ORDER BY e.session_id,upper(e.promo_code),e.created_at
), outcomes AS (
  SELECT a.*,
    EXISTS (
      SELECT 1
      FROM public.site_analytics_events p
      WHERE p.session_id = a.session_id
        AND p.event_name = 'payment_started'
        AND p.created_at >= a.applied_at
    ) AS tracked_checkout_started,
    EXISTS (
      SELECT 1
      FROM public.site_analytics_events c
      JOIN public.bookings b ON b.booking_reference = c.booking_reference
      WHERE c.session_id = a.session_id
        AND c.event_name = 'booking_completed'
        AND c.created_at >= a.applied_at
        AND upper(b.promo_code) = a.promo_code
        AND b.status IN (
          'confirmed_part_paid','paid','completed','Confirmed','Part Paid','Paid'
        )
    ) AS tracked_paid_booking
  FROM first_applies a
), applications AS (
  SELECT o.metric_date,o.promo_code,
    count(*) AS applied_sessions,
    count(*) FILTER (WHERE o.tracked_checkout_started) AS checkout_started_sessions,
    count(*) FILTER (WHERE o.tracked_paid_booking) AS tracked_paid_booking_sessions,
    count(*) FILTER (WHERE NOT o.tracked_paid_booking) AS no_tracked_paid_booking_sessions,
    count(*) FILTER (
      WHERE NOT o.tracked_paid_booking
        AND o.applied_at <= now() - interval '24 hours'
    ) AS no_tracked_paid_booking_after_24h_sessions
  FROM outcomes o
  GROUP BY 1,2
), booking_statuses AS (
  SELECT (b.created_at AT TIME ZONE 'Europe/London')::date AS metric_date,
    upper(b.promo_code) AS promo_code,
    count(*) FILTER (WHERE b.status IN (
      'confirmed_part_paid','paid','completed','Confirmed','Part Paid','Paid'
    )) AS paid_bookings,
    count(*) FILTER (WHERE b.status IN (
      'awaiting_deposit','Awaiting Deposit'
    )) AS pending_bookings,
    count(*) FILTER (WHERE b.status IN ('expired','cancelled')) AS expired_or_cancelled_bookings,
    coalesce(sum(b.total_price) FILTER (WHERE b.status IN (
      'confirmed_part_paid','paid','completed','Confirmed','Part Paid','Paid'
    )),0::numeric) AS paid_booking_value,
    coalesce(sum(b.promo_discount_amount) FILTER (WHERE b.status IN (
      'confirmed_part_paid','paid','completed','Confirmed','Part Paid','Paid'
    )),0::numeric) AS paid_discount_value
  FROM public.bookings b
  WHERE b.promo_code IS NOT NULL
  GROUP BY 1,2
)
SELECT coalesce(a.metric_date,b.metric_date) AS metric_date,
  coalesce(a.promo_code,b.promo_code) AS promo_code,
  coalesce(a.applied_sessions,0::bigint) AS applied_sessions,
  coalesce(a.checkout_started_sessions,0::bigint) AS checkout_started_sessions,
  coalesce(a.tracked_paid_booking_sessions,0::bigint) AS tracked_paid_booking_sessions,
  coalesce(a.no_tracked_paid_booking_sessions,0::bigint) AS no_tracked_paid_booking_sessions,
  coalesce(a.no_tracked_paid_booking_after_24h_sessions,0::bigint)
    AS no_tracked_paid_booking_after_24h_sessions,
  coalesce(b.paid_bookings,0::bigint) AS paid_bookings,
  coalesce(b.pending_bookings,0::bigint) AS pending_bookings,
  coalesce(b.expired_or_cancelled_bookings,0::bigint) AS expired_or_cancelled_bookings,
  coalesce(b.paid_booking_value,0::numeric) AS paid_booking_value,
  coalesce(b.paid_discount_value,0::numeric) AS paid_discount_value
FROM applications a
FULL JOIN booking_statuses b
  ON b.metric_date = a.metric_date AND b.promo_code = a.promo_code;

-- The existing Retool PostgreSQL role receives only SELECT permissions.
GRANT SELECT ON dashboard.site_analytics_funnel_v2_daily,
  dashboard.site_analytics_package_choices_daily,
  dashboard.site_analytics_extra_game_interest_daily,
  dashboard.site_analytics_promo_journey_daily
TO otgg_dashboard;
