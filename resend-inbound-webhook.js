'use strict';

// Netlify Function:
// netlify/functions/resend-inbound-webhook.js
//
// Receives Resend's email.received webhook,
// retrieves the full inbound email + attachments,
// then forwards it to the Gmail inbox in BOOKINGS_FORWARD_TO.
//
// Required Netlify environment variables:
//   RESEND_INBOUND_API_KEY
//   RESEND_INBOUND_WEBHOOK_SECRET
//   RESEND_FROM_EMAIL
//   BOOKINGS_FORWARD_TO
//
// No npm packages required.

const crypto = require('crypto');

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

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

function getConfig() {
  const apiKey =
    String(
      process.env.RESEND_INBOUND_API_KEY || ''
    ).trim();

  const webhookSecret =
    String(
      process.env.RESEND_INBOUND_WEBHOOK_SECRET || ''
    ).trim();

  const bookingsEmail =
    String(
      process.env.RESEND_FROM_EMAIL || ''
    )
      .trim()
      .toLowerCase();

  const forwardTo =
    String(
      process.env.BOOKINGS_FORWARD_TO || ''
    )
      .trim()
      .toLowerCase();

  if (!apiKey) {
    throw new Error(
      'Missing RESEND_INBOUND_API_KEY.'
    );
  }

  if (!webhookSecret) {
    throw new Error(
      'Missing RESEND_INBOUND_WEBHOOK_SECRET.'
    );
  }

  if (!bookingsEmail) {
    throw new Error(
      'Missing RESEND_FROM_EMAIL.'
    );
  }

  if (!forwardTo) {
    throw new Error(
      'Missing BOOKINGS_FORWARD_TO.'
    );
  }

  return {
    apiKey,
    webhookSecret,
    bookingsEmail,
    forwardTo
  };
}

function getRawBody(event) {
  return event.isBase64Encoded
    ? Buffer
        .from(
          event.body || '',
          'base64'
        )
        .toString('utf8')
    : event.body || '';
}

function getHeader(event, name) {
  const wanted =
    String(name).toLowerCase();

  const headers =
    event.headers || {};

  for (
    const [key, value]
    of Object.entries(headers)
  ) {
    if (
      String(key).toLowerCase() ===
      wanted
    ) {
      return String(value || '');
    }
  }

  return '';
}

function safeEqualBase64(
  supplied,
  expected
) {
  try {
    const left =
      Buffer.from(
        supplied,
        'base64'
      );

    const right =
      Buffer.from(
        expected,
        'base64'
      );

    return (
      left.length === right.length &&
      crypto.timingSafeEqual(
        left,
        right
      )
    );
  } catch {
    return false;
  }
}

function verifyWebhook(
  payload,
  event
) {
  const {
    webhookSecret
  } = getConfig();

  const messageId =
    getHeader(
      event,
      'svix-id'
    );

  const timestamp =
    getHeader(
      event,
      'svix-timestamp'
    );

  const signatureHeader =
    getHeader(
      event,
      'svix-signature'
    );

  if (
    !messageId ||
    !timestamp ||
    !signatureHeader
  ) {
    const error =
      new Error(
        'Missing Resend webhook signature headers.'
      );

    error.statusCode = 400;

    throw error;
  }

  const timestampNumber =
    Number(timestamp);

  if (
    !Number.isFinite(
      timestampNumber
    )
  ) {
    const error =
      new Error(
        'Invalid Resend webhook timestamp.'
      );

    error.statusCode = 400;

    throw error;
  }

  const age =
    Math.abs(
      Math.floor(
        Date.now() / 1000
      ) -
      timestampNumber
    );

  if (
    age >
    WEBHOOK_TOLERANCE_SECONDS
  ) {
    const error =
      new Error(
        'Resend webhook timestamp is outside the allowed window.'
      );

    error.statusCode = 400;

    throw error;
  }

  const secret =
    webhookSecret.startsWith(
      'whsec_'
    )
      ? webhookSecret.slice(6)
      : webhookSecret;

  let signingKey;

  try {
    signingKey =
      Buffer.from(
        secret,
        'base64'
      );
  } catch {
    const error =
      new Error(
        'The Resend webhook signing secret is invalid.'
      );

    error.statusCode = 500;

    throw error;
  }

  const signedContent =
    `${messageId}.${timestamp}.${payload}`;

  const expected =
    crypto
      .createHmac(
        'sha256',
        signingKey
      )
      .update(
        signedContent,
        'utf8'
      )
      .digest(
        'base64'
      );

  const signatures =
    signatureHeader
      .split(' ')
      .map(value =>
        value.trim()
      )
      .filter(Boolean)
      .map(value => {
        const comma =
          value.indexOf(',');

        return comma >= 0
          ? value.slice(
              comma + 1
            )
          : value;
      });

  const valid =
    signatures.some(
      signature =>
        safeEqualBase64(
          signature,
          expected
        )
    );

  if (!valid) {
    const error =
      new Error(
        'Resend webhook signature verification failed.'
      );

    error.statusCode = 400;

    throw error;
  }
}

async function resendRequest(
  path,
  options = {}
) {
  const {
    apiKey
  } = getConfig();

  const result =
    await fetch(
      `https://api.resend.com${path}`,
      {
        method:
          options.method ||
          'GET',

        headers: {
          Authorization:
            `Bearer ${apiKey}`,

          Accept:
            'application/json',

          ...(options.body !== undefined
            ? {
                'Content-Type':
                  'application/json'
              }
            : {}),

          ...(options.idempotencyKey
            ? {
                'Idempotency-Key':
                  options.idempotencyKey
              }
            : {})
        },

        ...(options.body !== undefined
          ? {
              body:
                JSON.stringify(
                  options.body
                )
            }
          : {})
      }
    );

  const raw =
    await result.text();

  let data = null;

  if (raw) {
    try {
      data =
        JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!result.ok) {
    const error =
      new Error(
        data?.message ||
        data?.error?.message ||
        `Resend request failed (${result.status}).`
      );

    error.statusCode =
      (
        result.status >= 500 ||
        result.status === 429
      )
        ? 503
        : 500;

    throw error;
  }

  return data;
}

async function getReceivedEmail(
  emailId
) {
  return resendRequest(
    `/emails/receiving/${encodeURIComponent(emailId)}`
  );
}

async function getAttachments(
  emailId
) {
  const result =
    await resendRequest(
      `/emails/receiving/${encodeURIComponent(emailId)}/attachments`
    );

  return Array.isArray(
    result?.data
  )
    ? result.data
    : [];
}

async function downloadAttachments(
  emailId
) {
  const attachments =
    await getAttachments(
      emailId
    );

  const output = [];

  for (
    const attachment
    of attachments
  ) {
    if (
      !attachment.download_url
    ) {
      continue;
    }

    const result =
      await fetch(
        attachment.download_url
      );

    if (!result.ok) {
      throw new Error(
        `Could not download attachment: ${attachment.filename || 'attachment'}`
      );
    }

    const arrayBuffer =
      await result.arrayBuffer();

    const content =
      Buffer
        .from(arrayBuffer)
        .toString('base64');

    const forwarded = {
      filename:
        attachment.filename ||
        'attachment',

      content
    };

    // Preserve inline-image CID where possible.
    if (
      attachment.content_id
    ) {
      forwarded.content_id =
        attachment.content_id;
    }

    output.push(
      forwarded
    );
  }

  return output;
}

function normaliseAddress(
  value
) {
  return String(
    value || ''
  )
    .trim()
    .toLowerCase();
}

function isBookingsRecipient(
  recipients,
  bookingsEmail
) {
  if (
    !Array.isArray(recipients)
  ) {
    return false;
  }

  return recipients.some(
    address =>
      normaliseAddress(
        address
      ) ===
      bookingsEmail
  );
}

function cleanHeaderText(
  value
) {
  return String(
    value || ''
  )
    .replace(
      /[\r\n]+/g,
      ' '
    )
    .trim();
}

function getDisplayName(
  email
) {
  const originalFrom =
    cleanHeaderText(
      email?.headers?.from ||
      ''
    );

  const match =
    originalFrom.match(
      /^(.+?)\s*<[^>]+>$/
    );

  if (
    match &&
    match[1]
  ) {
    return match[1]
      .replace(
        /^["']|["']$/g,
        ''
      )
      .trim()
      .slice(
        0,
        80
      );
  }

  return cleanHeaderText(
    email?.from ||
    'Customer'
  )
    .split('@')[0]
    .slice(
      0,
      80
    );
}

function escapeHtml(
  value
) {
  return String(
    value ?? ''
  ).replace(
    /[&<>"']/g,
    char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]
  );
}

function buildHtml(
  email,
  sender
) {
  const content =
    email.html ||
    (
      email.text
        ? `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif;">${escapeHtml(email.text)}</pre>`
        : '<p>No message body was supplied.</p>'
    );

  return `
<!doctype html>
<html>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#202124;">

<div
  style="
    padding:12px 16px;
    margin-bottom:18px;
    background:#f4f6f4;
    border-left:4px solid #1e4734;
    font-size:13px;
    line-height:1.5;
  "
>
  <strong>
    Message received via bookings@onthegreengames.co.uk
  </strong>
  <br>
  From:
  ${escapeHtml(sender)}
</div>

${content}

</body>
</html>
`;
}

function buildText(
  email,
  sender
) {
  const body =
    email.text ||
    'This message contained HTML content. View the HTML version in Gmail.';

  return (
    'Message received via bookings@onthegreengames.co.uk\n' +
    `From: ${sender}\n\n` +
    body
  );
}

async function forwardEmail({
  emailId,
  email,
  sender,
  attachments
}) {
  const {
    bookingsEmail,
    forwardTo
  } = getConfig();

  const displayName =
    getDisplayName(email);

  const safeDisplayName =
    cleanHeaderText(
      `${displayName} via On The Green Games`
    )
      .replace(
        /"/g,
        "'"
      )
      .slice(
        0,
        100
      );

  const subject =
    cleanHeaderText(
      email.subject ||
      '(no subject)'
    );

  const body = {
    from:
      `"${safeDisplayName}" <${bookingsEmail}>`,

    to:
      [forwardTo],

    // This is what makes Gmail's normal
    // Reply button go back to the customer.
    reply_to:
      sender,

    subject,

    html:
      buildHtml(
        email,
        sender
      ),

    text:
      buildText(
        email,
        sender
      )
  };

  if (
    attachments.length
  ) {
    body.attachments =
      attachments;
  }

  return resendRequest(
    '/emails',
    {
      method:
        'POST',

      body,

      idempotencyKey:
        `inbound-forward/${emailId}`
    }
  );
}

exports.handler =
async function handler(event) {

  if (
    event.httpMethod !==
    'POST'
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
      getRawBody(event);

    // Verify BEFORE parsing JSON.
    verifyWebhook(
      body,
      event
    );

    let webhook;

    try {
      webhook =
        JSON.parse(body);
    } catch {
      return response(
        400,
        {
          error:
            'Webhook body is not valid JSON.'
        }
      );
    }

    if (
      webhook.type !==
      'email.received'
    ) {
      return response(
        200,
        {
          received:
            true,

          ignored:
            true
        }
      );
    }

    const emailId =
      String(
        webhook.data?.email_id ||
        ''
      ).trim();

    if (!emailId) {
      throw new Error(
        'The inbound webhook did not contain an email ID.'
      );
    }

    const {
      bookingsEmail,
      forwardTo
    } = getConfig();

    const recipients =
      webhook.data?.to || [];

    // Receiving is enabled for the whole domain,
    // but this function currently acts only as
    // the bookings@ mailbox.
    if (
      !isBookingsRecipient(
        recipients,
        bookingsEmail
      )
    ) {
      return response(
        200,
        {
          received:
            true,

          ignored:
            true,

          reason:
            'Email was not addressed to the bookings mailbox.'
        }
      );
    }

    const sender =
      normaliseAddress(
        webhook.data?.from
      );

    if (!sender) {
      throw new Error(
        'Inbound email did not contain a sender address.'
      );
    }

    // Basic loop protection.
    if (
      sender ===
      bookingsEmail
    ) {
      return response(
        200,
        {
          received:
            true,

          ignored:
            true,

          reason:
            'Forwarding loop prevented.'
        }
      );
    }

    const email =
      await getReceivedEmail(
        emailId
      );

    const fullSender =
      normaliseAddress(
        email.from ||
        sender
      );

    if (
      !fullSender
    ) {
      throw new Error(
        'Could not determine the sender of the inbound email.'
      );
    }

    const attachments =
      await downloadAttachments(
        emailId
      );

    const sent =
      await forwardEmail({
        emailId,
        email,
        sender:
          fullSender,
        attachments
      });

    return response(
      200,
      {
        received:
          true,

        forwarded:
          true,

        forwardedTo:
          forwardTo,

        resendEmailId:
          sent?.id ||
          null
      }
    );

  } catch (error) {
    console.error(
      'resend-inbound-webhook failed',
      {
        message:
          error.message,

        statusCode:
          error.statusCode
      }
    );

    return response(
      error.statusCode ||
      500,
      {
        error:
          error.message ||
          'Inbound email forwarding failed.'
      }
    );
  }
};
