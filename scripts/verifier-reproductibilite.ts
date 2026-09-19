// Vérifie que le module WebAssembly se reproduit à l’octet près : il est
// reconstruit (puis retraduit en JavaScript) depuis une copie des sources placée ailleurs, avec son propre
// dossier de compilation, puis comparé à dist/equix.wasm.
//
// Avec --attendu <sha256>, compare aussi à une empreinte publiée (celle d’une
// version npm ou d’une release GitHub) : n’importe qui peut ainsi vérifier que
// le module distribué sort bien de ces sources.
//
//   bun scripts/verifier-reproductibilite.ts [--attendu <sha256>]

import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { construireModule, sha256, traduireEnJs } from './construire-wasm.ts'

const racine = resolve(import.meta.dirname, '..')
const index = process.argv.indexOf('--attendu')
const attendu = index >= 0 ? process.argv[index + 1] : undefined
const reference = sha256(new Uint8Array(await readFile(resolve(racine, 'dist/equix.wasm'))))
const referenceJs = sha256(new Uint8Array(await readFile(resolve(racine, 'dist/equix-js.js'))))

const copie = await mkdtemp(join(tmpdir(), 'pow-equix-wasm-'))
try {
  for (const entree of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'crates']) {
    await cp(resolve(racine, entree), join(copie, entree), { recursive: true })
  }
  const module = construireModule(copie, join(copie, 'cible'))
  const reconstruit = sha256(module)
  if (reconstruit !== reference) throw new Error(`Construction non reproductible : dist/equix.wasm ${reference}, reconstruction ailleurs ${reconstruit}`)
  // La traduction JavaScript se reproduit aussi, avec la même version de binaryen.
  const js = sha256(new TextEncoder().encode(traduireEnJs(racine, module, join(copie, 'js'))))
  if (js !== referenceJs) throw new Error(`Traduction JavaScript non reproductible : dist/equix-js.js ${referenceJs}, retraduction ${js}`)
  if (attendu && attendu !== reference) throw new Error(`Empreinte différente de celle attendue : ${attendu}, obtenue ${reference}`)
  console.log(`✓ construction reproductible (equix.wasm ${reference}, equix-js.js ${referenceJs}${attendu ? ', conforme à l’empreinte attendue' : ''})`)
} finally {
  await rm(copie, { recursive: true, force: true })
}
