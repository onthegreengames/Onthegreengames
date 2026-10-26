# Microsoft Clarity

Project: `z3ovvo5gsr` (public tracking identifier).

The shared `consent.js` installs Clarity on the production domain's allowlisted public pages only after Analytics consent. Consent v3 asks visitors again after introducing the new provider; keep the fallback versions in `site-analytics.js` and `returning-offer.js` aligned.

Clarity Consent V2 maps Analytics to `analytics_Storage` and Advertising measurement to `ad_Storage`. Advertising permission alone never loads Clarity. Withdrawal denies both Clarity permissions, stops the recorder and clears `_clck`/`_clsk` on the site's hostname/domain. Reacceptance restarts the recorder without adding another script. First-party analytics continues independently if Microsoft is blocked.

Only event names from the allowlist are forwarded by the existing first-party analytics: page view, date-check milestones, booking entry, package selected, extra game added, extras completed, details reached, promo code applied and payment started. No event detail, entered promo code, customer identifier or booking reference is forwarded. Look for these under Clarity's events/recording filters after genuine consented visits occur.

Confirmation, pay-balance, additional-details and planner pages are excluded. Replay also skips unknown query parameters and unsafe referrer URLs; normal campaign/ad click and package-selection parameters are supported. Production hostname checking keeps preview/test traffic out. Existing first-party completion reporting remains in place; Clarity does not record completion pages or Stripe checkout.

The booking markup explicitly masks the date/venue step and collapsed summary, customer form and collapsed name summary, pending-payment panel and errors. Microsoft also masks all input/dropdown values by default. Check any future UI additions for displayed customer details or private links before allowing replay on them.

Run from the repo root with jsdom installed outside the published site:

```
NODE_PATH=/path/to/node_modules node tests/clarity-consent.cjs
NODE_PATH=/path/to/node_modules node tests/site-analytics-v2.cjs
NODE_PATH=/path/to/node_modules node tests/booking-flow.cjs
```

References:
- https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2
- https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-masking
- https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-api
- https://learn.microsoft.com/en-us/clarity/setup-and-installation/privacy-disclosure
- https://github.com/microsoft/clarity/blob/master/packages/clarity-js/src/clarity.ts
