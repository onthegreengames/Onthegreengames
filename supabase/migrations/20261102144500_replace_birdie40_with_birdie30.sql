-- Replace the returning visitor popup code without rewriting historical bookings or analytics.
-- Retains the original promotion eligibility, dates and use limits, changing only its name/rate.
-- Apply only when the updated BIRDIE30 popup has been published.
DO $birdie$
DECLARE old_offer public.promo_codes%ROWTYPE;
BEGIN
  SELECT * INTO old_offer FROM public.promo_codes WHERE code = 'BIRDIE40' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BIRDIE40 is absent; verify promo state before cutover';
  END IF;
  IF old_offer.discount_type <> 'percentage'
    OR old_offer.discount_value <> 40
    OR old_offer.active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'BIRDIE40 configuration changed; do not overwrite blindly';
  END IF;
  IF EXISTS (SELECT 1 FROM public.promo_codes WHERE code = 'BIRDIE30') THEN
    RAISE EXCEPTION 'BIRDIE30 already exists; verify promo state before cutover';
  END IF;

  INSERT INTO public.promo_codes (
    code, description, discount_type, discount_value, active,
    starts_on, expires_on, max_uses, minimum_hire_spend, allow_build_your_own,
    eligible_package_codes, wedding_date_from, wedding_date_to
  )
  VALUES (
    'BIRDIE30', 'Returning visitor discount', old_offer.discount_type, 30, true,
    old_offer.starts_on, old_offer.expires_on, old_offer.max_uses,
    old_offer.minimum_hire_spend, old_offer.allow_build_your_own,
    old_offer.eligible_package_codes, old_offer.wedding_date_from, old_offer.wedding_date_to
  );

  UPDATE public.promo_codes
  SET active = false, updated_at = now()
  WHERE id = old_offer.id;
END
$birdie$;
