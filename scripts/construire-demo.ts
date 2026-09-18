// Construit la page de démo dans site/, publiée telle quelle sur GitHub Pages :
// la page, son script, sa feuille de style et le module equix.wasm du paquet.
//
//   bun scripts/construire-demo.ts   (après bun run build)

import { copyFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const racine = resolve(import.meta.dirname, '..')
const site = resolve(racine, 'site')
await rm(site, { recursive: true, force: true })
await mkdir(site, { recursive: true })
const resultat = await Bun.build({ entrypoints: [resolve(racine, 'demo/demo.ts')], outdir: site, target: 'browser', format: 'esm', minify: true, naming: 'demo.js' })
if (!resultat.success) {
  for (const message of resultat.logs) console.error(message)
  throw new Error('La construction de la démo a échoué')
}
await copyFile(resolve(racine, 'demo/index.html'), resolve(site, 'index.html'))
await copyFile(resolve(racine, 'demo/style.css'), resolve(site, 'style.css'))
await copyFile(resolve(racine, 'dist/equix.wasm'), resolve(site, 'equix.wasm'))
console.log('✓ démo construite dans site/')
