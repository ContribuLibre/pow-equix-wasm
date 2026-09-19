// Argon2id réutilisable : une instance du module WebAssembly d’Argon2 de
// hash-wasm par réglage (mémoire m), et deux BLAKE2b gardés, au lieu d’en
// créer à chaque empreinte comme argon2id() de hash-wasm. Même algorithme que
// hash-wasm (argon2Internal, version 0x13), vérifié contre lui dans les tests.

import { type IHasher, createBLAKE2b } from 'hash-wasm'
import { ARGON2_WASM_BASE64 } from './argon2-wasm.ts'

interface ExportsArgon2 {
  memory: WebAssembly.Memory
  Hash_SetMemorySize(octets: number): number
  Hash_GetBuffer(): number
  Hash_Calculate(longueur: number, memoireKio: number): void
}

let module: Promise<WebAssembly.Module> | undefined

function moduleArgon2(): Promise<WebAssembly.Module> {
  module ??= WebAssembly.compile(Uint8Array.from(atob(ARGON2_WASM_BASE64), (caractere) => caractere.charCodeAt(0)))
  return module
}

const int32LE = (valeur: number): Uint8Array => {
  const octets = new Uint8Array(4)
  new DataView(octets.buffer).setUint32(0, valeur, true)
  return octets
}

export interface ReglageArgon2 { memoireKio: number; iterations: number; parallelisme: number; longueur?: number }

/** Un hacheur Argon2id pour un réglage : son module et ses BLAKE2b vivent aussi longtemps que lui. */
export interface HacheurArgon2 {
  reglage: ReglageArgon2
  hacher(motDePasse: Uint8Array, sel: Uint8Array): Uint8Array
}

/** Crée un hacheur ; le module WebAssembly est compilé une fois par contexte, instancié une fois par hacheur. */
export async function hacheurArgon2id(reglage: ReglageArgon2): Promise<HacheurArgon2> {
  const longueur = reglage.longueur ?? 32
  const instance = await WebAssembly.instantiate(await moduleArgon2(), {})
  const exports = instance.exports as unknown as ExportsArgon2
  const blake512: IHasher = await createBLAKE2b(512)
  const blakeFinal: IHasher = longueur === 64 ? blake512 : await createBLAKE2b(longueur * 8)
  exports.Hash_GetBuffer()
  // Le module réserve déjà 512 Kio ; en demander moins ferait déborder sa soustraction non signée.
  if (exports.Hash_SetMemorySize(Math.max(512 * 1024, reglage.memoireKio * 1024 + 1024)) === -1) throw new Error(`Argon2 : impossible de réserver ${reglage.memoireKio} Kio`)
  const vue = (): Uint8Array => new Uint8Array(exports.memory.buffer, exports.Hash_GetBuffer(), reglage.memoireKio * 1024 + 1024)

  /** H' d’Argon2 (hashFunc de hash-wasm) pour 1024 octets ou pour la sortie finale. */
  const hPrime = (entree: Uint8Array, taille: number): Uint8Array => {
    if (taille <= 64) {
      const blake = taille === longueur ? blakeFinal : undefined
      if (!blake) throw new Error('Argon2 : taille de sortie inattendue')
      blake.init()
      blake.update(int32LE(taille))
      blake.update(entree)
      return blake.digest('binary')
    }
    const r = Math.ceil(taille / 32) - 2
    const sortie = new Uint8Array(taille)
    blake512.init()
    blake512.update(int32LE(taille))
    blake512.update(entree)
    let v = blake512.digest('binary')
    sortie.set(v.subarray(0, 32), 0)
    for (let rang = 1; rang < r; rang++) {
      blake512.init()
      blake512.update(v)
      v = blake512.digest('binary')
      sortie.set(v.subarray(0, 32), rang * 32)
    }
    // 1024 octets : il reste exactement 64 octets, produits par le même BLAKE2b-512.
    blake512.init()
    blake512.update(v)
    sortie.set(blake512.digest('binary').subarray(0, taille - 32 * r), r * 32)
    return sortie
  }

  return {
    reglage,
    hacher(motDePasse, sel) {
      const { memoireKio, iterations, parallelisme } = reglage
      const init = new Uint8Array(24)
      const vueInit = new DataView(init.buffer)
      for (const [rang, valeur] of [parallelisme, longueur, memoireKio, iterations, 0x13, 2].entries()) vueInit.setInt32(rang * 4, valeur, true)
      const memoire = vue()
      // Le module d’Argon2 combine chaque bloc par XOR avec son contenu : il suppose
      // une mémoire neuve, donc nulle. Une instance réutilisée doit la remettre à zéro.
      memoire.fill(0, 0, memoireKio * 1024)
      memoire.set(init, memoireKio * 1024)
      blake512.init()
      blake512.update(init)
      blake512.update(int32LE(motDePasse.length))
      blake512.update(motDePasse)
      blake512.update(int32LE(sel.length))
      blake512.update(sel)
      blake512.update(int32LE(0)) // secret
      blake512.update(int32LE(0)) // données associées
      const h0 = blake512.digest('binary')
      const parametre = new Uint8Array(72)
      parametre.set(h0)
      const segments = Math.floor(memoireKio / (parallelisme * 4))
      const voie = segments * 4
      for (let rangVoie = 0; rangVoie < parallelisme; rangVoie++) {
        parametre.set(int32LE(0), 64)
        parametre.set(int32LE(rangVoie), 68)
        memoire.set(hPrime(parametre, 1024), rangVoie * voie * 1024)
        parametre.set(int32LE(1), 64)
        memoire.set(hPrime(parametre, 1024), (rangVoie * voie + 1) * 1024)
      }
      exports.Hash_Calculate(0, memoireKio)
      // Le bloc final (1024 octets) est écrit au début du tampon.
      return hPrime(vue().slice(0, 1024), longueur)
    },
  }
}
