/* ================================================================
   IKEA → catalog entry helper
   ----------------------------------------------------------------
   HOW TO USE (Chrome):
   1. Open an IKEA product page (the color you open becomes defaultVariant).
   2. F12 → Sources tab → Snippets → "+ New snippet" → paste this file.
   3. Press Ctrl+Enter (Cmd+Enter on Mac) to run it.
   4. Wait for "Copied to clipboard", then paste into your catalog file.
 
   It reads the page you're on, then opens every other color in the
   "Choose ..." picker one at a time, with a pause between each.
   ================================================================ */
 
(async () => {
  // ── 1. SETTINGS ────────────────────────────────────────────────
  const SETTINGS = {
    delayMs: 1500,   // pause between variant pages so we browse at a human pace
    imageSize: 'xl', // IKEA picks image size from ?f=xs | s | m | l | xl
  };
 
  // Which Map a product goes into, based on the word after the family name.
  // Checked top to bottom, so "armchair" must come before "chair".
  // Edit this to match the Maps in your app.
  const CATEGORIES = [
    { word: 'sofa',      category: 'sofa',     mapName: 'sofas' },
    { word: 'sectional', category: 'sofa',     mapName: 'sofas' },
    { word: 'loveseat',  category: 'sofa',     mapName: 'sofas' },
    { word: 'armchair',  category: 'armchair', mapName: 'armchairs' },
    { word: 'chair',     category: 'chair',    mapName: 'chairs' },
    { word: 'bed',       category: 'bed',      mapName: 'beds' },
    { word: 'desk',      category: 'desk',     mapName: 'desks' },
    { word: 'table',     category: 'table',    mapName: 'tables' },
    { word: 'bookcase',  category: 'storage',  mapName: 'storage' },
    { word: 'dresser',   category: 'storage',  mapName: 'storage' },
  ];
 
  // Backup colors, only used when the product photo can't be read.
  const COLOR_NAMES = {
    'white': '#f2f2ee', 'off-white': '#ece8dd', 'black': '#1f1f1f', 'black-brown': '#2e2622',
    'gray': '#8a8a8a', 'light gray': '#c4c4c4', 'medium gray': '#8f8f8f', 'dark gray': '#4a4a4a',
    'anthracite': '#3b3d3f', 'gray-turquoise': '#5b8987', 'gray-green': '#7d8b78',
    'beige': '#d6c7ad', 'light beige': '#e3d8c5', 'dark beige': '#b9a78a',
    'brown': '#7a5638', 'light brown': '#a8825f', 'dark brown': '#4b3423',
    'green': '#5f7d57', 'light green': '#a6b89a', 'dark green': '#2f4a3a',
    'blue': '#4a6a8f', 'light blue': '#a9c0d6', 'dark blue': '#243a5a',
    'turquoise': '#3f8f8c', 'pink': '#d9a6a6', 'red': '#a8322d', 'yellow': '#e0c04a', 'orange': '#d27a35',
    'oak': '#c8a06e', 'walnut': '#6b4a32', 'birch': '#d9c19a', 'pine': '#d8b27a', 'rattan': '#b8915c',
  };
 
  // ── 2. SMALL HELPERS ───────────────────────────────────────────
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
 
  // "BÄSTIS" → "BASTIS" (strips accents so ids and keys stay plain)
  const plainAscii = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
 
  // Wraps text in 'single quotes' for the generated code, escaping \ and '
  const quote = (text) => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
 
  // All text inside an element, with a space between each piece.
  // IKEA splits text across <span>s, and plain .textContent glues
  // them together ("KIVIKSofa"). This keeps words apart.
  function textOf(element) {
    if (!element) return '';
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const pieces = [];
    while (walker.nextNode()) pieces.push(walker.currentNode.nodeValue);
    return pieces.join(' ').replace(/\s+/g, ' ').replace(/ ([,:])/g, '$1').trim();
  }
 
  // "Tibbleby beige/gray" → "tibblebyBeigeGray"
  function toCamelCase(text) {
    const words = plainAscii(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return words.map((word, i) => (i === 0 ? word : word[0].toUpperCase() + word.slice(1))).join('');
  }
 
  // ── 3. EXTRACT: read raw facts from ONE product page ───────────
  // Each function takes a Document: either `document` (the page you're
  // on) or a page downloaded by fetchPage(). The same code reads both.
 
  // 3a. JSON-LD: hidden structured data IKEA embeds for search engines
  function readJsonLd(doc) {
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch {
        continue; // one broken tag shouldn't stop us
      }
      if (!data) continue;
      const items = [].concat(data, data['@graph'] || []);
      const product = items.find((item) => item && [].concat(item['@type']).includes('Product'));
      if (product) return product;
    }
    return null;
  }
 
  // 3b. Title "KIVIK Sofa, Tibbleby beige/gray"
  //     name  = before the first comma → "KIVIK Sofa"
  //     label = after it               → "Tibbleby beige/gray"
  function readTitle(doc, jsonLd) {
    const title = textOf(doc.querySelector('h1')) || jsonLd?.name || '';
    const comma = title.indexOf(',');
    if (comma === -1) return { name: title, label: '' };
    return { name: title.slice(0, comma).trim(), label: title.slice(comma + 1).trim() };
  }
 
  // 3c. Price: JSON-LD first, a meta tag as backup
  function readPrice(doc, jsonLd) {
    const offer = [].concat(jsonLd?.offers || [])[0];
    const raw = offer?.price ?? offer?.lowPrice
      ?? doc.querySelector('meta[property="product:price:amount"]')?.getAttribute('content');
    const price = Number(raw);
    return price > 0 ? price : null;
  }
 
  // 3d. Photo and page address
  function readImageBase(doc, jsonLd) {
    const firstLdImage = [].concat(jsonLd?.image || [])[0];
    const raw = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
      || (typeof firstLdImage === 'string' ? firstLdImage : firstLdImage?.url) || '';
    return raw.split('?')[0]; // drop any ?f=size so we can choose our own
  }
 
  function readUrl(doc, pageUrl) {
    const raw = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || pageUrl;
    return new URL(raw, pageUrl).href.split('#')[0];
  }
 
  // 3e. Measurements: rows like  Width 89 3/4 "   or   Width: 89 3/4"
  //                              (label)(value)(inch mark)
  const ROW_PATTERN = /^([A-Za-z][A-Za-z .,()-]*?):? ?(\d[\d /.–-]*?) ?["″]$/;
 
  function parseRow(text) {
    const match = text.match(ROW_PATTERN);
    if (!match) return null;
    return { label: match[1].trim(), value: match[2].trim(), inches: toInches(match[2]) };
  }
 
  function readMeasurements(doc) {
    // Find the first <li> that looks like a size row...
    const firstRow = [...doc.querySelectorAll('li')].find((li) => parseRow(textOf(li)));
    if (!firstRow) return [];
    // ...then only read the rows in that same list, so box/package sizes
    // elsewhere on the page don't sneak in.
    return [...firstRow.parentElement.children].map((li) => parseRow(textOf(li))).filter(Boolean);
  }
 
  // 3f. Variant links: the links under "Choose color:" / "Choose cover:"
  function readVariantUrls(doc, pageUrl) {
    const urls = new Set(); // a Set ignores duplicates automatically
    const headings = [...doc.querySelectorAll('h2, h3, h4, legend')]
      .filter((heading) => /^choose\b/i.test(textOf(heading)));
 
    for (const heading of headings) {
      // Climb up from the heading until we reach a box containing product links.
      let box = heading.parentElement;
      for (let step = 0; step < 5 && box; step++) {
        const links = box.querySelectorAll('a[href*="/p/"]');
        if (links.length > 0) {
          links.forEach((link) => urls.add(new URL(link.getAttribute('href'), pageUrl).href.split('#')[0]));
          break;
        }
        box = box.parentElement;
      }
    }
    return [...urls];
  }
 
  // Runs every extractor above on one page and bundles the results.
  function parseProductPage(doc, pageUrl) {
    const jsonLd = readJsonLd(doc);
    const { name, label } = readTitle(doc, jsonLd);
    const rows = readMeasurements(doc);
    return {
      name,
      label,
      rows,
      price: readPrice(doc, jsonLd),
      imageBase: readImageBase(doc, jsonLd),
      url: readUrl(doc, pageUrl),
      width: pickSize(rows, 'Width', 'Length', 'Diameter'),
      depth: pickSize(rows, 'Depth', 'Length', 'Diameter'),
      height: pickSize(rows, 'Height', 'Max. height'),
    };
  }
 
  // ── 4. FETCH: download another variant's page ──────────────────
  async function fetchPage(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`IKEA responded ${response.status}`);
    const html = await response.text();
    return new DOMParser().parseFromString(html, 'text/html'); // text → Document
  }
 
  // ── 5. TRANSFORM: turn raw text into the values your app uses ──
 
  // "89 3/4" → 89.75    "5/8" → 0.625    "48" → 48
  function toInches(value) {
    const text = value.trim();
    let match = text.match(/^(\d+) (\d+)\/(\d+)/);
    if (match) return round(Number(match[1]) + match[2] / match[3]);
    match = text.match(/^(\d+)\/(\d+)/);
    if (match) return round(match[1] / match[2]);
    match = text.match(/^\d+(\.\d+)?/);
    return match ? Number(match[0]) : null;
  }
  const round = (n) => Math.round(n * 1000) / 1000;
 
  // First label that exists wins: pickSize(rows, 'Width', 'Length')
  function pickSize(rows, ...labels) {
    for (const label of labels) {
      const row = rows.find((r) => r.label.toLowerCase() === label.toLowerCase());
      if (row) return row.inches;
    }
    return null;
  }
 
  // Estimates the product's main color from its photo.
  async function colorFromPhoto(imageBase) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `${imageBase}?f=s`;
    await img.decode(); // wait for the photo to load
 
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64; // shrink it: 4,096 pixels is plenty
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 64, 64);
    const pixels = ctx.getImageData(0, 0, 64, 64).data; // [r, g, b, a, r, g, b, a, ...]
    return dominantColor(pixels);
  }
 
  // Sorts pixels into buckets of similar color, skips the white studio
  // background, and returns the average color of the biggest bucket.
  function dominantColor(pixels) {
    const buckets = new Map();
    let kept = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
      if (a < 200 || Math.min(r, g, b) > 230) continue; // transparent or background
      kept++;
      const key = `${Math.floor(r / 32)}-${Math.floor(g / 32)}-${Math.floor(b / 32)}`;
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bucket.count++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }
    // A colored sofa fills a big part of the photo. If under 15% of pixels
    // survived, it's a white product and we only kept its shadow and legs.
    if (kept < (pixels.length / 4) * 0.15) return null;
    const top = [...buckets.values()].reduce((best, b) => (b.count > best.count ? b : best));
    return toHex(top.r / top.count, top.g / top.count, top.b / top.count);
  }
 
  const toHex = (...rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
 
  // Backup: finds the earliest color word in the label ("beige/gray" → beige).
  function colorFromName(label) {
    const text = label.toLowerCase();
    let best = null;
    for (const [colorName, hex] of Object.entries(COLOR_NAMES)) {
      const index = text.search(new RegExp(`\\b${colorName}\\b`));
      if (index === -1) continue;
      const longerTie = best && index === best.index && colorName.length > best.colorName.length;
      if (!best || index < best.index || longerTie) best = { index, colorName, hex };
    }
    return best?.hex ?? null;
  }
 
  // "4-seat with chaise, Tresund light beige" and "4-seat with chaise, Tallmyra blue"
  // share "4-seat with chaise". Shared parts move into the product name.
  function splitSharedParts(labels) {
    const partLists = labels.map((label) => label.split(',').map((part) => part.trim()).filter(Boolean));
    const shared = labels.length < 2
      ? []
      : partLists[0].filter((part) => partLists.every((parts) => parts.includes(part)));
    const trimmed = partLists.map((parts) => parts.filter((part) => !shared.includes(part)).join(', '));
    if (trimmed.some((label) => label === '')) return { shared: [], labels };
    return { shared, labels: trimmed };
  }
 
  // "KIVIK Sofa" → { category: 'sofa', mapName: 'sofas' }
  function pickCategory(name) {
    const type = name.split(' ').slice(1).join(' ').toLowerCase();
    const hit = CATEGORIES.find(({ word }) => new RegExp(`\\b${word}s?\\b`).test(type));
    if (hit) return { ...hit, guessed: false };
    const fallback = type.split(' ')[0] || 'other';
    return { category: fallback, mapName: `${fallback}s`, guessed: true };
  }
 
  // ── 6. FORMAT: build the code text you paste into your app ─────
  function formatEntry({ mapName, key, name, category, main, defaultVariant, variants, notes }) {
    const measurements = main.rows
      .map((row) => `${row.label} : ${row.value}`)
      .join('\n    ')
      .replace(/[`$\\]/g, '\\$&'); // escape characters that are special inside `backticks`
 
    const variantLines = variants.map((v) => {
      const line = `    { variantId: ${quote(v.variantId)}, label: ${quote(v.label)}, hex: ${quote(v.hex)}, ` +
        `price: ${v.price}, imageUrl: ${quote(v.imageUrl)}, productUrl: ${quote(v.productUrl)} },`;
      return v.notes.length ? `${line} // CHECK: ${v.notes.join('; ')}` : line;
    });
 
    return [
      ...notes.map((note) => `// CHECK: ${note}`),
      `${mapName}.set(${quote(key)}, {`,
      `  name: ${quote(name)},`,
      `  category: ${quote(category)},`,
      `  width: ${main.width},`,
      `  depth: ${main.depth},`,
      `  height: ${main.height},`,
      `  measurements: \`${measurements}\`,`,
      `  imageUrl: ${quote(main.imageUrl)},`,
      `  productUrl: ${quote(main.productUrl)},`,
      `  price: ${main.price},`,
      `  styleTags: [], // fill in by hand`,
      `  defaultVariant: ${quote(defaultVariant)},`,
      `  variants: [`,
      ...variantLines,
      `  ],`,
      `})`,
    ].join('\n');
  }
 
  // ── 7. RUN: the steps above, in order ──────────────────────────
  console.log('Reading this page...');
  const main = parseProductPage(document, location.href);
  if (!main.name || main.rows.length === 0) {
    console.error('No product title or measurements found. Run this on an IKEA product page.');
    return;
  }
 
  // Visit each other variant, one at a time.
  const pages = [main];
  const variantUrls = readVariantUrls(document, main.url).filter((url) => url !== main.url);
  console.log(`Found ${variantUrls.length} other variant(s).`);
 
  for (const [i, url] of variantUrls.entries()) {
    await sleep(SETTINGS.delayMs);
    console.log(`  ${i + 1}/${variantUrls.length}: ${url}`);
    try {
      const page = parseProductPage(await fetchPage(url), url);
      if (page.name === main.name) pages.push(page);
      else console.warn(`  Skipped, different product: "${page.name}"`);
    } catch (error) {
      console.warn(`  Stopping early (${error.message}). Keeping the ${pages.length} variant(s) read so far.`);
      break;
    }
  }
 
  // Clean up names, pick a category, work out colors.
  const { shared, labels } = splitSharedParts(pages.map((page) => page.label));
  const name = [main.name, ...shared].join(', ');
  const key = plainAscii(name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const { category, mapName, guessed } = pickCategory(main.name);
 
  console.log('Reading colors from product photos...');
  const variants = [];
  const usedIds = new Set();
  for (const [i, page] of pages.entries()) {
    const notes = [];
    let hex = null;
    try {
      hex = await colorFromPhoto(page.imageBase);
    } catch {
      // photo didn't load or couldn't be read; the name backup handles it
    }
    if (!hex) {
      hex = colorFromName(labels[i]);
      notes.push(hex ? 'hex guessed from color name' : 'hex unknown, pick one');
      hex ??= '#cccccc';
    }
    if (page.price === null) notes.push('price not found');
    if (['width', 'depth', 'height'].some((dim) => page[dim] !== main[dim])) {
      notes.push('size differs from main product');
    }
 
    let variantId = toCamelCase(labels[i]) || `variant${i + 1}`;
    if (usedIds.has(variantId)) variantId += i + 1;
    usedIds.add(variantId);
 
    variants.push({
      variantId,
      label: labels[i],
      hex,
      price: page.price,
      imageUrl: `${page.imageBase}?f=${SETTINGS.imageSize}`,
      productUrl: `${page.url}#content`,
      notes,
    });
  }
 
  const notes = [];
  if (guessed) notes.push(`category "${category}" was a guess`);
  if ([main.width, main.depth, main.height].includes(null)) notes.push('a size is missing, see measurements');
 
  const output = formatEntry({
    mapName, key, name, category, notes, variants,
    defaultVariant: variants[0].variantId,
    main: { ...main, imageUrl: variants[0].imageUrl, productUrl: variants[0].productUrl },
  });
 
  console.log(output);
  try {
    copy(output); // copy() only exists inside DevTools
    console.log('Copied to clipboard. Paste it into your catalog file.');
  } catch {
    console.log('Could not copy automatically. Select the code above and copy it.');
  }
})();
