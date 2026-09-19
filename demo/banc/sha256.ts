// SHA-256 spécialisé pour hashcash : l’entrée est `préfixe ‖ nonce (u32
// petit-boutiste)`. Les blocs complets du préfixe sont compressés une fois
// (état intermédiaire) ; seul le dernier bloc, qui porte le nonce, est
// recalculé à chaque essai, sans allocation ni aller-retour avec WebAssembly.
//
// Choix mesuré (Bun 1.4, portable x86-64) : hash-wasm, appelé une fois par
// empreinte, coûte ≈ 3,5 µs par empreinte, surtout en passages JavaScript ↔
// WebAssembly pour un message de 50 octets ; WebCrypto est asynchrone et plus
// lent encore (≈ 5 µs) ; cette boucle JavaScript descend bien en dessous (voir
// scripts/mesure et le banc). Le résultat est vérifié contre WebCrypto dans les tests.

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])
const INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]

/** Compresse le bloc de 16 mots gros-boutistes `mots[debut..debut+16)` dans `etat`. */
function compresser(etat: Int32Array, mots: Int32Array, debut: number, w: Int32Array): void {
  for (let i = 0; i < 16; i++) w[i] = mots[debut + i]!
  for (let i = 16; i < 64; i++) {
    const a = w[i - 15]!, b = w[i - 2]!
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
    w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0
  }
  let a = etat[0]!, b = etat[1]!, c = etat[2]!, d = etat[3]!, e = etat[4]!, f = etat[5]!, g = etat[6]!, h = etat[7]!
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
  }
  etat[0] = (etat[0]! + a) | 0; etat[1] = (etat[1]! + b) | 0; etat[2] = (etat[2]! + c) | 0; etat[3] = (etat[3]! + d) | 0
  etat[4] = (etat[4]! + e) | 0; etat[5] = (etat[5]! + f) | 0; etat[6] = (etat[6]! + g) | 0; etat[7] = (etat[7]! + h) | 0
}

function versMots(octets: Uint8Array): Int32Array {
  const mots = new Int32Array(octets.length / 4)
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength)
  for (let i = 0; i < mots.length; i++) mots[i] = vue.getInt32(i * 4)
  return mots
}

/**
 * Hacheur hashcash pour un préfixe donné. L’état intermédiaire couvre tous les
 * blocs avant celui où commence le nonce ; les mots des blocs restants sont
 * précalculés, et seuls les un ou deux mots qui portent le nonce changent.
 */
export function hacheurHashcash(prefixe: Uint8Array): { empreinte(nonce: number): Int32Array; zerosEnTete(nonce: number): number } {
  const longueur = prefixe.length + 4
  const totalBlocs = Math.ceil((longueur + 9) / 64)
  const message = new Uint8Array(totalBlocs * 64)
  message.set(prefixe)
  message[longueur] = 0x80
  const vue = new DataView(message.buffer)
  vue.setUint32(message.length - 8, Math.floor((longueur * 8) / 2 ** 32))
  vue.setUint32(message.length - 4, (longueur * 8) >>> 0)
  const premierBlocVariable = Math.floor(prefixe.length / 64)
  const w = new Int32Array(64)
  const intermediaire = new Int32Array(INITIAL)
  const tous = versMots(message)
  for (let bloc = 0; bloc < premierBlocVariable; bloc++) compresser(intermediaire, tous, bloc * 16, w)
  const fin = tous.slice(premierBlocVariable * 16)
  const blocsFinaux = totalBlocs - premierBlocVariable
  // Octets du nonce : position dans les mots finaux et décalage dans chaque mot.
  const position = prefixe.length - premierBlocVariable * 64
  const premierMot = position >> 2
  const decalage = position & 3
  const constantPremier = fin[premierMot]! & ~(decalage === 0 ? -1 : ((1 << (32 - 8 * decalage)) - 1))
  const constantSecond = decalage === 0 ? 0 : fin[premierMot + 1]! & ((1 << (32 - 8 * decalage)) - 1)
  const etat = new Int32Array(8)
  const empreinte = (nonce: number): Int32Array => {
    // Nonce petit-boutiste, lu en mots gros-boutistes.
    const gros = ((nonce & 0xff) << 24) | ((nonce & 0xff00) << 8) | ((nonce >>> 8) & 0xff00) | (nonce >>> 24)
    if (decalage === 0) fin[premierMot] = gros
    else {
      fin[premierMot] = constantPremier | (gros >>> (8 * decalage))
      fin[premierMot + 1] = (gros << (32 - 8 * decalage)) | constantSecond
    }
    etat.set(intermediaire)
    for (let bloc = 0; bloc < blocsFinaux; bloc++) compresser(etat, fin, bloc * 16, w)
    return etat
  }
  return {
    empreinte,
    /** Bits nuls en tête de l’empreinte (lue en gros-boutiste, comme hashcash). */
    zerosEnTete(nonce: number): number {
      const mots = empreinte(nonce)
      let zeros = 0
      for (let i = 0; i < 8; i++) {
        const mot = mots[i]!
        if (mot === 0) { zeros += 32; continue }
        return zeros + Math.clz32(mot)
      }
      return zeros
    },
  }
}
