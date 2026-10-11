import { readFile, writeFile } from 'node:fs/promises';

const site = 'https://onthegreengames.co.uk';

const previews = {
  'index.html': {
    image: '/assets/images/giant-connect-four-game-1.webp',
    alt: 'Giant wooden Connect 4 wedding game set up on grass',
    width: 1400,
    height: 1050,
  },
  'booking-info.html': {
    image: '/assets/images/giant-connect-four-game-1.webp',
    alt: 'Giant wooden Connect 4 wedding game set up on grass',
    width: 1400,
    height: 1050,
  },
  'areas-we-cover.html': {
    image: '/assets/images/area-service-map-1200.webp',
    alt: 'Illustrated service area map showing Cheshire, Merseyside, Greater Manchester, Lancashire, North Wales and the South Lakes',
    width: 1200,
    height: 1200,
  },
  'wedding-games-hire-cheshire.html': {
    image: '/assets/images/area-cheshire-map-1200.webp',
    alt: 'Illustrated map of the Cheshire coverage area',
    width: 1200,
    height: 1200,
  },
  'wedding-games-hire-merseyside.html': {
    image: '/assets/images/area-merseyside-map-1200.webp',
    alt: 'Illustrated map of the Merseyside coverage area',
    width: 1200,
    height: 1200,
  },
  'wedding-games-hire-greater-manchester.html': {
    image: '/assets/images/area-greater-manchester-map-1200.webp',
    alt: 'Illustrated map of the Greater Manchester coverage area',
    width: 1200,
    height: 1200,
  },
  'wedding-games-hire-lancashire.html': {
    image: '/assets/images/area-lancashire-map-1200.webp',
    alt: 'Illustrated map of the Lancashire coverage area',
    width: 1200,
    height: 1200,
  },
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function replaceMeta(html, attribute, key, value) {
  const pattern = new RegExp(
    `<meta\\b(?=[^>]*\\b${attribute}=["']${escapeRegExp(key)}["'])[^>]*>`,
    'i',
  );

  if (!pattern.test(html)) {
    throw new Error(`Missing ${attribute}="${key}" meta tag`);
  }

  return html.replace(
    pattern,
    `<meta ${attribute}="${key}" content="${escapeAttribute(value)}">`,
  );
}

for (const [file, preview] of Object.entries(previews)) {
  const fileUrl = new URL(`../${file}`, import.meta.url);
  let html = await readFile(fileUrl, 'utf8');
  const imageUrl = `${site}${preview.image}`;

  html = replaceMeta(html, 'property', 'og:image', imageUrl);
  html = replaceMeta(html, 'property', 'og:image:alt', preview.alt);
  html = replaceMeta(html, 'property', 'og:image:width', preview.width);
  html = replaceMeta(html, 'property', 'og:image:height', preview.height);
  html = replaceMeta(html, 'property', 'og:image:type', 'image/webp');
  html = replaceMeta(html, 'name', 'twitter:image', imageUrl);
  html = replaceMeta(html, 'name', 'twitter:image:alt', preview.alt);

  await writeFile(fileUrl, html, 'utf8');
  console.log(`Updated social preview metadata: ${file}`);
}
