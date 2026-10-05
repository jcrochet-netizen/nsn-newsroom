// NSN Newsroom — agrégateur RSS. Aucune dépendance : `node server.js` puis http://localhost:4317
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4317;
const REFRESH_MS = 5 * 60 * 1000;
const MAX_ITEMS_PER_SITE = 30;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 NSN-Newsroom';
const CACHE_FILE = path.join(__dirname, 'cache.json');
const SITES = JSON.parse(fs.readFileSync(path.join(__dirname, 'sites.json'), 'utf8'));

// Articles exclus : titre contenant un de ces mots-clés (mot entier, insensible à la casse)
function loadExcludeRe() {
  try {
    const { excludeTitleKeywords = [] } = JSON.parse(fs.readFileSync(path.join(__dirname, 'filters.json'), 'utf8'));
    if (!excludeTitleKeywords.length) return null;
    const alt = excludeTitleKeywords.map(k => k.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|');
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, 'iu');
  } catch { return null; }
}

// ---------- cache des pages (nombre de mots / image) ----------
let pageCache = {};
try { pageCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}
let saveTimer = null;
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // on ne garde que les 3000 entrées les plus récentes
    const entries = Object.entries(pageCache).sort((a, b) => (b[1].t || 0) - (a[1].t || 0)).slice(0, 3000);
    pageCache = Object.fromEntries(entries);
    fs.writeFile(CACHE_FILE, JSON.stringify(pageCache), () => {});
  }, 1000);
}

// ---------- utilitaires HTML / XML ----------
// entités nommées HTML (accents Latin-1 + ponctuation) — sensibles à la casse : &Eacute; ≠ &eacute;
const NAMED = { AElig: 'Æ', Aacute: 'Á', Acirc: 'Â', Agrave: 'À', Aring: 'Å', Atilde: 'Ã', Auml: 'Ä', Ccedil: 'Ç', ETH: 'Ð', Eacute: 'É', Ecirc: 'Ê', Egrave: 'È', Euml: 'Ë', Iacute: 'Í', Icirc: 'Î', Igrave: 'Ì', Iuml: 'Ï', Ntilde: 'Ñ', OElig: 'Œ', Oacute: 'Ó', Ocirc: 'Ô', Ograve: 'Ò', Oslash: 'Ø', Otilde: 'Õ', Ouml: 'Ö', Prime: '″', Scaron: 'Š', THORN: 'Þ', Uacute: 'Ú', Ucirc: 'Û', Ugrave: 'Ù', Uuml: 'Ü', Yacute: 'Ý', aacute: 'á', acirc: 'â', acute: '´', aelig: 'æ', agrave: 'à', amp: '&', apos: "'", aring: 'å', atilde: 'ã', auml: 'ä', bdquo: '„', brvbar: '¦', bull: '•', ccedil: 'ç', cedil: '¸', cent: '¢', copy: '©', curren: '¤', dagger: '†', deg: '°', divide: '÷', eacute: 'é', ecirc: 'ê', egrave: 'è', emsp: '\u2003', ensp: '\u2002', eth: 'ð', euml: 'ë', euro: '€', frac12: '½', frac14: '¼', frac34: '¾', gt: '>', hellip: '…', iacute: 'í', icirc: 'î', iexcl: '¡', igrave: 'ì', iquest: '¿', iuml: 'ï', laquo: '«', ldquo: '“', lrm: '\u200e', lsquo: '‘', lt: '<', macr: '¯', mdash: '—', micro: 'µ', middot: '·', minus: '−', nbsp: '\xa0', ndash: '–', not: '¬', ntilde: 'ñ', oacute: 'ó', ocirc: 'ô', oelig: 'œ', ograve: 'ò', ordf: 'ª', ordm: 'º', oslash: 'ø', otilde: 'õ', ouml: 'ö', para: '¶', plusmn: '±', pound: '£', prime: '′', quot: '"', raquo: '»', rdquo: '”', reg: '®', rlm: '\u200f', rsquo: '’', sbquo: '‚', scaron: 'š', sect: '§', shy: '\xad', sup1: '¹', sup2: '²', sup3: '³', szlig: 'ß', thinsp: '\u2009', thorn: 'þ', times: '×', trade: '™', uacute: 'ú', ucirc: 'û', ugrave: 'ù', uml: '¨', uuml: 'ü', yacute: 'ý', yen: '¥', yuml: 'ÿ', zwj: '\u200d', zwnj: '\u200c' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? '';
  });
}
const unCdata = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
function stripHtml(html) {
  // HTML échappé dans le HTML (&lt;style&gt;…) : on décode d'abord pour que les balises soient bien retirées
  if (/&lt;\/?[a-z]/i.test(html)) html = decode(html);
  // CSS « nu » laissé dans le contenu (balise <style> retirée par WordPress) : commentaires puis règles, 2 passes pour les @media
  html = html.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // sommaires automatiques et liens réseaux sociaux : pas du contenu rédactionnel
  html = html.replace(/<(div|nav)\b[^>]*(?:id|class)=["'][^"']*\b(?:toc_container|ez-toc-container|lwptoc|rank-math-toc)\b[\s\S]*?<\/(?:ul|ol)>\s*(?:<\/(?:nav|div)>\s*)+/gi, ' ')
             .replace(/<ul\b[^>]*class=["'][^"']*wp-block-social-links[\s\S]*?<\/ul>/gi, ' ');
  for (let i = 0; i < 2; i++) html = html.replace(/[^{}<>]*\{[^{}<>]*:[^{}<>]*\}/g, m => /[;:]\s*[^\s]/.test(m) ? ' ' : m);
  return decode(html
    .replace(/<(script|style|noscript|svg|iframe|figure|figcaption|blockquote class="twitter-tweet"|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function countWords(text) {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;
}
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? unCdata(m[1]).trim() : '';
}
function attr(xml, tagName, attrName) {
  const m = xml.match(new RegExp(`<${tagName}\\b[^>]*\\b${attrName}=["']([^"']+)["']`, 'i'));
  return m ? decode(m[1]) : '';
}
function firstImg(html) {
  const m = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  return m ? decode(m[1]) : '';
}

// ---------- parsing d'un flux ----------
function parseFeed(xml, site) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  const excludeRe = loadExcludeRe();
  // Flux cassé (ex. Football Ground Guide) : le même contenu répété sur plusieurs articles → on ne s'y fie pas
  const seen = {};
  for (const b of blocks) { const k = tag(b, 'content:encoded').slice(0, 2000); if (k) seen[k] = (seen[k] || 0) + 1; }
  const dupContent = b => seen[tag(b, 'content:encoded').slice(0, 2000)] > 1;
  const seenDesc = {};
  for (const b of blocks) { const k = tag(b, 'description'); if (k) seenDesc[k] = (seenDesc[k] || 0) + 1; }
  const feedImage = b => attr(b, 'media:thumbnail', 'url') || attr(b, 'media:content', 'url')
    || (/<enclosure[^>]*type=["']image/i.test(b) ? attr(b, 'enclosure', 'url') : '');
  const seenImg = {};
  for (const b of blocks) { const k = feedImage(b); if (k) seenImg[k] = (seenImg[k] || 0) + 1; }
  return blocks.map(b => {
    const broken = dupContent(b);
    const title = stripHtml(tag(b, 'title'));
    let link = decode(tag(b, 'link')) || attr(b, 'link', 'href');
    // certains flux envoient le HTML échappé (&lt;p&gt;…) : on le décode avant de retirer les balises
    const unescape = h => /&lt;\/?[a-z]/i.test(h) ? decode(h) : h;
    const content = unescape(tag(b, 'content:encoded') || tag(b, 'content'));
    const desc = unescape(tag(b, 'description') || tag(b, 'summary'));
    const dateStr = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const date = new Date(dateStr);
    // même image sur plusieurs articles = image du flux erronée → on prendra l'og:image de la page
    const fi = feedImage(b);
    const image = (fi && seenImg[fi] < 2 ? fi : '') || (broken ? '' : firstImg(content)) || firstImg(desc);
    const contentText = content ? stripHtml(content) : '';
    const descText = stripHtml(desc);
    // Texte intégral dispo dans le flux si content:encoded est nettement plus long que la description
    const fullInFeed = !broken && contentText && countWords(contentText) > 80;
    const descOk = descText.length > 40 && !(seenDesc[tag(b, 'description')] > 1);
    const excerptSrc = descOk ? descText : broken ? '' : contentText;
    return {
      id: link,
      site: site.id,
      title,
      link,
      date: isNaN(date) ? null : date.toISOString(),
      excerpt: (/&[a-z#0-9]+;/i.test(excerptSrc) ? decode(excerptSrc) : excerptSrc).replace(/\s*(\[…\]|\[\.\.\.\]|The post .*$|L’article .*$|O post .*$|La entrada .*$|L'articolo .*$)/, '').slice(0, 280),
      image: image ? image.replace(/^http:\/\//, 'https://') : '',
      words: fullInFeed ? countWords(contentText) : null,
    };
  }).filter(i => i.link && i.title && !(excludeRe && excludeRe.test(i.title))).slice(0, MAX_ITEMS_PER_SITE);
}

// ---------- extraction depuis la page de l'article ----------
function extractFromPage(html) {
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const clean = html.replace(/<(script|style|noscript|svg|header|footer|nav|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  // On prend le bloc <article> qui contient le plus de texte en paragraphes, sinon toute la page
  const articles = clean.match(/<article\b[\s\S]*?<\/article>/gi) || [];
  const paraWords = h => (h.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []).reduce((n, p) => n + countWords(stripHtml(p)), 0);
  let best = 0;
  for (const a of articles) best = Math.max(best, paraWords(a));
  if (best < 80) {
    const body = clean.match(/<div[^>]+(?:itemprop=["']articleBody["']|class=["'][^"']*(?:article[-_]?(?:body|content|text)|entry-content|post-content|detail[-_]?text|news-detail)[^"']*["'])[^>]*>([\s\S]*)/i);
    best = Math.max(best, body ? paraWords(body[1].slice(0, 200000)) : 0);
  }
  if (best < 80) best = paraWords(clean);
  const ogd = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i);
  return { words: best || null, image: og ? decode(og[1]) : '', excerpt: ogd ? decode(ogd[1]).slice(0, 280) : '' };
}

async function fetchText(url, timeout = 15000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || '';
  const head = buf.subarray(0, 2000).toString('latin1');
  const charset = (ct.match(/charset=([\w-]+)/i) || head.match(/encoding=["']([\w-]+)["']|charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
  try { return new TextDecoder(charset.toLowerCase()).decode(buf); } catch { return buf.toString('utf8'); }
}

// ---------- file d'attente d'enrichissement ----------
const queue = [];
const queued = new Set();
let active = 0;
function enqueue(item) {
  if (queued.has(item.link) || pageCache[item.link]) return;
  queued.add(item.link);
  queue.push(item.link);
  pump();
}
function pump() {
  while (active < 6 && queue.length) {
    const url = queue.shift();
    active++;
    fetchText(url)
      .then(html => { pageCache[url] = { ...extractFromPage(html), t: Date.now() }; })
      .catch(() => { pageCache[url] = { words: null, image: '', t: Date.now(), err: true }; })
      .finally(() => { active--; queued.delete(url); saveCache(); pump(); });
  }
}

// ---------- état des flux ----------
const state = { items: [], errors: {}, fetchedAt: null, refreshing: null };

async function refresh() {
  if (state.refreshing) return state.refreshing;
  state.refreshing = (async () => {
    const results = await Promise.all(SITES.map(async site => {
      try { return parseFeed(await fetchText(site.feed), site); }
      catch (e) { state.errors[site.id] = e.message; return null; }
    }));
    const items = [];
    results.forEach((r, i) => {
      if (r) { delete state.errors[SITES[i].id]; items.push(...r); }
      else items.push(...state.items.filter(it => it.site === SITES[i].id)); // on garde l'ancien contenu si le flux tombe
    });
    state.items = items;
    state.fetchedAt = new Date().toISOString();
    for (const it of items) if (it.words == null || !it.image || !it.excerpt) enqueue(it);
  })().finally(() => { state.refreshing = null; });
  return state.refreshing;
}

function snapshot() {
  let pending = 0;
  const items = state.items.map(it => {
    const c = pageCache[it.link];
    const needs = it.words == null || !it.image || !it.excerpt;
    if (needs && !c) pending++;
    return { ...it, words: it.words ?? c?.words ?? null, image: it.image || c?.image || '', excerpt: it.excerpt || c?.excerpt || '' };
  });
  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { sites: SITES, items, errors: state.errors, fetchedAt: state.fetchedAt, pending };
}

// ---------- serveur HTTP ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/items') {
      const stale = !state.fetchedAt || Date.now() - new Date(state.fetchedAt) > REFRESH_MS;
      if (url.searchParams.has('force') || stale) await refresh();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(snapshot()));
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return fs.createReadStream(path.join(__dirname, 'public', 'index.html')).pipe(res);
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
});

server.listen(PORT, () => {
  console.log(`NSN Newsroom → http://localhost:${PORT}`);
  refresh();
  setInterval(refresh, REFRESH_MS);
});
