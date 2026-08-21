// Netlify Function: netlify/functions/create-booking.js
//
// Required Netlify environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// This function does not trust prices or totals from the browser. It resolves
// the chosen products, then calls public.create_booking_v2(p_payload jsonb).
// That wrapper keeps the existing booking validation/pricing flow and also saves
// the optional customer profile fields collected by the expanded booking form.

'use strict';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY_BYTES = 64 * 1024;

const PACKAGES_WITH_MINI_GOLF = new Set(['par', 'birdie', 'eagle']);

// Supports the labels used by the current/older booking-page code.
const PRODUCT_ALIASES = new Map([
  ['mini golf', 'mini_golf'],
  ['9 hole mini golf', 'mini_golf'],
  ['9-hole mini golf', 'mini_golf'],
  ['giant jenga', 'giant_jenga'],
  ['connect 4', 'giant_connect_4'],
  ['connect four', 'giant_connect_4'],
  ['giant connect 4', 'giant_connect_4'],
  ['giant connect four', 'giant_connect_4'],
  ['snakes & ladders', 'giant_snakes_and_ladders'],
  ['snakes and ladders', 'giant_snakes_and_ladders'],
  ['giant snakes & ladders', 'giant_snakes_and_ladders'],
  ['giant snakes and ladders', 'giant_snakes_and_ladders'],
  ['noughts & crosses', 'giant_noughts_and_crosses'],
  ['noughts and crosses', 'giant_noughts_and_crosses'],
  ['giant noughts & crosses', 'giant_noughts_and_crosses'],
  ['giant noughts and crosses', 'giant_noughts_and_crosses'],
  ['cornhole', 'cornhole'],
  ['giant dominoes', 'giant_dominoes'],
  ['dominoes', 'giant_dominoes'],
  ['limbo', 'limbo'],
  ['event host', 'event_host']
]);

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function text(value, maxLength = 3000) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;

  const normalised = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalised)) return true;
  if (['false', '0', 'no', 'off'].includes(normalised)) return false;
  return fallback;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function normaliseLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normaliseCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function splitCombinedName(combinedName) {
  const parts = String(combinedName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length < 2) {
    return { firstName: null, lastName: null };
  }

  return {
    firstName: parts.shift(),
    lastName: parts.join(' ')
  };
}

function parseEventBody(event) {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';

  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    const error = new Error('The booking request is too large.');
    error.statusCode = 413;
    throw error;
  }

  try {
    const parsed = JSON.parse(rawBody || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    const error = new Error('The request body is not valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function normaliseInput(body) {
  const customer = body.customer || {};
  const venue = body.venue || {};
  const booking = body.booking || {};

  const fallbackName = splitCombinedName(customer.name);

  const firstName = text(
    firstDefined(customer.first_name, customer.firstName, fallbackName.firstName),
    100
  );

  const lastName = text(
    firstDefined(customer.last_name, customer.lastName, fallbackName.lastName),
    150
  );

  const email = text(customer.email, 320)?.toLowerCase() || null;

  if (!firstName || !lastName) {
    throw new Error('A first name and last name are required.');
  }

  if (!email || !EMAIL_REGEX.test(email)) {
    throw new Error('A valid email address is required.');
  }

  const venueName = text(
    firstDefined(venue.venue_name, venue.venueName, venue.name),
    200
  );

  const postcode = text(venue.postcode, 20)?.toUpperCase() || null;

  const eventDate = text(
    firstDefined(booking.event_date, booking.eventDate, venue.eventDate),
    10
  );

  if (!venueName) {
    throw new Error('A venue name is required.');
  }

  if (!postcode) {
    throw new Error('A venue postcode is required.');
  }

  if (!eventDate || !DATE_REGEX.test(eventDate)) {
    throw new Error('The event date must use YYYY-MM-DD format.');
  }

  const selectionType = normaliseLabel(
    firstDefined(booking.selection_type, booking.selectionType)
  ).replace(/\s+/g, '_');

  if (!['package', 'build_your_own'].includes(selectionType)) {
    throw new Error('Choose a package or build your own selection.');
  }

  const packageCode = text(
    firstDefined(booking.package_code, booking.packageCode),
    50
  )?.toLowerCase() || null;

  if (selectionType === 'package' && !packageCode) {
    throw new Error('A package must be selected.');
  }

  const setupPreference = normaliseLabel(
    firstDefined(
      booking.setup_preference,
      booking.setupPreference,
      booking.setup,
      'unsure'
    )
  ).replace(/\s+/g, '_');

  if (!['outdoor', 'indoor', 'unsure'].includes(setupPreference)) {
    throw new Error(
      'The setup preference must be outdoor, indoor or unsure.'
    );
  }

  return {
    customer: {
      first_name: firstName,
      last_name: lastName,
      email,
      phone: text(customer.phone, 50),

      address_line_1: text(
        firstDefined(
          customer.address_line_1,
          customer.addressLine1
        ),
        250
      ),

      address_line_2: text(
        firstDefined(
          customer.address_line_2,
          customer.addressLine2
        ),
        250
      ),

      town_city: text(
        firstDefined(
          customer.town_city,
          customer.townCity
        ),
        150
      ),

      county: text(
        customer.county,
        150
      ),

      postcode:
        text(
          customer.postcode,
          20
        )?.toUpperCase() || null,

      preferred_contact_method: (() => {
        const value = normaliseLabel(
          firstDefined(
            customer.preferred_contact_method,
            customer.preferredContactMethod
          )
        ).replace(/\s+/g, '_');

        if (!value) {
          return null;
        }

        if (!['email', 'phone'].includes(value)) {
          throw new Error(
            'The preferred contact method must be email or phone.'
          );
        }

        return value;
      })(),

      marketing_opt_in: booleanValue(
        firstDefined(
          customer.marketing_opt_in,
          customer.marketingOptIn
        ),
        false
      )
    },

    venue: {
      venue_name: venueName,

      address_line_1: text(
        firstDefined(
          venue.address_line_1,
          venue.addressLine1
        ),
        250
      ),

      address_line_2: text(
        firstDefined(
          venue.address_line_2,
          venue.addressLine2
        ),
        250
      ),

      town_city: text(
        firstDefined(
          venue.town_city,
          venue.townCity
        ),
        150
      ),

      county: text(
        venue.county,
        150
      ),

      postcode,

      contact_name: text(
        firstDefined(
          venue.contact_name,
          venue.contactName
        ),
        200
      )
    },

    booking: {
      event_date: eventDate,
      selection_type: selectionType,

      package_code:
        selectionType === 'package'
          ? packageCode
          : null,

      setup_preference: setupPreference,

      delivery_time: text(
        firstDefined(
          booking.delivery_time,
          booking.deliveryTime
        ),
        20
      ),

      collection_time: text(
        firstDefined(
          booking.collection_time,
          booking.collectionTime
        ),
        20
      ),

      guest_count: firstDefined(
        booking.guest_count,
        booking.guestCount
      ),

      customer_notes: text(
        firstDefined(
          booking.customer_notes,
          booking.customerNotes,
          booking.notes
        ),
        3000
      ),

      setup_notes: text(
        firstDefined(
          booking.setup_notes,
          booking.setupNotes
        ),
        3000
      ),

      weather_contingency: text(
        firstDefined(
          booking.weather_contingency,
          booking.weatherContingency
        ),
        3000
      ),

      special_requests: text(
        firstDefined(
          booking.special_requests,
          booking.specialRequests
        ),
        3000
      ),

      source:
        text(
          booking.source,
          50
        )?.toLowerCase() || 'website',

      requested_product_ids: arrayValue(
        firstDefined(
          booking.selected_product_ids,
          booking.selectedProductIds
        )
      ),

      requested_product_codes: arrayValue(
        firstDefined(
          booking.selected_product_codes,
          booking.selectedProductCodes
        )
      ),

      requested_games: arrayValue(
        booking.selectedGames
      ),

      includes_mini_golf: booleanValue(
        firstDefined(
          booking.includes_mini_golf,
          booking.includesMiniGolf
        ),
        false
      ),

      event_host: booleanValue(
        firstDefined(
          booking.event_host,
          booking.eventHost
        ),
        false
      )
    }
  };
}

function getSupabaseConfig() {
  const baseUrl =
    String(
      process.env.SUPABASE_URL || ''
    ).replace(/\/$/, '');

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;

  if (!baseUrl || !serviceKey) {
    const error = new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Netlify environment variables.'
    );

    error.statusCode = 500;
    throw error;
  }

  return {
    baseUrl,
    serviceKey
  };
}

async function supabaseRequest(
  path,
  options = {}
) {
  const {
    baseUrl,
    serviceKey
  } = getSupabaseConfig();

  const requestOptions = {
    method:
      options.method ||
      'GET',

    headers: {
      apikey:
        serviceKey,

      Authorization:
        `Bearer ${serviceKey}`,

      Accept:
        'application/json',

      'Content-Type':
        'application/json',

      ...(options.headers || {})
    }
  };

  if (options.body !== undefined) {
    requestOptions.body =
      JSON.stringify(
        options.body
      );
  }

  let result;

  try {
    result =
      await fetch(
        `${baseUrl}/rest/v1/${path}`,
        requestOptions
      );
  } catch (cause) {
    const error = new Error(
      'The booking service could not reach Supabase.'
    );

    error.statusCode = 502;
    error.cause = cause;
    throw error;
  }

  const raw =
    await result.text();

  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!result.ok) {
    const message =
      data &&
      typeof data === 'object'
        ? data.message ||
          data.details ||
          data.hint
        : null;

    const error = new Error(
      message ||
      'Supabase rejected the booking request.'
    );

    error.statusCode =
      result.status === 409 ||
      data?.code === '23505' ||
      /date.*unavailable|already.*book/i.test(
        error.message
      )
        ? 409
        : result.status >= 500
          ? 502
          : 400;

    error.supabaseCode =
      data?.code;

    throw error;
  }

  return data;
}

async function getActiveProducts() {
  const rows =
    await supabaseRequest(
      'products?select=id,code,name,category,active&active=eq.true&order=display_order.asc'
    );

  if (!Array.isArray(rows)) {
    throw new Error(
      'Supabase returned an invalid product catalogue.'
    );
  }

  return rows;
}

function resolveProductIds(
  input,
  products
) {
  const byId =
    new Map();

  const byCode =
    new Map();

  const byName =
    new Map();

  for (const product of products) {
    byId.set(
      String(product.id).toLowerCase(),
      product
    );

    byCode.set(
      normaliseCode(product.code),
      product
    );

    byName.set(
      normaliseLabel(product.name),
      product
    );
  }

  const selectedIds =
    new Set();

  const unknownSelections =
    [];

  const addById = value => {
    const id =
      String(value || '')
        .trim()
        .toLowerCase();

    if (
      !UUID_REGEX.test(id) ||
      !byId.has(id)
    ) {
      unknownSelections.push(
        String(value)
      );

      return;
    }

    selectedIds.add(
      byId.get(id).id
    );
  };

  const addByCodeOrName = value => {
    const raw =
      String(value || '')
        .trim();

    if (!raw) {
      return;
    }

    if (UUID_REGEX.test(raw)) {
      addById(raw);
      return;
    }

    const label =
      normaliseLabel(raw);

    const aliasCode =
      PRODUCT_ALIASES.get(
        label
      );

    const product =
      (
        aliasCode
          ? byCode.get(aliasCode)
          : null
      ) ||
      byCode.get(
        normaliseCode(raw)
      ) ||
      byName.get(label);

    if (!product) {
      unknownSelections.push(
        raw
      );

      return;
    }

    selectedIds.add(
      product.id
    );
  };

  input.booking
    .requested_product_ids
    .forEach(addById);

  input.booking
    .requested_product_codes
    .forEach(addByCodeOrName);

  input.booking
    .requested_games
    .forEach(addByCodeOrName);

  const packageIncludesGolf =
    input.booking.selection_type ===
      'package' &&
    PACKAGES_WITH_MINI_GOLF.has(
      input.booking.package_code
    );

  if (
    input.booking.includes_mini_golf ||
    packageIncludesGolf
  ) {
    addByCodeOrName(
      'mini_golf'
    );
  }

  if (
    input.booking.event_host
  ) {
    addByCodeOrName(
      'event_host'
    );
  }

  if (
    unknownSelections.length
  ) {
    throw new Error(
      `One or more selected products are invalid: ${
        [
          ...new Set(
            unknownSelections
          )
        ].join(', ')
      }`
    );
  }

  return [
    ...selectedIds
  ];
}

function buildRpcPayload(
  input,
  selectedProductIds
) {
  return {
    customer:
      input.customer,

    venue:
      input.venue,

    booking: {
      event_date:
        input.booking.event_date,

      selection_type:
        input.booking.selection_type,

      package_code:
        input.booking.package_code,

      selected_product_ids:
        selectedProductIds,

      setup_preference:
        input.booking.setup_preference,

      delivery_time:
        input.booking.delivery_time,

      collection_time:
        input.booking.collection_time,

      guest_count:
        input.booking.guest_count,

      customer_notes:
        input.booking.customer_notes,

      setup_notes:
        input.booking.setup_notes,

      weather_contingency:
        input.booking.weather_contingency,

      special_requests:
        input.booking.special_requests,

      source:
        input.booking.source
    }
  };
}

exports.handler =
  async function handler(event) {

  if (
    event.httpMethod === 'OPTIONS'
  ) {
    return response(
      204,
      {}
    );
  }

  if (
    event.httpMethod !== 'POST'
  ) {
    return response(
      405,
      {
        error:
          'Method not allowed.'
      }
    );
  }

  try {
    const body =
      parseEventBody(
        event
      );

    const input =
      normaliseInput(
        body
      );

    const products =
      await getActiveProducts();

    const selectedProductIds =
      resolveProductIds(
        input,
        products
      );

    const payload =
      buildRpcPayload(
        input,
        selectedProductIds
      );

    const result =
      await supabaseRequest(
        'rpc/create_booking_v2',
        {
          method:'POST',

          body:{
            p_payload:
              payload
          }
        }
      );

    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result)
    ) {
      throw new Error(
        'Supabase created the booking but returned an invalid response.'
      );
    }

    return response(
      201,
      {
        ...result,

        bookingId:
          result.booking_id,

        bookingReference:
          result.booking_reference,

        travelFee:
          result.travel_fee,

        total:
          result.total_price,

        depositDue:
          result.deposit_required,

        expiresAt:
          result.expires_at
      }
    );

  } catch (error) {

    console.error(
      'create-booking failed',
      {
        message:
          error.message,

        statusCode:
          error.statusCode,

        supabaseCode:
          error.supabaseCode,

        cause:
          error.cause?.message
      }
    );

    return response(
      error.statusCode || 400,
      {
        error:
          error.message ||
          'The booking could not be created.'
      }
    );
  }
};
