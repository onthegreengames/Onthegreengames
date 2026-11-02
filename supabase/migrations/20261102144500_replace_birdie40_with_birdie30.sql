-- Complete cutover after the website displays BIRDIE30.
-- BIRDIE30 was created by the preceding staging migration.
-- Preserve historical BIRDIE40 booking references and popup analytics.
DO $birdie$
BEGIN
  IF (SELECT count(*) FROM public.promo_codes
      WHERE code='BIRDIE30' AND discount_type='percentage'
        AND discount_value=30 AND active) <> 1 THEN
    RAISE EXCEPTION 'BIRDIE30 must be active at 30 percent before retiring the old code';
  END IF;
  IF (SELECT count(*) FROM public.promo_codes
      WHERE code='BIRDIE40' AND discount_type='percentage'
        AND discount_value=40 AND active) <> 1 THEN
    RAISE EXCEPTION 'BIRDIE40 configuration changed during cutover';
  END IF;

  UPDATE public.promo_codes
  SET active=false, updated_at=now()
  WHERE code='BIRDIE40';
END $birdie$;
