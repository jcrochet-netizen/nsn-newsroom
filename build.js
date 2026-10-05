// Génère la version statique pour GitHub Pages dans dist/ : index.html + data.json
// Lancé toutes les 20 min par .github/workflows/pages.yml (ou à la main : `node build.js`)
const fs = require('fs');
const path = require('path');
const { refresh, drain, snapshot, flushCache } = require('./server');

(async () => {
  await refresh();
  // les pages d'articles (mots / image / extrait manquants) sont lues en arrière-plan : on attend la fin, 4 min max
  await Promise.race([drain(), new Promise(r => setTimeout(r, 4 * 60 * 1000).unref())]);
  flushCache();

  const data = snapshot();
  const out = path.join(__dirname, 'dist');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'data.json'), JSON.stringify(data));
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
    .replace('<script>', '<script>window.NSN_STATIC = true;</script>\n<script>');
  fs.writeFileSync(path.join(out, 'index.html'), html);

  const missing = data.items.filter(i => i.words == null).length;
  console.log(`${data.items.length} articles, ${missing} sans nombre de mots, flux en erreur : ${JSON.stringify(data.errors)}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
