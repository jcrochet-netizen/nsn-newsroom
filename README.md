# NSN Newsroom

Agrégateur RSS des sites NSN. Aucune dépendance (Node 18+).

```bash
node server.js
```

Puis ouvrir http://localhost:4317

- **Tous les articles** : tous les sites mélangés, du plus récent au plus ancien. Cliquer sur une pastille de site l'affiche ou la masque ; ⌥/⌘ + clic n'affiche que ce site.
- **Par site** : un widget par site avec ses 10 derniers articles et un bouton « Tout lu » par site.
- Les vues « Titres » et « Titre + extrait » (avec miniature) se changent en haut de la page. Un clic sur un titre ouvre l'article et le marque comme lu. « Mark all read » marque tout comme lu.
- Le nombre de mots est coloré : gris < 300, vert 300–799, jaune 800–1499, rouge ≥ 1500.

Les sites, leurs flux et leurs couleurs sont dans `sites.json`. Les flux se rechargent toutes les 5 minutes. Pour les flux sans texte intégral (Sports Mole, vRINGe), le serveur lit la page de l'article pour compter les mots ; le résultat est mis en cache dans `cache.json`. L'état « lu » est enregistré dans le navigateur (localStorage).

## Filtre

Les articles dont le titre contient un des mots-clés de `filters.json` (`excludeTitleKeywords`) sont exclus. La recherche porte sur le mot entier, sans tenir compte des majuscules : « odds » exclut « Odds » mais pas « Oddschecker ». Le fichier est relu à chaque rechargement des flux, donc pas besoin de redémarrer le serveur.

## Version en ligne (GitHub Pages)

https://jcrochet-netizen.github.io/nsn-newsroom/

Le workflow `.github/workflows/pages.yml` lance `node build.js` toutes les 20 minutes (et à chaque push sur `main`) : il lit les flux, calcule les nombres de mots et publie `dist/` (la page et `data.json`) sur GitHub Pages. Pour forcer une mise à jour : onglet **Actions** → « Publier sur GitHub Pages » → **Run workflow**.

La page en ligne est publique. L'état « lu » reste enregistré dans chaque navigateur.
