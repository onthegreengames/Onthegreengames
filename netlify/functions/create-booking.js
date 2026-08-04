// Netlify Function: netlify/functions/create-booking.js
//
// Required Netlify environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Never put SUPABASE_SERVICE_ROLE_KEY in an HTML file or frontend JavaScript.

const PACKAGES = {
  par:    { label: 'Par',     price: 550, games: 3, golf: true  },
  birdie: { label: 'Birdie',  price: 650, games: 5, golf: true  },
  eagle:  { label: 'Eagle',   price: 750, games: 7, golf: true  },
  games3: { label: '3 Games', price: 200, games: 3, golf: false },
  games5: { label: '5 Games', price: 325, games: 5, golf: false },
  games7: { label: '7 Games', price: 400, games: 7, golf: false }
};

const ALLOWED_GAMES = new Set([
  'Giant Jenga',
  'Giant Connect 4',
  'Giant Snakes & Ladders',
  'Giant Noughts & Crosses',
  'Cornhole',
  'Giant Dominoes',
  'Limbo'
]);

const CUSTOM_GOLF_PRICE = 400;
const CUSTOM_GAME_PRICE = 70;
const EVENT_HOST_PRICE = 400;

const POSTCODE_REGEX =
  /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;

// ---------------------------------------------------------------------------
// REPLACE THESE TABLE AND COLUMN PLACEHOLDERS WITH YOUR REAL SUPABASE SCHEMA.
// The postcode table defaults match the names already used by check-date.html.
// ---------------------------------------------------------------------------

const DB = {
  postcodeDistricts: {
    table: 'postcode_districts',
    district: 'district',
    fee: 'fee'
  },

  customers: {
    table: 'YOUR_CUSTOMERS_TABLE',
    id: 'YOUR_CUSTOMER_ID_COLUMN',
    name: 'YOUR_CUSTOMER_NAME_COLUMN',
    email: 'YOUR_CUSTOMER_EMAIL_COLUMN'
  },

  venues: {
    table: 'YOUR_VENUES_TABLE',
    id: 'YOUR_VENUE_ID_COLUMN',
    name: 'YOUR_VENUE_NAME_COLUMN',
    postcode: 'YOUR_VENUE_POSTCODE_COLUMN'
  },

  bookings: {
    table: 'YOUR_BOOKINGS_TABLE',
    id: 'YOUR_BOOKING_ID_COLUMN',
    customerId: 'YOUR_BOOKING_CUSTOMER_ID_COLUMN',
    venueId: 'YOUR_BOOKING_VENUE_ID_COLUMN',
    eventDate: 'YOUR_BOOKING_EVENT_DATE_COLUMN',
    setup: 'YOUR_BOOKING_SETUP_COLUMN',
    notes: 'YOUR_BOOKING_NOTES_COLUMN',
    selectionType: 'YOUR_BOOKING_SELECTION_TYPE_COLUMN',
    packageCode: 'YOUR_BOOKING_PACKAGE_CODE_COLUMN',
    packageName: 'YOUR_BOOKING_PACKAGE_NAME_COLUMN',
    includesMiniGolf: 'YOUR_BOOKING_INCLUDES_MINI_GOLF_COLUMN',
    eventHost: 'YOUR_BOOKING_EVENT_HOST_COLUMN',
    travelFee: 'YOUR_BOOKING_TRAVEL_FEE_COLUMN',
    total: 'YOUR_BOOKING_TOTAL_COLUMN',
    depositDue: 'YOUR_BOOKING_DEPOSIT_DUE_COLUMN',
    status: 'YOUR_BOOKING_STATUS_COLUMN'
  },

  items: {
    table: 'YOUR_BOOKING_ITEMS_TABLE',
    bookingId: 'YOUR_ITEM_BOOKING_ID_COLUMN',
    type: 'YOUR_ITEM_TYPE_COLUMN',
    name: 'YOUR_ITEM_NAME_COLUMN',
    quantity: 'YOUR_ITEM_QUANTITY_COLUMN',
    unitPrice: 'YOUR_ITEM_UNIT_PRICE_COLUMN',
    lineTotal: 'YOUR_ITEM_LINE_TOTAL_COLUMN'
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

function isPlaceholder(value) {
  return (
    typeof value === 'string' &&
    value.startsWith('YOUR_')
  );
}

function assertMappingsReady() {
  const missing = [];

  for (const [sectionName, section] of Object.entries(DB)) {
    for (const [fieldName, value] of Object.entries(section)) {
      if (isPlaceholder(value)) {
        missing.push(`${sectionName}.${fieldName}`);
      }
    }
  }

  if (missing.length) {
    throw new Error(
      `Complete the Supabase placeholders: ${missing.join(', ')}`
    );
  }
}

function extractDistrict(postcode) {
  const match = String(postcode || '')
    .trim()
    .toUpperCase()
    .match(POSTCODE_REGEX);

  return match ? match[1] : null;
}

function normaliseRequest(body) {
  const customer = body?.customer || {};
  const venue = body?.venue || {};
  const booking = body?.booking || {};

  const name = String(customer.name || '').trim();

  const email = String(customer.email || '')
    .trim()
    .toLowerCase();

  const venueName = String(venue.name || '').trim();

  const postcode = String(venue.postcode || '')
    .trim()
    .toUpperCase();

  const eventDate = String(venue.eventDate || '').trim();

  const selectionType = String(
    booking.selectionType || ''
  );

  const packageCode = booking.packageCode
    ? String(booking.packageCode)
    : null;

  const selectedGames = Array.isArray(
    booking.selectedGames
  )
    ? [
        ...new Set(
          booking.selectedGames.map(String)
        )
      ]
    : [];

  const setup = String(
    booking.setup || 'unsure'
  );

  const notes = booking.notes
    ? String(booking.notes)
        .trim()
        .slice(0, 3000)
    : null;

  const eventHost = Boolean(
    booking.eventHost
  );

  const includesMiniGolf = Boolean(
    booking.includesMiniGolf
  );

  if (
    !name ||
    !email ||
    !/^\S+@\S+\.\S+$/.test(email)
  ) {
    throw new Error(
      'A valid customer name and email address are required.'
    );
  }

  if (
    !venueName ||
    !extractDistrict(postcode) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)
  ) {
    throw new Error(
      'A valid venue, UK postcode and event date are required.'
    );
  }

  if (
    !['outdoor', 'indoor', 'unsure'].includes(setup)
  ) {
    throw new Error(
      'The setup preference is invalid.'
    );
  }

  if (
    selectedGames.some(
      game => !ALLOWED_GAMES.has(game)
    )
  ) {
    throw new Error(
      'One or more selected games are invalid.'
    );
  }

  return {
    customer: {
      name,
      email
    },

    venue: {
      name: venueName,
      postcode,
      eventDate
    },

    booking: {
      selectionType,
      packageCode,
      selectedGames,
      setup,
      notes,
      eventHost,
      includesMiniGolf
    }
  };
}

function calculateSelection(booking) {
  let packageName = null;
  let includesMiniGolf = false;
  let subtotal = 0;

  const items = [];

  if (booking.selectionType === 'package') {
    const pkg = PACKAGES[booking.packageCode];

    if (!pkg) {
      throw new Error(
        'The selected package is invalid.'
      );
    }

    if (
      booking.selectedGames.length !== pkg.games
    ) {
      throw new Error(
        `The ${pkg.label} package requires exactly ${pkg.games} selected games.`
      );
    }

    packageName = pkg.label;
    includesMiniGolf = pkg.golf;
    subtotal = pkg.price;

    items.push({
      type: 'package',
      name: pkg.label,
      quantity: 1,
      unitPrice: pkg.price
    });

    booking.selectedGames.forEach(name => {
      items.push({
        type: 'included_game',
        name,
        quantity: 1,
        unitPrice: 0
      });
    });
  } else if (
    booking.selectionType === 'build_your_own'
  ) {
    includesMiniGolf =
      booking.includesMiniGolf;

    if (
      !includesMiniGolf &&
      booking.selectedGames.length === 0
    ) {
      throw new Error(
        'Choose mini golf or at least one giant game.'
      );
    }

    if (includesMiniGolf) {
      subtotal += CUSTOM_GOLF_PRICE;

      items.push({
        type: 'mini_golf',
        name: '9-hole mini golf',
        quantity: 1,
        unitPrice: CUSTOM_GOLF_PRICE
      });
    }

    booking.selectedGames.forEach(name => {
      subtotal += CUSTOM_GAME_PRICE;

      items.push({
        type: 'giant_game',
        name,
        quantity: 1,
        unitPrice: CUSTOM_GAME_PRICE
      });
    });
  } else {
    throw new Error(
      'The booking selection type is invalid.'
    );
  }

  if (booking.eventHost) {
    if (!includesMiniGolf) {
      throw new Error(
        'An Event Host requires mini golf.'
      );
    }

    subtotal += EVENT_HOST_PRICE;

    items.push({
      type: 'event_host',
      name: 'Event Host',
      quantity: 1,
      unitPrice: EVENT_HOST_PRICE
    });
  }

  return {
    packageName,
    includesMiniGolf,
    subtotal,
    items
  };
}

async function supabase(path, options = {}) {
  const baseUrl =
    process.env.SUPABASE_URL;

  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!baseUrl || !serviceKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Netlify environment variables.'
    );
  }

  const response = await fetch(
    `${baseUrl}/rest/v1/${path}`,
    {
      method: options.method || 'GET',

      headers: {
        apikey: serviceKey,

        Authorization:
          `Bearer ${serviceKey}`,

        'Content-Type':
          'application/json',

        ...(options.prefer
          ? { Prefer: options.prefer }
          : {})
      },

      ...(options.body === undefined
        ? {}
        : {
            body: JSON.stringify(
              options.body
            )
          })
    }
  );

  const text = await response.text();

  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail =
      typeof data === 'string'
        ? data
        : JSON.stringify(data);

    throw new Error(
      `Supabase request failed (${response.status}): ${detail}`
    );
  }

  return data;
}

async function getTravelFee(postcode) {
  const district =
    extractDistrict(postcode);

  const path =
    `${DB.postcodeDistricts.table}` +
    `?${DB.postcodeDistricts.district}` +
    `=eq.${encodeURIComponent(district)}` +
    `&select=${encodeURIComponent(
      DB.postcodeDistricts.fee
    )}` +
    '&limit=1';

  const rows = await supabase(path);

  if (
    !Array.isArray(rows) ||
    rows.length === 0
  ) {
    throw new Error(
      'We do not currently have a travel price for that postcode.'
    );
  }

  return Math.round(
    Number(
      rows[0][DB.postcodeDistricts.fee] || 0
    )
  );
}

async function assertDateAvailable(eventDate) {
  const path =
    `${DB.bookings.table}` +
    `?${DB.bookings.eventDate}` +
    `=eq.${encodeURIComponent(eventDate)}` +
    `&select=${encodeURIComponent(
      DB.bookings.id
    )}` +
    '&limit=1';

  const rows = await supabase(path);

  if (
    Array.isArray(rows) &&
    rows.length
  ) {
    const error = new Error(
      'That date has just become unavailable. Please choose another date.'
    );

    error.statusCode = 409;

    throw error;
  }
}

async function insertAndReturn(
  table,
  payload,
  idColumn
) {
  const rows = await supabase(
    `${table}?select=${encodeURIComponent(
      idColumn
    )}`,
    {
      method: 'POST',
      prefer: 'return=representation',
      body: payload
    }
  );

  if (
    !Array.isArray(rows) ||
    !rows.length ||
    rows[0][idColumn] === undefined
  ) {
    throw new Error(
      `Supabase did not return ${idColumn} from ${table}.`
    );
  }

  return rows[0];
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, {
      error: 'Method not allowed.'
    });
  }

  try {
    assertMappingsReady();

    let parsed;

    try {
      parsed = JSON.parse(
        event.body || '{}'
      );
    } catch {
      return json(400, {
        error:
          'The request body is not valid JSON.'
      });
    }

    const input =
      normaliseRequest(parsed);

    const selection =
      calculateSelection(input.booking);

    const travelFee =
      await getTravelFee(
        input.venue.postcode
      );

    await assertDateAvailable(
      input.venue.eventDate
    );

    const total =
      selection.subtotal + travelFee;

    const depositDue =
      Math.round(total * 25) / 100;

    const customerRow =
      await insertAndReturn(
        DB.customers.table,
        {
          [DB.customers.name]:
            input.customer.name,

          [DB.customers.email]:
            input.customer.email
        },
        DB.customers.id
      );

    const venueRow =
      await insertAndReturn(
        DB.venues.table,
        {
          [DB.venues.name]:
            input.venue.name,

          [DB.venues.postcode]:
            input.venue.postcode
        },
        DB.venues.id
      );

    const bookingRow =
      await insertAndReturn(
        DB.bookings.table,
        {
          [DB.bookings.customerId]:
            customerRow[
              DB.customers.id
            ],

          [DB.bookings.venueId]:
            venueRow[
              DB.venues.id
            ],

          [DB.bookings.eventDate]:
            input.venue.eventDate,

          [DB.bookings.setup]:
            input.booking.setup,

          [DB.bookings.notes]:
            input.booking.notes,

          [DB.bookings.selectionType]:
            input.booking.selectionType,

          [DB.bookings.packageCode]:
            input.booking.packageCode,

          [DB.bookings.packageName]:
            selection.packageName,

          [DB.bookings.includesMiniGolf]:
            selection.includesMiniGolf,

          [DB.bookings.eventHost]:
            input.booking.eventHost,

          [DB.bookings.travelFee]:
            travelFee,

          [DB.bookings.total]:
            total,

          [DB.bookings.depositDue]:
            depositDue,

          [DB.bookings.status]:
            'awaiting_deposit'
        },
        DB.bookings.id
      );

    const bookingId =
      bookingRow[DB.bookings.id];

    const itemRows = [
      ...selection.items,

      {
        type: 'travel_fee',
        name: 'Travel fee',
        quantity: 1,
        unitPrice: travelFee
      }
    ].map(item => ({
      [DB.items.bookingId]:
        bookingId,

      [DB.items.type]:
        item.type,

      [DB.items.name]:
        item.name,

      [DB.items.quantity]:
        item.quantity,

      [DB.items.unitPrice]:
        item.unitPrice,

      [DB.items.lineTotal]:
        item.quantity *
        item.unitPrice
    }));

    await supabase(
      DB.items.table,
      {
        method: 'POST',
        prefer: 'return=minimal',
        body: itemRows
      }
    );

    return json(201, {
      bookingId,
      total,
      depositDue,
      travelFee,
      status: 'awaiting_deposit'
    });
  } catch (error) {
    console.error(
      'create-booking failed',
      error
    );

    return json(
      error.statusCode || 500,
      {
        error:
          error.message ||
          'The booking could not be saved.'
      }
    );
  }
};
