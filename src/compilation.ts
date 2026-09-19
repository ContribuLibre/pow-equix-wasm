/**
 * Compilation des programmes HashX en WebAssembly, dans le navigateur.
 *
 * En natif, HashX compile chaque programme en code machine ; le module Equi-X,
 * lui, l’interprète. Pour réduire cet écart, le chargeur génère ici, pour chaque
 * défi, un petit module WebAssembly qui évalue le programme sur tous les indices
 * et écrit la table des valeurs directement dans la mémoire du solveur, qu’il
 * importe. Le solveur Rust cherche ensuite les collisions dans cette table.
 *
 * Le module généré n’exporte qu’une fonction, `remplir(debut, fin)`, qui écrit
 * les valeurs des indices `debut` à `fin − 1` :
 *
 * - registres initiaux : SipHash 2-4 en mode compteur (clé du programme) ;
 * - programme : instructions 64 bits de HashX ; la moitié haute des
 *   multiplications 64 × 64 est reconstituée à partir de quatre produits
 *   32 × 32, WebAssembly n’ayant pas de multiplication 128 bits ; le
 *   branchement unique de HashX devient une boucle par cible ;
 * - sortie : condensation des registres (un tour SipHash sur chaque moitié),
 *   premier mot à l’adresse basse, bits hauts du second (n > 64) à l’adresse haute.
 *
 * Aucun `eval` : seule la compilation WebAssembly est demandée, que la politique
 * `script-src 'self' 'wasm-unsafe-eval'` autorise.
 *
 * `genererModuleHashx` ne référence rien d’extérieur : sa source est transmise
 * telle quelle aux Web Workers (`toString`), comme le moteur JavaScript.
 */

/** Taille de l’en-tête écrit par `preparer`, avant le programme encodé. */
export const TAILLE_ENTETE_PROGRAMME = 48
/** Taille du programme encodé : 512 instructions de 8 octets (voir crates/hashx/src/expose.rs). */
export const TAILLE_PROGRAMME = 512 * 8
/** Description complète d’un essai préparé : en-tête puis programme. */
export const TAILLE_DESCRIPTION = TAILLE_ENTETE_PROGRAMME + TAILLE_PROGRAMME

/**
 * Octets du module WebAssembly qui remplit la table d’un essai, d’après sa
 * description (en-tête et programme écrits par `preparer`).
 */
export function genererModuleHashx(description: Uint8Array): Uint8Array<ArrayBuffer> {
  const vue = new DataView(description.buffer, description.byteOffset, description.byteLength)
  const n = vue.getUint32(0, true)
  const adresseBasse = vue.getUint32(8, true)
  const adresseHaute = vue.getUint32(12, true)
  const cle = [0, 1, 2, 3].map((rang) => vue.getBigUint64(16 + rang * 8, true))
  const [k0, k1, k2, k3] = cle as [bigint, bigint, bigint, bigint]
  // Répété ici (TAILLE_ENTETE_PROGRAMME) : la fonction ne doit rien référencer d’extérieur.
  const ENTETE = 48

  // Variables locales : paramètres (debut, fin), trois i32, puis les i64.
  const FIN = 1, ELEMENT = 2, MULH = 3, PERMIS = 4
  const R = 5 // r0 à r7 : registres HashX (aussi état SipHash initial)
  const V = 13 // v0 à v3 : première moitié de la condensation
  const T = 17 // t0 à t3 : seconde moitié
  const ENTREE = 21
  const [ALO, AHI, BLO, BHI, LH, HL] = [22, 23, 24, 25, 26, 27]
  const LOCAUX_I64 = 23

  const code: number[] = []
  const emettre = (...octets: number[]): void => { for (const octet of octets) code.push(octet) }
  const uleb = (valeur: number): number[] => {
    const octets: number[] = []
    do {
      let octet = valeur & 0x7f
      valeur = Math.floor(valeur / 128)
      if (valeur !== 0) octet |= 0x80
      octets.push(octet)
    } while (valeur !== 0)
    return octets
  }
  const sleb = (valeur: bigint): number[] => {
    const octets: number[] = []
    let reste = BigInt.asIntN(64, valeur)
    for (;;) {
      const octet = Number(reste & 0x7fn)
      reste >>= 7n
      if ((reste === 0n && (octet & 0x40) === 0) || (reste === -1n && (octet & 0x40) !== 0)) {
        octets.push(octet)
        return octets
      }
      octets.push(octet | 0x80)
    }
  }
  const lire = (local: number): void => emettre(0x20, ...uleb(local))
  const ecrire = (local: number): void => emettre(0x21, ...uleb(local))
  const constante64 = (valeur: bigint): void => emettre(0x42, ...sleb(valeur))
  const constante32 = (valeur: number): void => emettre(0x41, ...sleb(BigInt(valeur | 0)))
  const [ADD, SUB, MUL, AND, XOR, SHL, SHR_S, SHR_U, ROTL, ROTR] = [0x7c, 0x7d, 0x7e, 0x83, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a]
  /** `local = local ⊕ (autre)` où l’opérande est déjà émis par `operande`. */
  const appliquer = (local: number, operation: number, operande: () => void): void => {
    lire(local)
    operande()
    emettre(operation)
    ecrire(local)
  }
  const tourner = (local: number, bits: number): void => appliquer(local, ROTL, () => constante64(BigInt(bits)))
  const ajouter = (local: number, autre: number): void => appliquer(local, ADD, () => lire(autre))
  const xor = (local: number, autre: number): void => appliquer(local, XOR, () => lire(autre))
  const tourSip = (v: number): void => {
    ajouter(v, v + 1); ajouter(v + 2, v + 3); tourner(v + 1, 13); tourner(v + 3, 16); xor(v + 1, v); xor(v + 3, v + 2)
    tourner(v, 32); ajouter(v + 2, v + 1); ajouter(v, v + 3); tourner(v + 1, 17); tourner(v + 3, 21); xor(v + 1, v + 2); xor(v + 3, v)
    tourner(v + 2, 32)
  }
  const MASQUE32 = 0xffff_ffffn
  /** Moitié haute non signée de `a × b`, laissée sur la pile. */
  const moitieHauteNonSignee = (a: number, b: number): void => {
    lire(a); constante64(MASQUE32); emettre(AND); ecrire(ALO)
    lire(a); constante64(32n); emettre(SHR_U); ecrire(AHI)
    lire(b); constante64(MASQUE32); emettre(AND); ecrire(BLO)
    lire(b); constante64(32n); emettre(SHR_U); ecrire(BHI)
    lire(ALO); lire(BHI); emettre(MUL); ecrire(LH)
    lire(AHI); lire(BLO); emettre(MUL); ecrire(HL)
    // Retenue du milieu : (alo·blo >> 32) + bas(lh) + bas(hl), sur au plus 34 bits.
    lire(ALO); lire(BLO); emettre(MUL); constante64(32n); emettre(SHR_U)
    lire(LH); constante64(MASQUE32); emettre(AND, ADD)
    lire(HL); constante64(MASQUE32); emettre(AND, ADD)
    constante64(32n); emettre(SHR_U)
    lire(AHI); lire(BHI); emettre(MUL, ADD)
    lire(LH); constante64(32n); emettre(SHR_U, ADD)
    lire(HL); constante64(32n); emettre(SHR_U, ADD)
  }

  // Boucle sur les éléments : block $sortie { loop $elements { … } }.
  lire(0); ecrire(ELEMENT)
  emettre(0x02, 0x40, 0x03, 0x40)
  lire(ELEMENT); lire(FIN); emettre(0x4f, 0x0d, 1) // i32.ge_u ; br_if $sortie
  lire(ELEMENT); emettre(0xad); ecrire(ENTREE) // i64.extend_i32_u

  // SipHash 2-4 en mode compteur : s dans r0..r3, puis t dans r4..r7.
  constante64(k0); ecrire(R)
  constante64(k1 ^ 0xeen); ecrire(R + 1)
  constante64(k2); ecrire(R + 2)
  constante64(k3); lire(ENTREE); emettre(XOR); ecrire(R + 3)
  tourSip(R); tourSip(R)
  xor(R, ENTREE)
  appliquer(R + 2, XOR, () => constante64(0xeen))
  for (let tour = 0; tour < 4; tour++) tourSip(R)
  lire(R); ecrire(R + 4)
  lire(R + 1); constante64(0xddn); emettre(XOR); ecrire(R + 5)
  lire(R + 2); ecrire(R + 6)
  lire(R + 3); ecrire(R + 7)
  for (let tour = 0; tour < 4; tour++) tourSip(R + 4)

  // Programme HashX.
  constante32(0); ecrire(MULH)
  constante32(1); ecrire(PERMIS)
  let boucleOuverte = false
  for (let rang = 0; rang < 512; rang++) {
    const base = ENTETE + rang * 8
    const operation = description[base]!
    const dst = R + description[base + 1]!
    const src = R + description[base + 2]!
    const parametre = description[base + 3]!
    const constante = vue.getUint32(base + 4, true)
    const etendue = BigInt(constante | 0)
    switch (operation) {
      case 0: appliquer(dst, MUL, () => lire(src)); break // Mul
      case 1: case 2: // UMulH, SMulH
        moitieHauteNonSignee(dst, src)
        if (operation === 2) {
          // Signé : retrancher b si a < 0, et a si b < 0 (modulo 2⁶⁴).
          lire(dst); constante64(63n); emettre(SHR_S); lire(src); emettre(AND, SUB)
          lire(src); constante64(63n); emettre(SHR_S); lire(dst); emettre(AND, SUB)
        }
        emettre(0x22, ...uleb(dst), 0xa7) // local.tee ; i32.wrap_i64
        ecrire(MULH)
        break
      case 3: appliquer(dst, ADD, () => { lire(src); constante64(BigInt(parametre)); emettre(SHL) }); break // AddShift
      case 4: appliquer(dst, ADD, () => constante64(etendue)); break // AddConst
      case 5: appliquer(dst, SUB, () => lire(src)); break // Sub
      case 6: appliquer(dst, XOR, () => lire(src)); break // Xor
      case 7: appliquer(dst, XOR, () => constante64(etendue)); break // XorConst
      case 8: appliquer(dst, ROTR, () => constante64(BigInt(parametre))); break // Rotate
      case 9: // Target : une boucle jusqu’à la cible suivante
        if (boucleOuverte) emettre(0x0b)
        emettre(0x03, 0x40)
        boucleOuverte = true
        break
      case 10: // Branch : une seule fois par évaluation, vers la dernière cible
        if (!boucleOuverte) throw new Error('Programme HashX invalide : branchement sans cible.')
        lire(PERMIS); lire(MULH); constante32(constante); emettre(0x71, 0x45, 0x71) // i32.and ; i32.eqz ; i32.and
        emettre(0x04, 0x40) // if
        constante32(0); ecrire(PERMIS)
        emettre(0x0c, 1, 0x0b) // br $cible ; end
        break
      default: throw new Error(`Programme HashX invalide : instruction ${operation}.`)
    }
  }
  if (boucleOuverte) emettre(0x0b)

  // Condensation : (r0 + k0, r1 + k1, r2, r3) et (r4, r5, r6 + k2, r7 + k3), un tour chacun.
  lire(R); constante64(k0); emettre(ADD); ecrire(V)
  lire(R + 1); constante64(k1); emettre(ADD); ecrire(V + 1)
  lire(R + 2); ecrire(V + 2)
  lire(R + 3); ecrire(V + 3)
  lire(R + 4); ecrire(T)
  lire(R + 5); ecrire(T + 1)
  lire(R + 6); constante64(k2); emettre(ADD); ecrire(T + 2)
  lire(R + 7); constante64(k3); emettre(ADD); ecrire(T + 3)
  tourSip(V); tourSip(T)
  // Premier mot : table basse, un u64 par élément.
  lire(ELEMENT); constante32(3); emettre(0x74) // i32.shl
  lire(V); lire(T); emettre(XOR)
  emettre(0x37, 3, ...uleb(adresseBasse)) // i64.store align=8 offset=adresseBasse
  if (n > 64) {
    // Bits hauts : les n − 64 premiers bits du second mot, un u32 par élément.
    lire(ELEMENT); constante32(2); emettre(0x74)
    lire(V + 1); lire(T + 1); emettre(XOR); constante64((1n << BigInt(n - 64)) - 1n); emettre(AND, 0xa7)
    emettre(0x36, 2, ...uleb(adresseHaute)) // i32.store align=4 offset=adresseHaute
  }
  lire(ELEMENT); constante32(1); emettre(0x6a); ecrire(ELEMENT) // i32.add
  emettre(0x0c, 0, 0x0b, 0x0b, 0x0b) // br $elements ; end loop ; end block ; end func

  const texte = (chaine: string): number[] => [...uleb(chaine.length), ...Array.from(chaine, (caractere) => caractere.charCodeAt(0))]
  const section = (identifiant: number, contenu: number[]): number[] => [identifiant, ...uleb(contenu.length), ...contenu]
  const corps = [2, 3, 0x7f, LOCAUX_I64, 0x7e, ...code]
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [1, 0x60, 2, 0x7f, 0x7f, 0]), // type : (i32, i32) → ()
    ...section(2, [1, ...texte('e'), ...texte('m'), 0x02, 0x00, 0x00]), // import de la mémoire
    ...section(3, [1, 0]),
    ...section(7, [1, ...texte('remplir'), 0x00, 0]),
    ...section(10, [1, ...uleb(corps.length), ...corps]),
  ])
}
