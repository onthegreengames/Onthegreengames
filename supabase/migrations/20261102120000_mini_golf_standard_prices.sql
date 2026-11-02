-- Apply in coordination with publication of the new website prices.
-- Confirmed booking price snapshots are unchanged.
-- One hole £100, two £200, all three £275 across packages and Build Your Own.
-- November's free-hole promotion is intentionally not included here.

BEGIN;

DO $guard$
BEGIN
  IF (SELECT count(*) FROM private.booking_pricing_settings
      WHERE singleton = true AND mini_golf_hole_price = 200) <> 1 THEN
    RAISE EXCEPTION 'Mini golf unit price has changed since preparation.';
  END IF;
  IF (SELECT count(*) FROM public.products
      WHERE code = 'mini_golf' AND standalone_price = 200) <> 1 THEN
    RAISE EXCEPTION 'Mini golf product price has changed since preparation.';
  END IF;
  IF (SELECT count(*) FROM public.packages
      WHERE code = 'mini_golf_3' AND price = 400) <> 1 THEN
    RAISE EXCEPTION 'Standalone mini golf package price has changed since preparation.';
  END IF;
  IF (SELECT count(*) FROM public.mini_golf_package_addons
      WHERE (hole_count = 1 AND package_addon_price = 150)
         OR (hole_count = 2 AND package_addon_price = 275)
         OR (hole_count = 3 AND package_addon_price = 375)) <> 3 THEN
    RAISE EXCEPTION 'Mini golf add-on prices have changed since preparation.';
  END IF;
END;
$guard$;

UPDATE private.booking_pricing_settings
SET mini_golf_hole_price = 100
WHERE singleton = true;

UPDATE public.products
SET standalone_price = 100
WHERE code = 'mini_golf';

UPDATE public.packages
SET price = 275
WHERE code = 'mini_golf_3';

UPDATE public.mini_golf_package_addons
SET package_addon_price = CASE hole_count
  WHEN 1 THEN 100
  WHEN 2 THEN 200
  WHEN 3 THEN 275
END
WHERE hole_count BETWEEN 1 AND 3;

CREATE OR REPLACE FUNCTION public.quote_booking_v3(p_selection_type text, p_package_code text DEFAULT NULL::text, p_game_codes text[] DEFAULT ARRAY[]::text[], p_mini_golf_holes integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

DECLARE

    v_selection_type text;
    v_package_code text;

    v_games text[] := ARRAY[]::text[];

    v_supplied_game_count integer := 0;
    v_game_count integer := 0;

    v_classic_count integer := 0;
    v_premium_count integer := 0;

    v_mini_golf_holes integer := 0;

    v_settings private.booking_pricing_settings%ROWTYPE;
    v_package public.packages%ROWTYPE;

    v_package_price numeric(10,2) := 0;
    v_games_price numeric(10,2) := 0;
    v_mini_golf_price numeric(10,2) := 0;

    v_subtotal numeric(10,2) := 0;

BEGIN

    /* --------------------------------------------------------
       NORMALISE BASIC INPUT
       -------------------------------------------------------- */

    v_selection_type :=
        lower(
            btrim(
                COALESCE(
                    p_selection_type,
                    ''
                )
            )
        );


    IF v_selection_type NOT IN (
        'package',
        'build_your_own'
    ) THEN

        RAISE EXCEPTION
            'selection_type must be package or build_your_own.';

    END IF;


    v_package_code :=
        NULLIF(
            lower(
                btrim(
                    COALESCE(
                        p_package_code,
                        ''
                    )
                )
            ),
            ''
        );


    v_mini_golf_holes :=
        COALESCE(
            p_mini_golf_holes,
            0
        );


    /* --------------------------------------------------------
       LOAD AUTHORITATIVE PRICING SETTINGS
       -------------------------------------------------------- */

    SELECT *
    INTO v_settings

    FROM private.booking_pricing_settings

    WHERE singleton = true;


    IF NOT FOUND THEN

        RAISE EXCEPTION
            'Booking pricing settings are not configured.';

    END IF;


    IF v_mini_golf_holes < 0
       OR
       v_mini_golf_holes > v_settings.max_mini_golf_holes THEN

        RAISE EXCEPTION
            'Mini golf hole count must be between 0 and %.',
            v_settings.max_mini_golf_holes;

    END IF;


    /* --------------------------------------------------------
       NORMALISE GAME CODES
       -------------------------------------------------------- */

    SELECT
        count(*)
    INTO
        v_supplied_game_count

    FROM unnest(
        COALESCE(
            p_game_codes,
            ARRAY[]::text[]
        )
    ) AS supplied(code)

    WHERE NULLIF(
        btrim(code),
        ''
    ) IS NOT NULL;


    SELECT

        COALESCE(
            array_agg(
                DISTINCT lower(btrim(code))
                ORDER BY lower(btrim(code))
            ),
            ARRAY[]::text[]
        )

    INTO v_games

    FROM unnest(
        COALESCE(
            p_game_codes,
            ARRAY[]::text[]
        )
    ) AS supplied(code)

    WHERE NULLIF(
        btrim(code),
        ''
    ) IS NOT NULL;


    v_game_count :=
        cardinality(v_games);


    IF v_game_count <> v_supplied_game_count THEN

        RAISE EXCEPTION
            'The selected games contain duplicates.';

    END IF;


    /* --------------------------------------------------------
       VALIDATE AGAINST THE FINAL 7-GAME CATALOGUE

       Ring Toss is currently inactive intentionally, so Stage 2
       does not require active=true yet.

       Snakes & Ladders is deliberately NOT in this list.
       -------------------------------------------------------- */

    SELECT

        count(*),

        count(*) FILTER (
            WHERE p.game_tier = 'classic'
        ),

        count(*) FILTER (
            WHERE p.game_tier = 'premium'
        )

    INTO
        v_game_count,
        v_classic_count,
        v_premium_count

    FROM public.products p

    WHERE p.category = 'giant_game'

      AND p.code = ANY(v_games)

      AND p.code IN (

          'giant_jenga',
          'wooden_ring_toss',
          'giant_dominoes',
          'limbo',

          'giant_connect_4',
          'giant_noughts_and_crosses',
          'cornhole'

      );


    IF v_game_count <> cardinality(v_games) THEN

        RAISE EXCEPTION
            'One or more selected games are not part of the current On The Green Games catalogue.';

    END IF;


    /* ========================================================
       PACKAGE BOOKINGS
       ======================================================== */

    IF v_selection_type = 'package' THEN


        IF v_package_code IS NULL THEN

            RAISE EXCEPTION
                'A package_code is required for a package booking.';

        END IF;


        /* Only the NEW package model is valid in v3. */

        SELECT *
        INTO v_package

        FROM public.packages

        WHERE code = v_package_code

          AND code IN (
              'classic_collection',
              'the_mix',
              'premium_collection',
              'complete_collection',
              'mini_golf_3'
          );


        IF NOT FOUND THEN

            RAISE EXCEPTION
                'The selected v3 package does not exist.';

        END IF;


        /* ----------------------------------------------------
           STANDALONE 3-HOLE MINI GOLF — £275
           ---------------------------------------------------- */

        IF v_package.code = 'mini_golf_3' THEN


            IF cardinality(v_games) <> 0 THEN

                RAISE EXCEPTION
                    'The 3-Hole Mini Golf package cannot contain giant games.';

            END IF;


            IF v_mini_golf_holes <> 3 THEN

                RAISE EXCEPTION
                    'The 3-Hole Mini Golf package requires exactly 3 mini golf holes.';

            END IF;


            v_package_price :=
                v_package.price;

            v_games_price := 0;

            v_mini_golf_price := 0;

            v_subtotal :=
                v_package.price;


        ELSE


            /* ------------------------------------------------
               GAMES PACKAGE COMPOSITION
               ------------------------------------------------ */

            IF v_premium_count <>
               v_package.included_premium_count THEN

                RAISE EXCEPTION
                    'The % package requires exactly % Premium games.',
                    v_package.name,
                    v_package.included_premium_count;

            END IF;


            IF v_classic_count <>
               v_package.included_classic_count THEN

                RAISE EXCEPTION
                    'The % package requires exactly % Classic games.',
                    v_package.name,
                    v_package.included_classic_count;

            END IF;


            IF cardinality(v_games) <>
               v_package.included_game_count THEN

                RAISE EXCEPTION
                    'The % package requires exactly % games.',
                    v_package.name,
                    v_package.included_game_count;

            END IF;


            v_package_price :=
                v_package.price;


            /* ------------------------------------------------
               OPTIONAL PACKAGE MINI-GOLF ADDON

               0 holes = £0
               1 hole  = £100
               2 holes = £200
               3 holes = £275
               ------------------------------------------------ */

            IF v_mini_golf_holes > 0 THEN


                IF NOT v_package.allows_mini_golf_addon THEN

                    RAISE EXCEPTION
                        'Mini golf cannot be added to the % package.',
                        v_package.name;

                END IF;


                SELECT
                    mga.package_addon_price

                INTO
                    v_mini_golf_price

                FROM public.mini_golf_package_addons mga

                WHERE mga.hole_count =
                      v_mini_golf_holes

                  AND mga.active = true;


                IF NOT FOUND THEN

                    RAISE EXCEPTION
                        'No mini golf package price is configured for % holes.',
                        v_mini_golf_holes;

                END IF;


            ELSE

                v_mini_golf_price := 0;

            END IF;


            v_games_price := 0;


            v_subtotal :=
                round(
                    v_package_price +
                    v_mini_golf_price,
                    2
                );


        END IF;


    /* ========================================================
       BUILD YOUR OWN
       ======================================================== */

    ELSE


        IF v_package_code IS NOT NULL THEN

            RAISE EXCEPTION
                'package_code must be empty for Build Your Own bookings.';

        END IF;


        IF cardinality(v_games) = 0
           AND
           v_mini_golf_holes = 0 THEN

            RAISE EXCEPTION
                'Choose at least one game or mini golf hole.';

        END IF;


        /* Classic = £50 each
           Premium = £125 each */

        v_games_price :=
            round(
                (
                    v_classic_count *
                    v_settings.classic_game_price
                )
                +
                (
                    v_premium_count *
                    v_settings.premium_game_price
                ),
                2
            );


        /* Mini golf = £100 per hole, or £275 for all 3.

           1 hole = £100
           2 holes = £200
           3 holes = £275
        */

        v_mini_golf_price :=
            CASE
                WHEN v_mini_golf_holes = 3 THEN
                    (SELECT price FROM public.packages WHERE code = 'mini_golf_3')
                ELSE
                    round(v_mini_golf_holes * v_settings.mini_golf_hole_price, 2)
            END;


        v_subtotal :=
            round(
                v_games_price +
                v_mini_golf_price,
                2
            );


        IF v_subtotal <
           v_settings.build_your_own_minimum THEN

            RAISE EXCEPTION
                'Build Your Own bookings have a minimum order value of £%.',
                to_char(
                    v_settings.build_your_own_minimum,
                    'FM999999990.00'
                );

        END IF;


    END IF;


    /* ========================================================
       RESULT
       ======================================================== */

    RETURN jsonb_build_object(

        'selection_type',
            v_selection_type,

        'package_code',
            v_package_code,

        'game_codes',
            to_jsonb(v_games),

        'game_count',
            cardinality(v_games),

        'classic_game_count',
            v_classic_count,

        'premium_game_count',
            v_premium_count,

        'mini_golf_holes',
            v_mini_golf_holes,

        'package_price',
            round(v_package_price, 2),

        'games_price',
            round(v_games_price, 2),

        'mini_golf_price',
            round(v_mini_golf_price, 2),

        'subtotal',
            round(v_subtotal, 2),

        'build_your_own_minimum',
            v_settings.build_your_own_minimum

    );

END;

$function$;

COMMIT;
