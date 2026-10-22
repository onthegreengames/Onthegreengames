-- Cross-session promo outcomes, aggregated by consented browser visitor and code.
-- These are analytics visitors, not identified people; conversions on another
-- device or without analytics consent cannot be matched.
CREATE OR REPLACE VIEW dashboard.site_analytics_promo_visitor_outcomes AS
WITH first_applied AS (
 SELECT e.visitor_id, upper(e.promo_code) AS promo_code,
        min(e.created_at) AS first_applied_at
 FROM public.site_analytics_events e
 WHERE e.event_name = 'promo_code_applied'
   AND e.promo_code IS NOT NULL
 GROUP BY e.visitor_id, upper(e.promo_code)
), matched AS (
 SELECT a.*,
   EXISTS (
     SELECT 1
     FROM public.site_analytics_events confirmation
     JOIN public.bookings b
       ON b.booking_reference = confirmation.booking_reference
     WHERE confirmation.visitor_id = a.visitor_id
       AND confirmation.created_at >= a.first_applied_at
       AND confirmation.event_name = 'booking_completed'
       AND upper(b.promo_code) = a.promo_code
       AND b.status IN (
         'confirmed_part_paid','paid','completed','Confirmed','Part Paid','Paid'
       )
   ) AS later_tracked_paid_booking
 FROM first_applied a
)
SELECT (m.first_applied_at AT TIME ZONE 'Europe/London')::date AS metric_date,
 m.promo_code,
 count(*) AS visitors_applied,
 count(*) FILTER (WHERE m.later_tracked_paid_booking) AS visitors_with_tracked_paid_booking,
 count(*) FILTER (WHERE NOT m.later_tracked_paid_booking) AS visitors_without_tracked_paid_booking,
 count(*) FILTER (
   WHERE NOT m.later_tracked_paid_booking
     AND m.first_applied_at <= now() - interval '24 hours'
 ) AS visitors_without_tracked_paid_booking_after_24h
FROM matched m
GROUP BY 1,2;

GRANT SELECT ON dashboard.site_analytics_promo_visitor_outcomes TO otgg_dashboard;
