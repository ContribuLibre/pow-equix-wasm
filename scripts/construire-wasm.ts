// Construit le module WebAssembly unique et ce que le paquet npm en publie :
//
//   dist/equix.wasm          le module, qui résout et vérifie ;
//   dist/octets.js (+ .d.ts) le même module en base64, pour une page ouverte en file:// ;
//   dist/equix-js.js         le même module traduit en JavaScript pur par wasm2js
//                            (binaryen), pour les navigateurs sans WebAssembly ;
//   dist/empreinte.json      tailles, SHA-256 et outils qui les ont produits.
//
// La construction est reproductible : même version de Rust (rust-toolchain.toml),
// dépendances verrouillées (Cargo.lock, --locked) et chemins locaux effacés du
// binaire. `bun run verify:reproductible` le contrôle en reconstruisant ailleurs.
//
//   bun scripts/construire-wasm.ts [--dossier-cible <chemin>] [--sortie <dossier>]

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const NOM_MODULE = 'pow_equix_wasm.wasm'

export interface Empreinte {
  version: string
  rustc: string
  octets: number
  sha256: string
  /** Traduction JavaScript du même module, pour les environnements sans WebAssembly. */
  js: { binaryen: string; octets: number; sha256: string }
}

/** Version de binaryen figée par package.json : wasm2js produit alors le même JavaScript. */
function versionBinaryen(racine: string): string {
  return (JSON.parse(readFileSync(resolve(racine, 'node_modules/binaryen/package.json'), 'utf8')) as { version: string }).version
}

/**
 * Traduit le module en JavaScript pur, sans WebAssembly. Le résultat est une
 * fonction autonome, `creerExportsEquixJs()`, qui renvoie les mêmes exports que
 * le module : elle ne référence rien d’extérieur, si bien qu’elle se transmet
 * aussi aux Web Workers par sa propre source (`toString`), sans `eval`.
 */
export function traduireEnJs(racine: string, octets: Uint8Array, dossierTravail: string): string {
  const entree = resolve(dossierTravail, 'equix.wasm')
  const sortie = resolve(dossierTravail, 'equix-wasm2js.mjs')
  mkdirSync(dossierTravail, { recursive: true })
  writeFileSync(entree, octets)
  const resultat = spawnSync('bun', ['--bun', resolve(racine, 'node_modules/binaryen/bin/wasm2js'), entree,
    // Extensions WebAssembly qu’emploie rustc pour cette cible.
    '--enable-bulk-memory', '--enable-bulk-memory-opt', '--enable-nontrapping-float-to-int', '--enable-sign-ext', '--enable-mutable-globals', '--enable-multivalue', '--enable-reference-types',
    '-O3', '-o', sortie], { cwd: racine, stdio: ['ignore', 'inherit', 'inherit'] })
  if (resultat.status !== 0) throw new Error('La traduction JavaScript du module (wasm2js) a échoué')
  const code = readFileSync(sortie, 'utf8')
  const exports = [...code.matchAll(/^export var (\w+) = retasmFunc\.\1;$/gm)]
  if (!exports.some((ligne) => ligne[1] === 'essayer') || !exports.some((ligne) => ligne[1] === 'verifier')) throw new Error('Sortie de wasm2js inattendue : exports introuvables')
  const corps = code.replace(/^export var \w+ = retasmFunc\.\w+;\n?/gm, '')
  if (/^export /m.test(corps) || /\bimport\b\s*[({'"]/.test(corps)) throw new Error('Sortie de wasm2js inattendue : export ou import résiduel')
  return `// Généré par scripts/construire-wasm.ts depuis equix.wasm avec wasm2js — ne pas modifier.
// Le module Equi-X en JavaScript pur, pour les navigateurs où WebAssembly est désactivé.
// Environ 4 à 9 fois plus lent que WebAssembly avec JIT, et près de 200 fois sans JIT.

/** Crée une instance du module traduit : mêmes exports que equix.wasm. */
export function creerExportsEquixJs() {
${corps}
return retasmFunc
}
`
}

export function sha256(octets: Uint8Array): string {
  return createHash('sha256').update(octets).digest('hex')
}

function versionRustc(racine: string): string {
  const resultat = spawnSync('rustc', ['--version'], { cwd: racine, encoding: 'utf8' })
  if (resultat.status !== 0) throw new Error('rustc est introuvable : installe Rust (rustup), la version de rust-toolchain.toml s’installe seule')
  return resultat.stdout.trim()
}

/** Construit le module depuis `racine` et renvoie ses octets, sans chemin local dans le binaire. */
export function construireModule(racine: string, dossierCible = resolve(racine, 'target')): Uint8Array {
  // rustc retient le dernier préfixe qui s’applique : du plus général au plus précis.
  const drapeaux = [
    `--remap-path-prefix=${homedir()}=/home`,
    `--remap-path-prefix=${process.env.CARGO_HOME ?? resolve(homedir(), '.cargo')}=/cargo`,
    `--remap-path-prefix=${process.env.RUSTUP_HOME ?? resolve(homedir(), '.rustup')}=/rustup`,
    `--remap-path-prefix=${racine}=/pow-equix-wasm`,
  ].join('\x1f')
  const resultat = spawnSync('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown', '-p', 'pow-equix-wasm'], {
    cwd: racine,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: drapeaux, CARGO_TARGET_DIR: dossierCible, CARGO_INCREMENTAL: '0', SOURCE_DATE_EPOCH: '0' },
  })
  if (resultat.status !== 0) throw new Error('La construction du module WebAssembly a échoué')
  return new Uint8Array(readFileSync(resolve(dossierCible, 'wasm32-unknown-unknown/release', NOM_MODULE)))
}

function moduleBase64(octets: Uint8Array): string {
  return `// Généré par scripts/construire-wasm.ts — ne pas modifier.
// Le module Equi-X intégré en base64 : utile quand rien ne peut être téléchargé
// (page ouverte en file://, script unique). Ailleurs, préférer pow-equix-wasm/equix.wasm.
const BASE64 = '${Buffer.from(octets).toString('base64')}'

/** Octets du module Equi-X, décodés à chaque appel (une copie neuve). */
export function octetsEquix() {
  const binaire = atob(BASE64)
  const octets = new Uint8Array(binaire.length)
  for (let index = 0; index < binaire.length; index++) octets[index] = binaire.charCodeAt(index)
  return octets
}

export const SHA256_EQUIX = '${sha256(octets)}'
`
}

const DECLARATIONS_JS = `import type { ExportsEquix } from './index.js'
/** Crée une instance du module traduit en JavaScript : mêmes exports que equix.wasm. */
export declare function creerExportsEquixJs(): ExportsEquix
`

const DECLARATIONS_BASE64 = `/** Octets du module Equi-X, décodés à chaque appel (une copie neuve). */
export declare function octetsEquix(): Uint8Array
/** Empreinte SHA-256 du module intégré. */
export declare const SHA256_EQUIX: string
`

if (import.meta.main) {
  const racine = resolve(import.meta.dirname, '..')
  const argument = (nom: string): string | undefined => {
    const index = process.argv.indexOf(nom)
    return index >= 0 ? process.argv[index + 1] : undefined
  }
  const sortie = resolve(racine, argument('--sortie') ?? 'dist')
  const octets = construireModule(racine, argument('--dossier-cible') ? resolve(argument('--dossier-cible')!) : undefined)
  const version = (JSON.parse(await readFile(resolve(racine, 'package.json'), 'utf8')) as { version: string }).version
  const js = new TextEncoder().encode(traduireEnJs(racine, octets, resolve(racine, '.construction')))
  const empreinte: Empreinte = {
    version, rustc: versionRustc(racine), octets: octets.length, sha256: sha256(octets),
    js: { binaryen: versionBinaryen(racine), octets: js.length, sha256: sha256(js) },
  }
  await mkdir(sortie, { recursive: true })
  await writeFile(resolve(sortie, 'equix-js.js'), js)
  await writeFile(resolve(sortie, 'equix-js.d.ts'), DECLARATIONS_JS)
  await writeFile(resolve(sortie, 'equix.wasm'), octets)
  await writeFile(resolve(sortie, 'octets.js'), moduleBase64(octets))
  await writeFile(resolve(sortie, 'octets.d.ts'), DECLARATIONS_BASE64)
  await writeFile(resolve(sortie, 'empreinte.json'), `${JSON.stringify(empreinte, null, 2)}\n`)
  console.log(`✓ equix.wasm : ${empreinte.octets} octets, sha256 ${empreinte.sha256} (${empreinte.rustc})`)
  console.log(`✓ equix-js.js : ${empreinte.js.octets} octets, sha256 ${empreinte.js.sha256} (binaryen ${empreinte.js.binaryen})`)
}
