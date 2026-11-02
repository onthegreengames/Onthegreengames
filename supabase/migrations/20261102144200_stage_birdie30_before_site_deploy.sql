-- Pre-create BIRDIE30 to keep checkout valid during a manually published Netlify cutover.
-- BIRDIE40 remains active until the matching website popup has been deployed.
-- Promo settings are copied, not loosened.
DO $prepare$
DECLARE old_offer public.promo_codes%ROWTYPE;
BEGIN
  SELECT * INTO old_offer FROM public.promo_codes WHERE code = 'BIRDIE40';
  IF NOT FOUND OR old_offer.discount_type <> 'percentage' OR old_offer.discount_value <> 40 THEN
    RAISE EXCEPTION 'Expected BIRDIE40 at 40 percent before staging BIRDIE30';
  END IF;
  IF EXISTS (SELECT 1 FROM public.promo_codes WHERE code='BIRDIE30') THEN
    RAISE EXCEPTION 'BIRDIE30 already exists; check its settings before proceeding';
  END IF;
  INSERT INTO public.promo_codes
  (code,description,discount_type,discount_value,active,starts_on,expires_on,max_uses,
   minimum_hire_spend,allow_build_your_own,eligible_package_codes,wedding_date_from,wedding_date_to)
  VALUES
  ('BIRDIE30','Returning visitor discount',old_offer.discount_type,30,true,old_offer.starts_on,
   old_offer.expires_on,old_offer.max_uses,old_offer.minimum_hire_spend,
   old_offer.allow_build_your_own,old_offer.eligible_package_codes,
   old_offer.wedding_date_from,old_offer.wedding_date_to);
END $prepare$;
