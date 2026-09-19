// Mesure le temps d’un essai (HashX interprété ou compilé en WebAssembly), sa
// décomposition, la vérification et la mémoire réelle du module, pour chaque n.
//
//   bun scripts/mesurer.ts [--n 60,64] [--essais-compile 40] [--essais-interprete 8]
//   bun scripts/mesurer.ts --navigateur [chemin de chromium]   (Chromium sans interface)
//
// Après `bun run build:wasm`. En mode navigateur, la page de mesure est servie
// en local et Chromium renvoie ses résultats au serveur au fil de l’eau.

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { type LigneMesure, mesurer } from './mesure/banc.ts'

const racine = resolve(import.meta.dirname, '..')
const argument = (nom: string): string | undefined => {
  const index = process.argv.indexOf(nom)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const plan = {
  n: (argument('--n') ?? '60,64,68,72,76,80').split(',').map(Number),
  essaisCompile: Number(argument('--essais-compile') ?? 40),
  essaisInterprete: Number(argument('--essais-interprete') ?? 8),
  tranches: (argument('--tranches') ?? '2048,65536,512').split(',').map(Number),
}

const mio = (octets: number): string => (octets / 1024 / 1024).toFixed(1)
const ms = (valeur: number | undefined): string => (valeur === undefined ? '' : valeur.toFixed(valeur < 10 ? 2 : 1))
function afficher(ligne: LigneMesure): void {
  const detail = ligne.remplissageMs === undefined ? ''
    : ` [préparation ${ms(ligne.preparationMs)}, génération ${ms(ligne.generationMs)}, compilation ${ms(ligne.compilationMs)}, remplissage ${ms(ligne.remplissageMs)}, recherche ${ms(ligne.rechercheMs)} ; module ${ligne.octetsModule} octets ; tranche ${ligne.tranche}]`
  const solutions = ligne.solutionsParDefi === undefined ? '' : `, ${(ligne.solutionsParDefi * 100).toFixed(0)} % d’essais aboutis`
  const verification = ligne.verificationMsParPart === undefined ? '' : `, vérification ${ms(ligne.verificationMsParPart)} ms/part`
  console.log(`n = ${ligne.n} ${ligne.mode} : ${ms(ligne.msParEssai)} ms/essai sur ${ligne.essais} essais${solutions}${verification}, mémoire du module ${mio(ligne.memoireModuleOctets)} Mio${detail}`)
}

const octets = new Uint8Array(await readFile(resolve(racine, 'dist/equix.wasm')))
if (!process.argv.includes('--navigateur')) {
  console.log(`Bun ${Bun.version}`)
  await mesurer(octets, plan, afficher)
} else {
  const chromium = argument('--navigateur') && !argument('--navigateur')!.startsWith('--') ? argument('--navigateur')! : 'chromium'
  const dossier = await mkdtemp(join(tmpdir(), 'pow-equix-mesure-'))
  const construction = await Bun.build({ entrypoints: [resolve(racine, 'scripts/mesure/page.ts')], outdir: dossier, target: 'browser', format: 'esm' })
  if (!construction.success) throw new Error(construction.logs.join('\n'))
  let finir: () => void = () => {}
  const termine = new Promise<void>((resolve) => { finir = resolve })
  const serveur = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(requete) {
      const chemin = new URL(requete.url).pathname
      if (chemin === '/') return new Response('<!doctype html><meta charset="utf-8"><script type="module" src="/page.js"></script>', { headers: { 'content-type': 'text/html' } })
      if (chemin === '/page.js') return new Response(Bun.file(join(dossier, 'page.js')), { headers: { 'content-type': 'text/javascript' } })
      if (chemin === '/equix.wasm') return new Response(octets, { headers: { 'content-type': 'application/wasm' } })
      if (chemin === '/resultat') {
        const message = await requete.json() as { navigateur?: string; ligne?: LigneMesure; fin?: boolean; erreur?: string }
        if (message.navigateur) console.log(message.navigateur)
        if (message.ligne) afficher(message.ligne)
        if (message.erreur) console.error(`Erreur dans le navigateur : ${message.erreur}`)
        if (message.fin || message.erreur) finir()
        return new Response('ok')
      }
      return new Response('Introuvable', { status: 404 })
    },
  })
  const requete = new URLSearchParams({ n: plan.n.join(','), essaisCompile: String(plan.essaisCompile), essaisInterprete: String(plan.essaisInterprete), tranches: plan.tranches.join(',') })
  const navigateur = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(dossier, 'profil')}`, `http://127.0.0.1:${serveur.port}/?${requete}`], { stdio: 'ignore' })
  try {
    await termine
  } finally {
    navigateur.kill()
    serveur.stop(true)
    await rm(dossier, { recursive: true, force: true })
  }
}
