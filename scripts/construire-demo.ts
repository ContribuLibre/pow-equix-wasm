// Construit la démo dans site/, publiée telle quelle sur GitHub Pages :
//
//   site/index.html     redirige vers /fr/ ou /en/ selon navigator.languages
//                       (liens visibles si le script ne tourne pas) ;
//   site/fr/, site/en/  la même page, textes tirés de demo/textes.ts ;
//   site/demo.js        son script (et le moteur JavaScript en morceau à part),
//   site/fr/banc/, site/en/banc/  le banc comparatif (SHA-256, Argon2id, Equi-X),
//   site/banc.js, site/banc-travailleur.js  son script et son Web Worker,
//   site/style.css, site/equix.wasm.
//
// Le banc ne sert qu’à la démo : rien n’en entre dans dist/ ni dans le paquet.
//
//   bun scripts/construire-demo.ts   (après bun run build)

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { TEXTES_BANC } from '../demo/banc/textes.ts'
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

// Page du banc et son Web Worker (module autonome, hash-wasm compris).
for (const [entree, nom, decoupage] of [['demo/banc/page.ts', 'banc.js', true], ['demo/banc/travailleur.ts', 'banc-travailleur.js', false]] as const) {
  const banc = await Bun.build({ entrypoints: [resolve(racine, entree)], outdir: site, target: 'browser', format: 'esm', minify: true, splitting: decoupage, naming: { entry: nom, chunk: 'banc-[name]-[hash].[ext]' } })
  if (!banc.success) {
    for (const message of banc.logs) console.error(message)
    throw new Error(`La construction de ${nom} a échoué`)
  }
}

async function remplirModele(chemin: string, valeurs: Record<string, string>, langue: string): Promise<string> {
  return (await readFile(resolve(racine, chemin), 'utf8')).replace(/\{\{(\w+)\}\}/g, (_, cle: string) => {
    const valeur = valeurs[cle]
    if (valeur === undefined) throw new Error(`Texte absent pour « ${cle} » (${langue}, ${chemin})`)
    return valeur
  })
}

// Commandes de fiche machine (scripts/config-machine/), montrées telles quelles dans la page du banc.
const echapper = (texte: string): string => texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const scripts: Record<string, string> = {}
for (const [cle, fichier] of [['scriptLinux', 'linux.sh'], ['scriptMacos', 'macos.sh'], ['scriptWindows', 'windows.ps1'], ['scriptAndroid', 'android-termux.sh']] as const) {
  scripts[cle] = echapper((await readFile(resolve(racine, 'scripts/config-machine', fichier), 'utf8')).trimEnd())
}

for (const langue of LANGUES) {
  const autre = LANGUES.find((code) => code !== langue)!
  await mkdir(resolve(site, langue, 'banc'), { recursive: true })
  await writeFile(resolve(site, langue, 'index.html'), await remplirModele('demo/modele.html', { ...TEXTES[langue].page, langue, autreCode: autre }, langue))
  await writeFile(resolve(site, langue, 'banc', 'index.html'), await remplirModele('demo/banc/modele.html', { ...TEXTES_BANC[langue].page, ...scripts, langue, autreCode: autre }, langue))
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
console.log('✓ démo et banc construits dans site/ (fr, en)')
