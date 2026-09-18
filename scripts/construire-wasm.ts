// Construit le module WebAssembly unique et ce que le paquet npm en publie :
//
//   dist/equix.wasm          le module, qui résout et vérifie ;
//   dist/octets.js (+ .d.ts) le même module en base64, pour une page ouverte en file:// ;
//   dist/empreinte.json      taille, SHA-256 et version de Rust qui l’a produit.
//
// La construction est reproductible : même version de Rust (rust-toolchain.toml),
// dépendances verrouillées (Cargo.lock, --locked) et chemins locaux effacés du
// binaire. `bun run verify:reproductible` le contrôle en reconstruisant ailleurs.
//
//   bun scripts/construire-wasm.ts [--dossier-cible <chemin>] [--sortie <dossier>]

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const NOM_MODULE = 'pow_equix_wasm.wasm'

export interface Empreinte {
  version: string
  rustc: string
  octets: number
  sha256: string
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
  const empreinte: Empreinte = { version, rustc: versionRustc(racine), octets: octets.length, sha256: sha256(octets) }
  await mkdir(sortie, { recursive: true })
  await writeFile(resolve(sortie, 'equix.wasm'), octets)
  await writeFile(resolve(sortie, 'octets.js'), moduleBase64(octets))
  await writeFile(resolve(sortie, 'octets.d.ts'), DECLARATIONS_BASE64)
  await writeFile(resolve(sortie, 'empreinte.json'), `${JSON.stringify(empreinte, null, 2)}\n`)
  console.log(`✓ equix.wasm : ${empreinte.octets} octets, sha256 ${empreinte.sha256} (${empreinte.rustc})`)
}
