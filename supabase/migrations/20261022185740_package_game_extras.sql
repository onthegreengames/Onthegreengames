-- Extend the existing quote without changing the v3 contract used by older clients.
CREATE OR REPLACE FUNCTION public.quote_booking_v4(
 p_selection_type text, p_package_code text DEFAULT NULL,
 p_game_codes text[] DEFAULT ARRAY[]::text[], p_mini_golf_holes integer DEFAULT 0,
 p_extra_game_codes text[] DEFAULT ARRAY[]::text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
 v_quote jsonb;
 v_extras text[];
 v_extra_price numeric(10,2) := 0;
 v_count integer;
BEGIN
 v_quote := public.quote_booking_v3(p_selection_type,p_package_code,p_game_codes,p_mini_golf_holes);
 SELECT coalesce(array_agg(lower(btrim(code))), ARRAY[]::text[]) INTO v_extras
 FROM unnest(coalesce(p_extra_game_codes, ARRAY[]::text[])) AS code;
 IF cardinality(v_extras) > 7 OR EXISTS (SELECT 1 FROM unnest(v_extras) code WHERE code IS NULL OR code = '')
 OR cardinality(v_extras) <> (SELECT count(DISTINCT code) FROM unnest(v_extras) code) THEN
  RAISE EXCEPTION 'Extra games must be distinct, valid game codes.';
 END IF;
 IF cardinality(v_extras) > 0 AND v_quote->>'selection_type' <> 'package' THEN
  RAISE EXCEPTION 'For Build Your Own, include every game in game_codes.';
 END IF;
 IF EXISTS (SELECT 1 FROM unnest(v_extras) code WHERE code IN (SELECT jsonb_array_elements_text(v_quote->'game_codes'))) THEN
  RAISE EXCEPTION 'A game already included in your package cannot also be an extra.';
 END IF;
 SELECT count(*), coalesce(sum(CASE p.game_tier WHEN 'classic' THEN s.classic_game_price WHEN 'premium' THEN s.premium_game_price END),0)
 INTO v_count,v_extra_price
 FROM public.products p CROSS JOIN private.booking_pricing_settings s
 WHERE s.singleton AND p.category='giant_game' AND p.active
 AND p.code=ANY(v_extras) AND p.code IN ('giant_jenga','wooden_ring_toss','giant_dominoes','limbo','giant_connect_4','giant_noughts_and_crosses','cornhole');
 IF v_count <> cardinality(v_extras) THEN RAISE EXCEPTION 'One or more extra games are unavailable.'; END IF;
 RETURN v_quote || jsonb_build_object('extra_game_codes',to_jsonb(v_extras),'extra_games_price',v_extra_price,
 'subtotal',round((v_quote->>'subtotal')::numeric+v_extra_price,2));
END;
$function$;
REVOKE ALL ON FUNCTION public.quote_booking_v4(text,text,text[],integer,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quote_booking_v4(text,text,text[],integer,text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.quote_promo_code_v2(p_code text, p_selection_type text, p_package_code text DEFAULT NULL::text, p_game_codes text[] DEFAULT ARRAY[]::text[], p_mini_golf_holes integer DEFAULT 0, p_event_date date DEFAULT NULL::date, p_extra_game_codes text[] DEFAULT ARRAY[]::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_quote jsonb;
    v_eval jsonb;
    v_hire_subtotal numeric(10,2);
    v_discount numeric(10,2);
BEGIN
    v_quote :=
        public.quote_booking_v4(
            p_selection_type,
            p_package_code,
            p_game_codes,
            p_mini_golf_holes,
            p_extra_game_codes
        );

    v_hire_subtotal :=
        (v_quote ->> 'subtotal')::numeric(10,2);

    v_eval :=
        private.evaluate_promo_code_v1(
            p_code,
            v_hire_subtotal,
            p_selection_type,
            p_package_code,
            p_event_date,
            false
        );

    v_discount :=
        COALESCE(
            (v_eval ->> 'discount_amount')::numeric,
            0
        );

    RETURN
        v_eval ||
        jsonb_build_object(
            'hire_subtotal', v_hire_subtotal,
            'discounted_hire_subtotal',
                round(
                    greatest(
                        0,
                        v_hire_subtotal -
                        v_discount
                    ),
                    2
                )
        );
END;
$function$;
REVOKE ALL ON FUNCTION public.quote_promo_code_v2(text,text,text,text[],integer,date,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quote_promo_code_v2(text,text,text,text[],integer,date,text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.create_booking_v3(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$

DECLARE

    /* --------------------------------------------------------
       PAYLOAD
       -------------------------------------------------------- */

    v_customer jsonb;
    v_venue jsonb;
    v_booking jsonb;


    /* --------------------------------------------------------
       CUSTOMER
       -------------------------------------------------------- */

    v_first_name text;
    v_last_name text;
    v_email text;
    v_phone text;
    v_marketing_opt_in boolean;

    v_customer_address_line_1 text;
    v_customer_address_line_2 text;
    v_customer_town_city text;
    v_customer_county text;
    v_customer_postcode text;
    v_preferred_contact_method text;


    /* --------------------------------------------------------
       VENUE
       -------------------------------------------------------- */

    v_venue_name text;
    v_venue_address_line_1 text;
    v_venue_address_line_2 text;
    v_venue_town_city text;
    v_venue_county text;
    v_venue_postcode text;
    v_venue_contact_name text;
    v_district text;


    /* --------------------------------------------------------
       BOOKING
       -------------------------------------------------------- */

    v_event_date date;
    v_selection_type text;
    v_package_code text;

    v_game_codes text[] := ARRAY[]::text[];
    v_extra_game_codes text[] := ARRAY[]::text[];
    v_mini_golf_holes integer := 0;

    v_setup_preference text;
    v_delivery_time time;
    v_collection_time time;
    v_guest_count integer;

    v_customer_notes text;
    v_setup_notes text;
    v_weather_contingency text;
    v_special_requests text;
    v_source text;


    /* --------------------------------------------------------
       PRICING / CATALOGUE
       -------------------------------------------------------- */

    v_quote jsonb;

    v_settings private.booking_pricing_settings%ROWTYPE;
    v_package public.packages%ROWTYPE;
    v_mini_golf_product public.products%ROWTYPE;

    v_subtotal numeric(10,2);
    v_travel_fee numeric(10,2);
    v_total_price numeric(10,2);
    v_deposit_required numeric(10,2);

    v_mini_golf_price numeric(10,2);

    v_promo_code text;
    v_promo jsonb;
    v_promo_code_id uuid;
    v_promo_discount_type text;
    v_promo_discount_value numeric(10,2);
    v_promo_discount_amount numeric(10,2) := 0;


    /* --------------------------------------------------------
       CREATED RECORDS
       -------------------------------------------------------- */

    v_customer_id uuid;
    v_venue_id uuid;
    v_booking_id uuid;
    v_booking_reference text;

    v_expires_at timestamptz;

BEGIN

    /* ========================================================
       1. VALIDATE PAYLOAD
       ======================================================== */

    IF p_payload IS NULL
       OR jsonb_typeof(p_payload) <> 'object' THEN

        RAISE EXCEPTION
            'The booking payload must be a JSON object.';

    END IF;


    v_customer :=
        COALESCE(
            p_payload -> 'customer',
            '{}'::jsonb
        );

    v_venue :=
        COALESCE(
            p_payload -> 'venue',
            '{}'::jsonb
        );

    v_booking :=
        COALESCE(
            p_payload -> 'booking',
            '{}'::jsonb
        );


    /* ========================================================
       2. CUSTOMER
       ======================================================== */

    v_first_name :=
        NULLIF(
            btrim(v_customer ->> 'first_name'),
            ''
        );

    v_last_name :=
        NULLIF(
            btrim(v_customer ->> 'last_name'),
            ''
        );

    v_email :=
        NULLIF(
            lower(
                btrim(v_customer ->> 'email')
            ),
            ''
        );

    v_phone :=
        NULLIF(
            btrim(v_customer ->> 'phone'),
            ''
        );


    BEGIN

        v_marketing_opt_in :=
            COALESCE(
                (v_customer ->> 'marketing_opt_in')::boolean,
                false
            );

    EXCEPTION
        WHEN invalid_text_representation THEN

            RAISE EXCEPTION
                'marketing_opt_in must be true or false.';

    END;


    IF v_first_name IS NULL
       OR v_last_name IS NULL THEN

        RAISE EXCEPTION
            'A first name and last name are required.';

    END IF;


    IF v_email IS NULL
       OR v_email !~*
            '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' THEN

        RAISE EXCEPTION
            'A valid email address is required.';

    END IF;


    /* Optional customer address/contact details. */

    v_customer_address_line_1 :=
        NULLIF(
            btrim(v_customer ->> 'address_line_1'),
            ''
        );

    v_customer_address_line_2 :=
        NULLIF(
            btrim(v_customer ->> 'address_line_2'),
            ''
        );

    v_customer_town_city :=
        NULLIF(
            btrim(v_customer ->> 'town_city'),
            ''
        );

    v_customer_county :=
        NULLIF(
            btrim(v_customer ->> 'county'),
            ''
        );

    v_customer_postcode :=
        public.normalise_uk_postcode(
            v_customer ->> 'postcode'
        );

    v_preferred_contact_method :=
        NULLIF(
            lower(
                btrim(
                    v_customer ->> 'preferred_contact_method'
                )
            ),
            ''
        );


    IF v_customer_postcode IS NOT NULL
       AND v_customer_postcode !~
            '^[A-Z0-9]{2,4} [0-9][A-Z]{2}$' THEN

        RAISE EXCEPTION
            'The customer postcode is not valid.';

    END IF;


    IF v_preferred_contact_method IS NOT NULL
       AND v_preferred_contact_method NOT IN (
           'email',
           'phone'
       ) THEN

        RAISE EXCEPTION
            'preferred_contact_method must be email or phone.';

    END IF;


    /* ========================================================
       3. VENUE
       ======================================================== */

    v_venue_name :=
        NULLIF(
            btrim(v_venue ->> 'venue_name'),
            ''
        );

    v_venue_address_line_1 :=
        NULLIF(
            btrim(v_venue ->> 'address_line_1'),
            ''
        );

    v_venue_address_line_2 :=
        NULLIF(
            btrim(v_venue ->> 'address_line_2'),
            ''
        );

    v_venue_town_city :=
        NULLIF(
            btrim(v_venue ->> 'town_city'),
            ''
        );

    v_venue_county :=
        NULLIF(
            btrim(v_venue ->> 'county'),
            ''
        );

    v_venue_postcode :=
        public.normalise_uk_postcode(
            v_venue ->> 'postcode'
        );

    v_venue_contact_name :=
        NULLIF(
            btrim(v_venue ->> 'contact_name'),
            ''
        );


    IF v_venue_name IS NULL THEN

        RAISE EXCEPTION
            'A venue name is required.';

    END IF;


    IF v_venue_postcode IS NULL
       OR v_venue_postcode !~
            '^[A-Z0-9]{2,4} [0-9][A-Z]{2}$' THEN

        RAISE EXCEPTION
            'A valid UK venue postcode is required.';

    END IF;


    v_district :=
        split_part(
            v_venue_postcode,
            ' ',
            1
        );


    /* ========================================================
       4. BOOKING DETAILS
       ======================================================== */

    BEGIN

        v_event_date :=
            NULLIF(
                v_booking ->> 'event_date',
                ''
            )::date;

    EXCEPTION
        WHEN invalid_datetime_format THEN

            RAISE EXCEPTION
                'event_date must use YYYY-MM-DD format.';

    END;


    IF v_event_date IS NULL THEN

        RAISE EXCEPTION
            'An event date is required.';

    END IF;


    IF v_event_date < current_date THEN

        RAISE EXCEPTION
            'The event date cannot be in the past.';

    END IF;


    v_selection_type :=
        NULLIF(
            lower(
                btrim(
                    v_booking ->> 'selection_type'
                )
            ),
            ''
        );


    v_package_code :=
        NULLIF(
            lower(
                btrim(
                    v_booking ->> 'package_code'
                )
            ),
            ''
        );


    IF v_selection_type IS NULL
       OR v_selection_type NOT IN (
           'package',
           'build_your_own'
       ) THEN

        RAISE EXCEPTION
            'selection_type must be package or build_your_own.';

    END IF;


    /* --------------------------------------------------------
       GAME CODES
       -------------------------------------------------------- */

    IF v_booking ? 'game_codes'
       AND jsonb_typeof(v_booking -> 'game_codes') <> 'array' THEN

        RAISE EXCEPTION
            'game_codes must be a JSON array.';

    END IF;


    SELECT
        COALESCE(
            array_agg(value),
            ARRAY[]::text[]
        )

    INTO v_game_codes

    FROM jsonb_array_elements_text(
        COALESCE(
            v_booking -> 'game_codes',
            '[]'::jsonb
        )
    );


    IF v_booking ? 'extra_game_codes' AND jsonb_typeof(v_booking->'extra_game_codes') <> 'array' THEN
        RAISE EXCEPTION 'extra_game_codes must be a JSON array.';
    END IF;
    SELECT coalesce(array_agg(value), ARRAY[]::text[]) INTO v_extra_game_codes
    FROM jsonb_array_elements_text(coalesce(v_booking->'extra_game_codes','[]'::jsonb));

    /* --------------------------------------------------------
       MINI GOLF HOLE COUNT
       -------------------------------------------------------- */

    BEGIN

        v_mini_golf_holes :=
            COALESCE(
                NULLIF(
                    v_booking ->> 'mini_golf_holes',
                    ''
                )::integer,
                0
            );

    EXCEPTION
        WHEN invalid_text_representation THEN

            RAISE EXCEPTION
                'mini_golf_holes must be a whole number.';

    END;


    /* Event Host is intentionally unavailable at launch. */

    IF lower(
        COALESCE(
            v_booking ->> 'event_host',
            'false'
        )
    ) IN (
        'true',
        '1',
        'yes',
        'on'
    ) THEN

        RAISE EXCEPTION
            'Event Host is not currently available.';

    END IF;


    /* --------------------------------------------------------
       OTHER BOOKING DETAILS
       -------------------------------------------------------- */

    v_setup_preference :=
        COALESCE(
            NULLIF(
                lower(
                    btrim(
                        v_booking ->> 'setup_preference'
                    )
                ),
                ''
            ),
            'unsure'
        );


    IF v_setup_preference NOT IN (
        'outdoor',
        'indoor',
        'unsure'
    ) THEN

        RAISE EXCEPTION
            'setup_preference must be outdoor, indoor or unsure.';

    END IF;


    BEGIN

        IF NULLIF(
            v_booking ->> 'delivery_time',
            ''
        ) IS NOT NULL THEN

            v_delivery_time :=
                (v_booking ->> 'delivery_time')::time;

        END IF;


        IF NULLIF(
            v_booking ->> 'collection_time',
            ''
        ) IS NOT NULL THEN

            v_collection_time :=
                (v_booking ->> 'collection_time')::time;

        END IF;

    EXCEPTION
        WHEN invalid_datetime_format THEN

            RAISE EXCEPTION
                'delivery_time and collection_time must be valid times.';

    END;


    BEGIN

        IF NULLIF(
            v_booking ->> 'guest_count',
            ''
        ) IS NOT NULL THEN

            v_guest_count :=
                (v_booking ->> 'guest_count')::integer;

        END IF;

    EXCEPTION
        WHEN invalid_text_representation THEN

            RAISE EXCEPTION
                'guest_count must be a whole number.';

    END;


    IF v_guest_count IS NOT NULL
       AND v_guest_count < 0 THEN

        RAISE EXCEPTION
            'guest_count cannot be negative.';

    END IF;


    v_customer_notes :=
        NULLIF(
            btrim(v_booking ->> 'customer_notes'),
            ''
        );

    v_setup_notes :=
        NULLIF(
            btrim(v_booking ->> 'setup_notes'),
            ''
        );

    v_weather_contingency :=
        NULLIF(
            btrim(v_booking ->> 'weather_contingency'),
            ''
        );

    v_special_requests :=
        NULLIF(
            btrim(v_booking ->> 'special_requests'),
            ''
        );

    v_source :=
        COALESCE(
            NULLIF(
                lower(
                    btrim(
                        v_booking ->> 'source'
                    )
                ),
                ''
            ),
            'website'
        );


    v_promo_code :=
        NULLIF(
            upper(
                btrim(
                    COALESCE(
                        v_booking ->> 'promo_code',
                        ''
                    )
                )
            ),
            ''
        );


    /* ========================================================
       5. AUTHORITATIVE V3 QUOTE + VALIDATION
       ======================================================== */

    v_quote :=
        public.quote_booking_v4(

            v_selection_type,

            v_package_code,

            v_game_codes,

            v_mini_golf_holes,
            v_extra_game_codes

        );


    -- Use canonical codes for both pricing and persisted line items.
    SELECT coalesce(array_agg(value), ARRAY[]::text[]) INTO v_game_codes FROM jsonb_array_elements_text(v_quote->'game_codes');
    SELECT coalesce(array_agg(value), ARRAY[]::text[]) INTO v_extra_game_codes FROM jsonb_array_elements_text(v_quote->'extra_game_codes');

    v_subtotal :=
        (v_quote ->> 'subtotal')::numeric(10,2);


    v_mini_golf_price :=
        (v_quote ->> 'mini_golf_price')::numeric(10,2);


    SELECT *
    INTO v_settings

    FROM private.booking_pricing_settings

    WHERE singleton = true;


    IF NOT FOUND THEN

        RAISE EXCEPTION
            'Booking pricing settings are not configured.';

    END IF;


    /* Package rows are intentionally still inactive during
       staging. quote_booking_v3 has already restricted package
       codes to the new v3 catalogue. */

    IF v_selection_type = 'package' THEN

        SELECT *
        INTO v_package

        FROM public.packages

        WHERE code = v_package_code;


        IF NOT FOUND THEN

            RAISE EXCEPTION
                'The selected package could not be found.';

        END IF;

    END IF;


    /* ========================================================
       6. TRAVEL FEE
       ======================================================== */

    SELECT
        fee::numeric(10,2)

    INTO
        v_travel_fee

    FROM public.postcode_districts

    WHERE district = v_district;


    IF NOT FOUND THEN

        RAISE EXCEPTION
            'No travel fee is configured for postcode district %.',
            v_district;

    END IF;


    /* ========================================================
       7. LOCK EVENT DATE + EXPIRE OLD HOLDS
       ======================================================== */

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'otgg-booking:' ||
            v_event_date::text,
            0
        )
    );


    UPDATE public.bookings

    SET status = 'expired'

    WHERE status = 'awaiting_deposit'

      AND expires_at IS NOT NULL

      AND expires_at <= now();


    IF EXISTS (

        SELECT 1

        FROM public.bookings

        WHERE event_date = v_event_date

          AND status IN (
              'awaiting_deposit',
              'confirmed_part_paid',
              'paid',
              'completed'
          )

    ) THEN

        RAISE EXCEPTION
            'That date has just become unavailable. Please choose another date.'
            USING ERRCODE = '23505';

    END IF;


    /* ========================================================
       7B. PROMO CODE
       Lock the promo row while checking limited-use availability.
       This prevents two concurrent bookings consuming the final use.
       ======================================================== */

    IF v_promo_code IS NOT NULL THEN

        v_promo :=
            private.evaluate_promo_code_v1(
                v_promo_code,
                v_subtotal,
                v_selection_type,
                v_package_code,
                v_event_date,
                true
            );


        IF NOT COALESCE(
            (v_promo ->> 'valid')::boolean,
            false
        ) THEN

            RAISE EXCEPTION
                '%',
                COALESCE(
                    v_promo ->> 'message',
                    'That promo code is not available for this booking.'
                );

        END IF;


        v_promo_code :=
            v_promo ->> 'code';

        v_promo_code_id :=
            (v_promo ->> 'promo_code_id')::uuid;

        v_promo_discount_type :=
            v_promo ->> 'discount_type';

        v_promo_discount_value :=
            (v_promo ->> 'discount_value')::numeric(10,2);

        v_promo_discount_amount :=
            (v_promo ->> 'discount_amount')::numeric(10,2);

    END IF;


    /* ========================================================
       8. CUSTOMER
       ======================================================== */

    INSERT INTO public.customers AS existing_customer (

        first_name,
        last_name,
        email,
        phone,

        address_line_1,
        address_line_2,
        town_city,
        county,
        postcode,

        marketing_opt_in,
        preferred_contact_method

    )

    VALUES (

        v_first_name,
        v_last_name,
        v_email,
        v_phone,

        v_customer_address_line_1,
        v_customer_address_line_2,
        v_customer_town_city,
        v_customer_county,
        v_customer_postcode,

        v_marketing_opt_in,
        v_preferred_contact_method

    )

    ON CONFLICT ((lower(email)))

    DO UPDATE

    SET

        first_name =
            EXCLUDED.first_name,

        last_name =
            EXCLUDED.last_name,

        phone =
            COALESCE(
                EXCLUDED.phone,
                existing_customer.phone
            ),

        address_line_1 =
            COALESCE(
                EXCLUDED.address_line_1,
                existing_customer.address_line_1
            ),

        address_line_2 =
            COALESCE(
                EXCLUDED.address_line_2,
                existing_customer.address_line_2
            ),

        town_city =
            COALESCE(
                EXCLUDED.town_city,
                existing_customer.town_city
            ),

        county =
            COALESCE(
                EXCLUDED.county,
                existing_customer.county
            ),

        postcode =
            COALESCE(
                EXCLUDED.postcode,
                existing_customer.postcode
            ),

        marketing_opt_in =
            EXCLUDED.marketing_opt_in,

        preferred_contact_method =
            COALESCE(
                EXCLUDED.preferred_contact_method,
                existing_customer.preferred_contact_method
            )

    RETURNING id
    INTO v_customer_id;


    /* ========================================================
       9. VENUE
       ======================================================== */

    INSERT INTO public.venues (

        venue_name,
        address_line_1,
        address_line_2,
        town_city,
        county,
        postcode,
        contact_name

    )

    VALUES (

        v_venue_name,
        v_venue_address_line_1,
        v_venue_address_line_2,
        v_venue_town_city,
        v_venue_county,
        v_venue_postcode,
        v_venue_contact_name

    )

    RETURNING id
    INTO v_venue_id;


    /* ========================================================
       10. BOOKING REFERENCE
       ======================================================== */

    LOOP

        v_booking_reference :=

            'OTGG-'

            || to_char(
                v_event_date,
                'YYMMDD'
            )

            || '-'

            || upper(
                left(
                    replace(
                        gen_random_uuid()::text,
                        '-',
                        ''
                    ),
                    6
                )
            );


        EXIT WHEN NOT EXISTS (

            SELECT 1

            FROM public.bookings

            WHERE booking_reference =
                  v_booking_reference

        );

    END LOOP;


    /* ========================================================
       11. FINANCIAL TOTALS
       ======================================================== */

    v_total_price :=
        round(
            greatest(
                0,
                v_subtotal -
                v_promo_discount_amount
            ) +
            v_travel_fee,
            2
        );


    v_deposit_required :=
        round(
            v_total_price * 0.25,
            2
        );


    v_expires_at :=
        now() + interval '30 minutes';


    /* ========================================================
       12. CREATE BOOKING
       ======================================================== */

    INSERT INTO public.bookings (

        booking_reference,
        customer_id,
        venue_id,

        event_date,
        delivery_time,
        collection_time,
        guest_count,

        status,

        total_price,
        deposit_required,

        source,

        customer_notes,
        setup_notes,
        weather_contingency,
        special_requests,

        selection_type,
        package_id,

        setup_preference,

        subtotal,
        travel_fee,

        promo_code_id,
        promo_code,
        promo_discount_type,
        promo_discount_value,
        promo_discount_amount,

        expires_at

    )

    VALUES (

        v_booking_reference,
        v_customer_id,
        v_venue_id,

        v_event_date,
        v_delivery_time,
        v_collection_time,
        v_guest_count,

        'awaiting_deposit',

        v_total_price,
        v_deposit_required,

        v_source,

        v_customer_notes,
        v_setup_notes,
        v_weather_contingency,
        v_special_requests,

        v_selection_type,

        CASE
            WHEN v_selection_type = 'package'
                THEN v_package.id
            ELSE NULL
        END,

        v_setup_preference,

        v_subtotal,
        v_travel_fee,

        v_promo_code_id,
        v_promo_code,
        v_promo_discount_type,
        v_promo_discount_value,
        v_promo_discount_amount,

        v_expires_at

    )

    RETURNING id
    INTO v_booking_id;


    /* ========================================================
       13. GAME BOOKING ITEMS
       ======================================================== */

    IF cardinality(v_game_codes || v_extra_game_codes) > 0 THEN

        INSERT INTO public.booking_items (

            booking_id,
            product_id,

            quantity,

            unit_price,
            total_price,

            pricing_type,

            product_name_snapshot

        )

        SELECT

            v_booking_id,
            p.id,

            1,

            CASE

                WHEN v_selection_type = 'package' AND p.code = ANY(v_game_codes)
                    THEN 0

                WHEN p.game_tier = 'classic'
                    THEN v_settings.classic_game_price

                WHEN p.game_tier = 'premium'
                    THEN v_settings.premium_game_price

            END,

            CASE

                WHEN v_selection_type = 'package' AND p.code = ANY(v_game_codes)
                    THEN 0

                WHEN p.game_tier = 'classic'
                    THEN v_settings.classic_game_price

                WHEN p.game_tier = 'premium'
                    THEN v_settings.premium_game_price

            END,

            CASE

                WHEN v_selection_type = 'package' AND p.code = ANY(v_game_codes)
                    THEN 'included'

                ELSE 'charged'

            END,

            p.name

        FROM public.products p

        WHERE p.code = ANY(v_game_codes || v_extra_game_codes)

          AND p.category = 'giant_game';

    END IF;


    /* ========================================================
       14. MINI GOLF BOOKING ITEM
       ======================================================== */

    IF v_mini_golf_holes > 0 THEN


        SELECT *
        INTO v_mini_golf_product

        FROM public.products

        WHERE code = 'mini_golf';


        IF NOT FOUND THEN

            RAISE EXCEPTION
                'The mini golf product could not be found.';

        END IF;


        /* ----------------------------------------------------
           Standalone £400 3-hole package
           ---------------------------------------------------- */

        IF v_selection_type = 'package'
           AND v_package_code = 'mini_golf_3' THEN


            INSERT INTO public.booking_items (

                booking_id,
                product_id,
                quantity,

                unit_price,
                total_price,

                pricing_type,

                product_name_snapshot

            )

            VALUES (

                v_booking_id,
                v_mini_golf_product.id,
                3,

                0,
                0,

                'included',

                'Mini Golf Hole'

            );


        /* ----------------------------------------------------
           Games package + golf upgrade
           ---------------------------------------------------- */

        ELSIF v_selection_type = 'package' THEN


            INSERT INTO public.booking_items (

                booking_id,
                product_id,
                quantity,

                unit_price,
                total_price,

                pricing_type,

                product_name_snapshot

            )

            VALUES (

                v_booking_id,
                v_mini_golf_product.id,
                v_mini_golf_holes,

                round(
                    v_mini_golf_price /
                    v_mini_golf_holes,
                    2
                ),

                v_mini_golf_price,

                'charged',

                'Mini Golf Hole'

            );


        /* ----------------------------------------------------
           Build Your Own
           £200 per hole
           ---------------------------------------------------- */

        ELSE


            INSERT INTO public.booking_items (

                booking_id,
                product_id,
                quantity,

                unit_price,
                total_price,

                pricing_type,

                product_name_snapshot

            )

            VALUES (

                v_booking_id,
                v_mini_golf_product.id,
                v_mini_golf_holes,

                v_settings.mini_golf_hole_price,

                round(
                    v_settings.mini_golf_hole_price *
                    v_mini_golf_holes,
                    2
                ),

                'charged',

                'Mini Golf Hole'

            );


        END IF;

    END IF;


    /* ========================================================
       15. RETURN RESULT
       ======================================================== */

    RETURN jsonb_build_object(

        'booking_id',
            v_booking_id,

        'booking_reference',
            v_booking_reference,

        'selection_type',
            v_selection_type,

        'package_code',
            v_package_code,

        'game_codes',
            to_jsonb(v_game_codes),

        'mini_golf_holes',
            v_mini_golf_holes,

        'subtotal',
            v_subtotal,

        'travel_fee',
            v_travel_fee,

        'promo_code',
            v_promo_code,

        'promo_discount_type',
            v_promo_discount_type,

        'promo_discount_value',
            v_promo_discount_value,

        'promo_discount_amount',
            v_promo_discount_amount,

        'total_price',
            v_total_price,

        'deposit_required',
            v_deposit_required,

        'status',
            'awaiting_deposit',

        'expires_at',
            v_expires_at

    );


END;

$function$;
