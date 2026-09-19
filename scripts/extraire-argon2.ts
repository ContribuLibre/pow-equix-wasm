// Extrait de hash-wasm (version figée dans package.json) le module WebAssembly
// d’Argon2, que hash-wasm n’exporte pas, vers demo/banc/argon2-wasm.ts.
//
// hash-wasm instancie ce module à chaque appel d’argon2id() : une mémoire
// WebAssembly neuve de m Kio par empreinte, que le ramasse-miettes ne libère
// pas assez vite quand plusieurs Web Workers hachent en boucle (« Out of
// memory: Cannot allocate Wasm memory »). Le banc garde donc une instance par
// Web Worker et par réglage (demo/banc/argon2.ts). tests/banc.test.ts vérifie
// que le fichier extrait correspond toujours à hash-wasm.
//
//   bun scripts/extraire-argon2.ts

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const racine = resolve(import.meta.dirname, '..')

export function extraireArgon2(): { base64: string; empreinte: string; version: string } {
  const source = readFileSync(resolve(racine, 'node_modules/hash-wasm/dist/index.esm.js'), 'utf8')
  const trouve = source.match(/var name\$\w+ = "argon2";\nvar data\$\w+ = "([A-Za-z0-9+/=]+)";\nvar hash\$\w+ = "([0-9a-f]+)";/)
  if (!trouve) throw new Error('Module Argon2 introuvable dans hash-wasm : le format de sa distribution a changé')
  const version = (JSON.parse(readFileSync(resolve(racine, 'node_modules/hash-wasm/package.json'), 'utf8')) as { version: string }).version
  return { base64: trouve[1]!, empreinte: trouve[2]!, version }
}

export function contenuFichier(extrait: ReturnType<typeof extraireArgon2>): string {
  return `// Généré par scripts/extraire-argon2.ts depuis hash-wasm ${extrait.version} — ne pas modifier.
// Module WebAssembly d’Argon2 de hash-wasm (MIT, Dani Biró), non exporté par la bibliothèque.
export const VERSION_HASH_WASM = '${extrait.version}'
export const EMPREINTE_ARGON2 = '${extrait.empreinte}'
export const ARGON2_WASM_BASE64 = '${extrait.base64}'
`
}

if (import.meta.main) {
  const extrait = extraireArgon2()
  writeFileSync(resolve(racine, 'demo/banc/argon2-wasm.ts'), contenuFichier(extrait))
  console.log(`✓ demo/banc/argon2-wasm.ts (hash-wasm ${extrait.version}, ${extrait.empreinte})`)
}
