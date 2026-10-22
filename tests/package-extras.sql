-- Integration assertions; never commit the test booking or customer.
BEGIN;
SET LOCAL ROLE service_role;
DO $test$
DECLARE q jsonb; b jsonb; fee numeric; invalid boolean; test_date date;
BEGIN
 SELECT d::date INTO test_date FROM generate_series('2035-01-01'::date,'2035-02-01'::date,'1 day') d WHERE public.is_date_available(d::date) LIMIT 1;
 IF test_date IS NULL THEN RAISE EXCEPTION 'No free test date'; END IF;
 q:=public.quote_booking_v4('package','classic_collection',ARRAY['giant_jenga','wooden_ring_toss','giant_dominoes','limbo'],1,ARRAY['cornhole']);
 IF (q->>'subtotal')::numeric<>475 THEN RAISE EXCEPTION 'Classic extras/golf price mismatch: %',q; END IF;
 q:=public.quote_booking_v4('package','the_mix',ARRAY['cornhole','giant_connect_4','limbo','giant_jenga'],0,ARRAY['giant_dominoes']);
 IF (q->>'subtotal')::numeric<>375 THEN RAISE EXCEPTION 'Mix extra price mismatch'; END IF;
 q:=public.quote_booking_v4('package','premium_collection',ARRAY['cornhole','giant_connect_4','giant_noughts_and_crosses'],0,ARRAY['limbo']);
 IF (q->>'subtotal')::numeric<>400 THEN RAISE EXCEPTION 'Premium extra price mismatch'; END IF;
 q:=public.quote_booking_v4('package','complete_collection',ARRAY['cornhole','giant_connect_4','giant_noughts_and_crosses','limbo','giant_jenga','giant_dominoes','wooden_ring_toss'],3,'{}');
 IF (q->>'subtotal')::numeric<>850 THEN RAISE EXCEPTION 'Complete price mismatch'; END IF;
 q:=public.quote_booking_v4('build_your_own',NULL,ARRAY['cornhole','giant_connect_4','limbo'],0,'{}');
 IF (q->>'subtotal')::numeric<>300 THEN RAISE EXCEPTION 'BYO price mismatch'; END IF;
 invalid:=false; BEGIN PERFORM public.quote_booking_v4('package','mini_golf_3','{}',3,ARRAY['limbo','limbo']); EXCEPTION WHEN OTHERS THEN invalid:=true; END;
 IF NOT invalid THEN RAISE EXCEPTION 'Duplicate extras accepted'; END IF;
 invalid:=false; BEGIN PERFORM public.quote_booking_v4('package','classic_collection',ARRAY['limbo','giant_jenga','giant_dominoes','wooden_ring_toss'],0,ARRAY['limbo']); EXCEPTION WHEN OTHERS THEN invalid:=true; END;
 IF NOT invalid THEN RAISE EXCEPTION 'Included game accepted as extra'; END IF;
 invalid:=false; BEGIN PERFORM public.quote_booking_v4('package','mini_golf_3','{}',3,ARRAY['giant_snakes_and_ladders']); EXCEPTION WHEN OTHERS THEN invalid:=true; END;
 IF NOT invalid THEN RAISE EXCEPTION 'Unavailable game accepted'; END IF;
 invalid:=false; BEGIN PERFORM public.quote_booking_v4('build_your_own',NULL,ARRAY['limbo'],0,'{}'); EXCEPTION WHEN OTHERS THEN invalid:=true; END;
 IF NOT invalid THEN RAISE EXCEPTION 'BYO below minimum accepted'; END IF;
 -- Pick a configured postcode with a travel fee, to prove it is not discounted.
 SELECT p.fee::numeric INTO fee FROM public.postcode_districts p WHERE district='B1';
 IF fee IS NULL OR fee<=0 THEN RAISE EXCEPTION 'Test postcode needs nonzero travel'; END IF;
 b:=public.create_booking_v3(jsonb_build_object('customer',jsonb_build_object('first_name','Integration','last_name','Test','email','otgg-extras-test@example.invalid'),'venue',jsonb_build_object('venue_name','Rollback test venue','postcode','B1 1AA'),'booking',jsonb_build_object('event_date',test_date,'selection_type','package','package_code','mini_golf_3','game_codes','[]'::jsonb,'extra_game_codes','["cornhole","limbo"]'::jsonb,'mini_golf_holes',3,'promo_code','OCT50','setup_preference','unsure')));
 IF (b->>'subtotal')::numeric<>575 OR (b->>'total_price')::numeric<>287.5+fee THEN RAISE EXCEPTION 'Saved booking price mismatch: %',b; END IF;
 IF (SELECT count(*) FROM public.booking_items WHERE booking_id=(b->>'booking_id')::uuid AND pricing_type='charged' AND total_price IN (50,125))<>2 THEN RAISE EXCEPTION 'Extra line items not charged'; END IF;
 IF (SELECT sum(total_price) FROM public.booking_items WHERE booking_id=(b->>'booking_id')::uuid)<>175 THEN RAISE EXCEPTION 'Extra line prices mismatch'; END IF;
 -- Existing callers (no extras) retain their original behaviour.
 q:=public.quote_booking_v3('package','mini_golf_3','{}',3);
 IF (q->>'subtotal')::numeric<>400 THEN RAISE EXCEPTION 'Legacy quote regression'; END IF;
END;
$test$;
ROLLBACK;
