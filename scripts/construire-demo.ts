// Construit la démo dans site/, publiée telle quelle sur GitHub Pages :
//
//   site/index.html     redirige vers /fr/ ou /en/ selon navigator.languages
//                       (liens visibles si le script ne tourne pas) ;
//   site/fr/, site/en/  la même page, textes tirés de demo/textes.ts ;
//   site/demo.js        son script (et le moteur JavaScript en morceau à part),
//   site/style.css, site/equix.wasm.
//
//   bun scripts/construire-demo.ts   (après bun run build)

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LANGUES, TEXTES } from '../demo/textes.ts'

const racine = resolve(import.meta.dirname, '..')
const site = resolve(racine, 'site')
await rm(site, { recursive: true, force: true })
await mkdir(site, { recursive: true })
// Le moteur JavaScript (≈ 620 Ko) forme un morceau à part, chargé seulement s’il sert.
const resultat = await Bun.build({ entrypoints: [resolve(racine, 'demo/demo.ts')], outdir: site, target: 'browser', format: 'esm', minify: true, splitting: true, naming: { entry: 'demo.js', chunk: '[name]-[hash].[ext]' } })
if (!resultat.success) {
  for (const message of resultat.logs) console.error(message)
  throw new Error('La construction de la démo a échoué')
}

const modele = await readFile(resolve(racine, 'demo/modele.html'), 'utf8')
for (const langue of LANGUES) {
  const autre = LANGUES.find((code) => code !== langue)!
  const valeurs: Record<string, string> = { ...TEXTES[langue].page, langue, autreCode: autre }
  const page = modele.replace(/\{\{(\w+)\}\}/g, (_, cle: string) => {
    const valeur = valeurs[cle]
    if (valeur === undefined) throw new Error(`Texte absent pour « ${cle} » (${langue})`)
    return valeur
  })
  await mkdir(resolve(site, langue), { recursive: true })
  await writeFile(resolve(site, langue, 'index.html'), page)
}

// Accueil : même règle que langueNavigateur (demo/outils.ts) ; les réglages de l’adresse suivent.
await writeFile(resolve(site, 'index.html'), `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${TEXTES.fr.page.titreCourt} · ${TEXTES.en.page.titreCourt}</title>
  <link rel="alternate" hreflang="fr" href="./fr/">
  <link rel="alternate" hreflang="en" href="./en/">
  <link rel="stylesheet" href="./style.css">
  <script>
    (function () {
      var langues = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
      var francais = false;
      for (var i = 0; i < langues.length; i++) if (/^fr\\b/i.test(langues[i])) francais = true;
      location.replace((francais ? 'fr/' : 'en/') + location.search + location.hash);
    })();
  </script>
</head>
<body>
  <main>
    <h1>${TEXTES.fr.page.titreCourt}</h1>
    <p class="choix-langue"><a href="./fr/" hreflang="fr" lang="fr">Français</a> <a href="./en/" hreflang="en" lang="en">English</a></p>
  </main>
</body>
</html>
`)
await copyFile(resolve(racine, 'demo/style.css'), resolve(site, 'style.css'))
await copyFile(resolve(racine, 'dist/equix.wasm'), resolve(site, 'equix.wasm'))
console.log('✓ démo construite dans site/ (fr, en)')
