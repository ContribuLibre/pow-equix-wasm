// Tests du paquet construit (`bun run build` d’abord) : ils importent dist/ comme
// le ferait un projet qui dépend de pow-equix-wasm.

import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ECART_MAX, GRAINE_MAX, ModuleEquix, N_VALIDES, REFERENCE_MS_PAR_ESSAI, VERSION_FORMAT, construireGraine, depuisHexadecimal, encoderPreuve, essaisAttendus, estimerDuree,
  executionPrevue, genererModuleHashx, hexadecimal, memoirePourN, moteurRetenu, msParEssai, nPourMemoire, probabiliteEssai, ralentissement, resoudre,
  SEUILS_FILS_ADAPTATIFS, type EtatFils, filsAdaptatifs, tailleMaxPreuve, taillePreuve, tailleSolution, travailleurEquix, webAssemblyDisponible,
} from '../dist/index.js'
import { creerExportsEquixJs } from '../dist/equix-js.js'
import { SHA256_EQUIX, octetsEquix } from '../dist/octets.js'

const octets = new Uint8Array(readFileSync(resolve(import.meta.dir, '../dist/equix.wasm')))
const empreinte = JSON.parse(readFileSync(resolve(import.meta.dir, '../dist/empreinte.json'), 'utf8')) as { sha256: string; octets: number; js: { sha256: string; octets: number } }
const graine = await construireGraine('pow-equix-wasm/test', '{"message":"bonjour"}')

describe('module publié', () => {
  test('le module intégré en base64 est celui du fichier, et l’empreinte les décrit', () => {
    const sha = createHash('sha256').update(octets).digest('hex')
    expect(empreinte.sha256).toBe(sha)
    expect(empreinte.octets).toBe(octets.length)
    expect(SHA256_EQUIX).toBe(sha)
    expect(octetsEquix()).toEqual(octets)
    const js = readFileSync(resolve(import.meta.dir, '../dist/equix-js.js'))
    expect(empreinte.js.sha256).toBe(createHash('sha256').update(js).digest('hex'))
    expect(empreinte.js.octets).toBe(js.length)
  })

  test('accepte un module dont la mémoire vient d’un autre contexte JavaScript', async () => {
    // Comme sous jsdom ou dans une iframe : un ArrayBuffer d’un autre contexte échoue à `instanceof`.
    const { runInNewContext } = await import('node:vm')
    const exports = creerExportsEquixJs()
    const etranger = { ...exports, memory: { get buffer() { return runInNewContext('new ArrayBuffer(8)') } } }
    expect(etranger.memory.buffer instanceof ArrayBuffer).toBe(false)
    expect(() => ModuleEquix.depuisJs(() => etranger)).not.toThrow()
  })

  test('refuse un module qui n’est pas celui d’Equi-X', async () => {
    await expect(ModuleEquix.instancier(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]))).rejects.toThrow('Module Equi-X invalide.')
  })
})

describe('graine', () => {
  test('réunit le domaine, un octet nul et l’empreinte SHA-256 du contenu', () => {
    const domaine = new TextEncoder().encode('pow-equix-wasm/test')
    expect(graine.length).toBe(domaine.length + 1 + 32)
    expect(graine.slice(0, domaine.length)).toEqual(domaine)
    expect(graine[domaine.length]).toBe(0)
    expect(hexadecimal(graine.slice(domaine.length + 1))).toBe(createHash('sha256').update('{"message":"bonjour"}').digest('hex'))
  })

  test('refuse un domaine qui ferait dépasser la taille maximale', async () => {
    await expect(construireGraine('x'.repeat(GRAINE_MAX), '')).rejects.toThrow('Domaine trop long')
  })
})

describe('résolution et vérification', () => {
  test('une preuve résolue sur le fil courant se vérifie, une altération non', async () => {
    const { parts, essais, fils } = await resoudre({ octets, graine, effort: 2, nombre: 3, fils: 0 })
    expect(fils).toBe(0)
    expect(essais).toBeGreaterThanOrEqual(3)
    const module = await ModuleEquix.instancier(octets)
    const compteurs = module.compteurs(parts, 3)!
    expect(parts.length).toBe(taillePreuve(compteurs))
    expect(parts.length).toBeLessThanOrEqual(tailleMaxPreuve(60, 3))
    expect(module.verifier(graine, parts, 2, 3)).toBe(true)
    expect(module.verifier(await construireGraine('pow-equix-wasm/test', 'autre contenu'), parts, 2, 3)).toBe(false)
    expect(module.verifier(graine, parts, 2, 2)).toBe(false)
    const alteree = parts.slice()
    alteree[6]! ^= 1
    expect(module.verifier(graine, alteree, 2, 3)).toBe(false)
    expect(module.memoireOctets).toBeGreaterThan(0)
  }, 60_000)

  test('répartit le calcul sur plusieurs Web Workers et rapporte sa progression', async () => {
    const progression: number[] = []
    const resultat = await resoudre({ octets, graine, effort: 1, nombre: 4, fils: 2, onProgression: ({ essais }) => progression.push(essais) })
    expect(resultat.fils).toBe(2)
    expect(resultat.compilation).toBe(true)
    expect(progression.at(-1)).toBe(resultat.essais)
    // Chaque fil garde en mémoire la zone de travail du solveur (≈ 1,8 Mo).
    expect(resultat.memoireOctets).toBeGreaterThan(2 * 1_800_000)
    expect((await ModuleEquix.instancier(octets)).verifier(graine, resultat.parts, 1, 4)).toBe(true)
  }, 60_000)

  test('s’interrompt dès que le calcul est annulé, sur le fil courant comme dans les Web Workers, compilé ou interprété', async () => {
    await expect(resoudre({ octets, graine, effort: 1, nombre: 1, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
    for (const compilation of ['auto', 'jamais'] as const) {
      for (const fils of [0, 2]) {
        const annulation = new AbortController()
        // Effort inatteignable en pratique : seul l’arrêt demandé termine le calcul.
        const calcul = resoudre({ octets, graine, effort: 2 ** 30, nombre: 1, fils, compilation, signal: annulation.signal, onProgression: ({ essais }) => { if (essais >= 2) annulation.abort() } })
        await expect(calcul).rejects.toMatchObject({ name: 'AbortError' })
      }
    }
  }, 60_000)

  test('refuse des paramètres hors limites sans rien calculer', async () => {
    await expect(resoudre({ octets, graine, effort: 0, nombre: 1 })).rejects.toThrow('Paramètres de preuve invalides.')
    await expect(resoudre({ octets, graine, effort: 1, nombre: 65 })).rejects.toThrow('Paramètres de preuve invalides.')
    await expect(resoudre({ octets, graine: new Uint8Array(0), effort: 1, nombre: 1 })).rejects.toThrow('Paramètres de preuve invalides.')
    for (const n of [0, 56, 62, 84, 60.5]) await expect(resoudre({ octets, graine, effort: 1, nombre: 1, n })).rejects.toThrow('Paramètres de preuve invalides.')
    await expect(resoudre({ octets, graine, effort: 1, nombre: 1, compilation: 'toujours' as 'auto' })).rejects.toThrow('Option de compilation invalide.')
    const module = await ModuleEquix.instancier(octets)
    expect(() => module.essayer(graine, 0, 1, 62)).toThrow('Graine, effort ou n invalide.')
    await expect(module.essayerCompile(graine, 0, 0, 60)).rejects.toThrow('Graine, effort ou n invalide.')
  })

  test('rupture avec la 0.2.1 : même solution Equi-X, mais l’ancienne enveloppe est refusée', async () => {
    // Graine et preuve (effort 3, 3 parts de 20 octets : compteur u32 ‖ solution) calculées avec pow-equix-wasm 0.2.1.
    const graine021 = depuisHexadecimal('706f772d65717569782d7761736d2f7465737400ff0f3a964c682be5f7fe39de98fa2379ef5226b6692cea9ded960a191e57c4e5')!
    const ancienne = depuisHexadecimal('0200000050a07aa6c610eaf09915b1f0c02daff403000000405c00a63fa969ae8ccbdae2b51175e4060000009b5cbd7d66a0ceb622731b94090a0cf9')!
    expect(graine021).toEqual(await construireGraine('pow-equix-wasm/test', '{"version":"0.2.1"}'))
    expect(VERSION_FORMAT).toBe(2)
    const vue = new DataView(ancienne.buffer)
    const parts = [0, 1, 2].map((index) => ({ compteur: vue.getUint32(index * 20, true), solution: ancienne.slice(index * 20 + 4, index * 20 + 20) }))
    expect(parts.map((part) => part.compteur)).toEqual([2, 3, 6])
    // Les mêmes solutions dans la nouvelle enveloppe : écarts 2, 0, 2 d’un octet, 51 octets au lieu de 60.
    const nouvelle = encoderPreuve(parts)
    expect(nouvelle.length).toBe(3 * 17)
    expect([nouvelle[0], nouvelle[17], nouvelle[34]]).toEqual([2, 0, 2])
    for (const module of [await ModuleEquix.instancier(octets), ModuleEquix.depuisJs(creerExportsEquixJs)]) {
      expect(module.verifier(graine021, ancienne, 3, 3)).toBe(false)
      expect(module.verifier(graine021, nouvelle, 3, 3)).toBe(true)
      expect(module.verifier(graine021, nouvelle, 3, 3, 64)).toBe(false)
    }
  })
})

describe('chargement paresseux du moteur JavaScript', () => {
  test('le chargeur construit n’importe jamais statiquement le moteur JavaScript ni le module en base64', () => {
    const chargeur = readFileSync(resolve(import.meta.dir, '../dist/index.js'), 'utf8')
    expect(chargeur).not.toMatch(/\bimport\s*[\s{*'"(]/)
    expect(chargeur).not.toMatch(/equix-js|octets\.js/)
    // Ni le corps traduit par wasm2js, ni le module en base64.
    expect(chargeur).not.toContain('retasmFunc')
    expect(chargeur).not.toContain('BASE64')
    expect(chargeur.length).toBeLessThan(60_000)
  })

  test('WebAssembly fonctionne : le chargeur n’est jamais appelé', async () => {
    let appels = 0
    const chargerJs = async () => { appels++; return { creerExportsEquixJs } }
    for (const fils of [0, 2]) {
      const resultat = await resoudre({ octets, chargerJs, graine, effort: 1, nombre: 2, fils })
      expect(resultat.moteur).toBe('wasm')
      expect(resultat.repli).toBeNull()
    }
    expect((await ModuleEquix.charger({ octets, chargerJs })).moteur).toBe('wasm')
    expect(appels).toBe(0)
  }, 60_000)

  test('WebAssembly absent : le chargeur est appelé et la preuve se vérifie', async () => {
    let appels = 0
    const chargerJs = async () => { appels++; return creerExportsEquixJs }
    const original = globalThis.WebAssembly
    let resultat
    let module
    try {
      Object.defineProperty(globalThis, 'WebAssembly', { value: undefined, configurable: true, writable: true })
      expect(webAssemblyDisponible()).toBe(false)
      resultat = await resoudre({ octets, chargerJs, graine, effort: 1, nombre: 1, fils: 0 })
      module = await ModuleEquix.charger({ octets, chargerJs })
    } finally {
      Object.defineProperty(globalThis, 'WebAssembly', { value: original, configurable: true, writable: true })
    }
    expect(appels).toBe(2)
    expect(resultat.moteur).toBe('js')
    expect(resultat.repli).toEqual({ raison: 'indisponible' })
    expect(module.moteur).toBe('js')
    expect((await ModuleEquix.instancier(octets)).verifier(graine, resultat.parts, 1, 1)).toBe(true)
  }, 60_000)

  test('WebAssembly en échec (module refusé) : le chargeur prend le relais, sur le fil courant comme depuis les Web Workers', async () => {
    // Des octets que WebAssembly refuse de compiler, comme sous une politique sans 'wasm-unsafe-eval'.
    const refuses = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0xff])
    let appels = 0
    const chargerJs = async () => { appels++; return { creerExportsEquixJs } }
    const valide = await ModuleEquix.instancier(octets)
    for (const fils of [0, 1]) {
      const vues: Array<string | undefined> = []
      const resultat = await resoudre({ octets: refuses, chargerJs, graine, effort: 1, nombre: 1, fils, onProgression: ({ repli }) => vues.push(repli?.raison) })
      expect(resultat.moteur).toBe('js')
      expect(resultat.repli?.raison).toBe('echec')
      expect(resultat.repli?.message).toBeTruthy()
      expect(vues.every((raison) => raison === 'echec')).toBe(true)
      expect(valide.verifier(graine, resultat.parts, 1, 1)).toBe(true)
    }
    expect(appels).toBe(2)
    // Sans moteur de repli, ou en WebAssembly imposé, l’échec remonte tel quel.
    await expect(resoudre({ octets: refuses, graine, effort: 1, nombre: 1, fils: 0 })).rejects.toThrow()
    await expect(resoudre({ octets: refuses, chargerJs, moteur: 'wasm', graine, effort: 1, nombre: 1, fils: 0 })).rejects.toThrow()
    expect(appels).toBe(2)
  }, 120_000)

  test('une annulation ne déclenche jamais le repli', async () => {
    let appels = 0
    const chargerJs = async () => { appels++; return creerExportsEquixJs }
    for (const fils of [0, 2]) {
      const annulation = new AbortController()
      const calcul = resoudre({ octets, chargerJs, graine, effort: 2 ** 30, nombre: 1, fils, signal: annulation.signal, onProgression: ({ essais }) => { if (essais >= 2) annulation.abort() } })
      await expect(calcul).rejects.toMatchObject({ name: 'AbortError' })
    }
    expect(appels).toBe(0)
  }, 60_000)
})

describe('forme compacte des preuves', () => {
  const solution = new Uint8Array(16).fill(0xab)
  const listes = [[0], [0, 1, 2], [127, 128, 16_383, 16_384], [2 ** 21 - 1, 2 ** 21, 2 ** 28, 0xffff_fffe, 0xffff_ffff], [0xffff_ffff]]

  test('l’encodeur TypeScript fait l’aller-retour avec le décodeur du module, en WebAssembly comme en JavaScript', async () => {
    for (const module of [await ModuleEquix.instancier(octets), ModuleEquix.depuisJs(creerExportsEquixJs)]) {
      for (const compteurs of listes) {
        const preuve = encoderPreuve(compteurs.map((compteur) => ({ compteur, solution })))
        expect(preuve.length).toBe(taillePreuve(compteurs))
        expect(preuve.length).toBeLessThanOrEqual(tailleMaxPreuve(60, compteurs.length))
        expect(module.compteurs(preuve, compteurs.length)).toEqual(compteurs)
        expect(module.compteurs(preuve, compteurs.length + 1)).toBeNull()
      }
    }
    // Écarts de 1 à 5 octets.
    expect(taillePreuve([127])).toBe(1 + 16)
    expect(taillePreuve([128])).toBe(2 + 16)
    expect(taillePreuve([0xffff_ffff])).toBe(ECART_MAX + 16)
    expect(taillePreuve([0, 1, 2], 80)).toBe(3 * (1 + 21))
  })

  test('toute autre forme d’octets est refusée : LEB128 non canonique, dépassement, octets en trop ou manquants', async () => {
    const module = await ModuleEquix.instancier(octets)
    const preuve = (...ecarts: number[][]): Uint8Array => new Uint8Array(ecarts.flatMap((ecart) => [...ecart, ...solution]))
    expect(module.compteurs(preuve([0x7f], [0x00]), 2)).toEqual([127, 128])
    expect(module.compteurs(preuve([0xff, 0xff, 0xff, 0xff, 0x0f]), 1)).toEqual([0xffff_ffff])
    for (const [description, forme, nombre] of [
      ['zéro de tête', preuve([0x80, 0x00]), 1],
      ['octet final nul', preuve([0x81, 0x80, 0x00]), 1],
      ['plus de 5 octets', preuve([0x80, 0x80, 0x80, 0x80, 0x80, 0x01]), 1],
      ['au-delà de u32', preuve([0xff, 0xff, 0xff, 0xff, 0x10]), 1],
      ['compteur cumulé au-delà de u32', preuve([0xff, 0xff, 0xff, 0xff, 0x0f], [0x00]), 2],
      ['octet en trop', new Uint8Array([...preuve([0x03]), 0]), 1],
      ['octet manquant', preuve([0x03]).slice(0, 16), 1],
      ['parts en trop', preuve([0x03], [0x00]), 1],
      ['preuve vide', new Uint8Array(0), 1],
      ['aucune part', new Uint8Array(0), 0],
    ] as const) {
      expect([description, module.compteurs(forme, nombre)]).toEqual([description, null])
      expect([description, module.verifier(graine, forme, 1, nombre)]).toEqual([description, false])
    }
    // Une entrée plus longue que la taille maximale est refusée avant tout calcul.
    expect(tailleMaxPreuve(60, 4)).toBe(4 * 21)
    expect(tailleMaxPreuve(80, 4)).toBe(4 * 26)
    expect(tailleMaxPreuve(62, 4)).toBe(0)
    expect(tailleMaxPreuve(60, 65)).toBe(0)
    expect(module.verifier(graine, new Uint8Array(tailleMaxPreuve(60, 4) + 1), 1, 4)).toBe(false)
    // L’encodeur exige des compteurs strictement croissants, dans u32.
    expect(() => encoderPreuve([{ compteur: 4, solution }, { compteur: 4, solution }])).toThrow('Compteurs invalides')
    expect(() => encoderPreuve([{ compteur: 2 ** 32, solution }])).toThrow('Compteurs invalides')
  })

  test('tailles typiques : 4 parts à l’effort 1', async () => {
    for (const n of [60, 80]) {
      const { parts } = await resoudre({ octets, graine, effort: 1, nombre: 4, fils: 0, n })
      // Compteurs < 128 : un octet d’écart par part.
      expect(parts.length).toBe(4 * (1 + tailleSolution(n)))
    }
    expect(tailleSolution(60)).toBe(16)
    expect(tailleSolution(80)).toBe(21)
  }, 120_000)
})

describe('mémoire réglable (n)', () => {
  test('mémoire, taille des parts et choix de n', () => {
    // Même mémoire de travail qu’Equi-X (1 895 424 octets), aux compteurs de seaux près.
    expect(memoirePourN(60)).toBeGreaterThan(1_890_000)
    expect(memoirePourN(60)).toBeLessThan(1_900_000)
    for (const [index, n] of N_VALIDES.entries()) if (index > 0) expect(memoirePourN(n) / memoirePourN(N_VALIDES[index - 1]!)).toBeGreaterThan(1.9)
    expect(memoirePourN(80) / 1024 / 1024).toBeCloseTo(63, 0)
    expect(() => memoirePourN(62)).toThrow('n invalide')
    expect(nPourMemoire(0.5)).toBe(60)
    expect(nPourMemoire(2)).toBe(60)
    expect(nPourMemoire(4)).toBe(64)
    expect(nPourMemoire(16)).toBe(72)
    expect(nPourMemoire(1000)).toBe(80)
    expect(tailleSolution()).toBe(16)
    expect(tailleSolution(64)).toBe(17)
  })

  test('une preuve à n = 64 se résout, se vérifie, et n’est valable que pour ce n', async () => {
    const resultat = await resoudre({ octets, graine, effort: 2, nombre: 2, fils: 0, n: 64 })
    expect(resultat.n).toBe(64)
    expect(resultat.compilation).toBe(true)
    const module = await ModuleEquix.instancier(octets)
    expect(resultat.parts.length).toBe(taillePreuve(module.compteurs(resultat.parts, 2, 64)!, 64))
    expect(module.verifier(graine, resultat.parts, 2, 2, 64)).toBe(true)
    expect(ModuleEquix.depuisJs(creerExportsEquixJs).verifier(graine, resultat.parts, 2, 2, 64)).toBe(true)
    expect(module.verifier(graine, resultat.parts, 2, 2, 68)).toBe(false)
    expect(module.verifier(graine, resultat.parts, 2, 2)).toBe(false)
    expect(module.verifier(graine, resultat.parts.slice(0, -1), 2, 2, 64)).toBe(false)
    for (const octet of [0, 4, 17, 20, resultat.parts.length - 1]) {
      const alteree = resultat.parts.slice()
      alteree[octet]! ^= 0x08
      expect(module.verifier(graine, alteree, 2, 2, 64)).toBe(false)
    }
    // Plus de mémoire qu’à n = 60 : environ 3,8 Mio de mémoire de travail.
    expect(resultat.memoireOctets).toBeGreaterThan(memoirePourN(64))
  }, 60_000)

  test('les Web Workers résolvent aussi à n = 68, en mode compilé', async () => {
    const vues: Array<{ n: number; compilation: boolean }> = []
    const resultat = await resoudre({ octets, graine, effort: 1, nombre: 2, fils: 2, n: 68, onProgression: (progression) => vues.push(progression) })
    expect(resultat.fils).toBe(2)
    expect(resultat.compilation).toBe(true)
    expect(vues.every((vue) => vue.n === 68 && vue.compilation)).toBe(true)
    expect(resultat.memoireOctets).toBeGreaterThan(2 * memoirePourN(68))
    expect((await ModuleEquix.instancier(octets)).verifier(graine, resultat.parts, 1, 2, 68)).toBe(true)
  }, 60_000)
})

interface ExportsBruts {
  memory: WebAssembly.Memory
  tampon_adresse(): number
  tampon_taille(): number
  zone_programme(): number
  preparer(longueur: number, compteur: number, n: number): number
  remplir(): void
}

describe('compilation des programmes HashX en WebAssembly', () => {
  test('la table compilée est identique, octet pour octet, à celle de l’interprète', async () => {
    const { instance } = await WebAssembly.instantiate(octets.slice(), {})
    const exports = instance.exports as unknown as ExportsBruts
    const tampon = (): Uint8Array => new Uint8Array(exports.memory.buffer, exports.tampon_adresse(), exports.tampon_taille())
    let comparees = 0
    // n = 72 couvre les valeurs de plus de 64 bits ; n = 80 (14 s d’interprète) est couvert côté Rust.
    for (const [n, compteurs] of [[60, 6], [68, 2], [72, 1]] as const) {
      for (let compteur = 0; compteur < compteurs; compteur++) {
        tampon().set(graine)
        if (exports.preparer(graine.length, compteur, n) !== 1) continue
        const zone = exports.zone_programme()
        const description = tampon().slice(zone, zone + 48 + 4096)
        const vue = new DataView(description.buffer)
        const [elements, basse, haute] = [vue.getUint32(4, true), vue.getUint32(8, true), vue.getUint32(12, true)]
        expect(elements).toBe(2 ** (n / 4 + 1))
        expect(haute !== 0).toBe(n > 64)
        const module = genererModuleHashx(description)
        expect(WebAssembly.validate(module)).toBe(true)
        const { instance: programme } = await WebAssembly.instantiate(module, { e: { m: exports.memory } })
        ;(programme.exports.remplir as (debut: number, fin: number) => void)(0, elements)
        const compilee = new Uint8Array(exports.memory.buffer, basse, elements * 8).slice()
        const compileeHaute = haute ? new Uint8Array(exports.memory.buffer, haute, elements * 4).slice() : null
        exports.remplir()
        expect(compilee).toEqual(new Uint8Array(exports.memory.buffer, basse, elements * 8))
        if (compileeHaute) expect(compileeHaute).toEqual(new Uint8Array(exports.memory.buffer, haute, elements * 4))
        comparees++
      }
    }
    expect(comparees).toBeGreaterThanOrEqual(7)
  }, 120_000)

  test('compilé et interprété donnent les mêmes solutions, en WebAssembly comme en JavaScript', async () => {
    const wasm = await ModuleEquix.instancier(octets)
    expect(wasm.compilation).toBe(true)
    const js = ModuleEquix.depuisJs(creerExportsEquixJs)
    // Le moteur JavaScript n’a pas de mémoire WebAssembly à partager : il interprète toujours.
    expect(js.compilation).toBe(false)
    for (const compteur of [0, 1, 2, 3]) expect(await wasm.essayerCompile(graine, compteur, 1)).toEqual(wasm.essayer(graine, compteur, 1))
    expect(await wasm.essayerCompile(graine, 5, 1, 72)).toEqual(wasm.essayer(graine, 5, 1, 72))
    expect(await js.essayerCompile(graine, 1, 1, 64)).toEqual(wasm.essayer(graine, 1, 1, 64))
  }, 120_000)

  test('compilation: jamais garde l’interprète, et le résultat reste vérifiable', async () => {
    const vues: boolean[] = []
    const resultat = await resoudre({ octets, graine, effort: 1, nombre: 1, fils: 1, compilation: 'jamais', onProgression: ({ compilation }) => vues.push(compilation) })
    expect(resultat.compilation).toBe(false)
    expect(vues.every((compilation) => !compilation)).toBe(true)
    expect((await ModuleEquix.instancier(octets)).verifier(graine, resultat.parts, 1, 1)).toBe(true)
  }, 60_000)
})

describe('outils', () => {
  test('l’estimation suit les probabilités mesurées par essai', () => {
    expect(probabiliteEssai(1)).toBeCloseTo(0.858, 2)
    expect(probabiliteEssai(2)).toBeCloseTo(0.623, 2)
    expect(probabiliteEssai(16)).toBeCloseTo(0.119, 2)
    expect(essaisAttendus(1, 4)).toBeCloseTo(4 / probabiliteEssai(1))
  })

  test('l’hexadécimal fait l’aller-retour et refuse une forme invalide', () => {
    expect(depuisHexadecimal(hexadecimal(new Uint8Array([0, 15, 255])))).toEqual(new Uint8Array([0, 15, 255]))
    expect(depuisHexadecimal('abc')).toBeNull()
    expect(depuisHexadecimal('zz')).toBeNull()
  })
})

describe('moteur JavaScript (sans WebAssembly)', () => {
  test('donne exactement les mêmes solutions que WebAssembly, essai par essai', async () => {
    const wasm = await ModuleEquix.instancier(octets)
    const js = ModuleEquix.depuisJs(creerExportsEquixJs)
    expect(js.moteur).toBe('js')
    for (const compteur of [0, 1, 7]) expect(js.essayer(graine, compteur, 1)).toEqual(wasm.essayer(graine, compteur, 1))
  }, 60_000)

  test('une preuve résolue en JavaScript se vérifie en WebAssembly, et l’inverse', async () => {
    const parJs = await resoudre({ js: creerExportsEquixJs, moteur: 'js', graine, effort: 1, nombre: 1, fils: 0 })
    expect(parJs.moteur).toBe('js')
    expect((await ModuleEquix.instancier(octets)).verifier(graine, parJs.parts, 1, 1)).toBe(true)
    const parWasm = await resoudre({ octets, graine, effort: 1, nombre: 2, fils: 0 })
    expect(ModuleEquix.depuisJs(creerExportsEquixJs).verifier(graine, parWasm.parts, 1, 2)).toBe(true)
  }, 60_000)

  test('tourne aussi dans un Web Worker, par la source de creerExportsEquixJs', async () => {
    const resultat = await resoudre({ js: creerExportsEquixJs, moteur: 'js', graine, effort: 1, nombre: 1, fils: 1 })
    expect(resultat.moteur).toBe('js')
    expect(resultat.fils).toBe(1)
    expect((await ModuleEquix.instancier(octets)).verifier(graine, resultat.parts, 1, 1)).toBe(true)
  }, 60_000)

  test('choisit WebAssembly quand il est là, JavaScript sinon, et refuse sans moteur', async () => {
    expect(webAssemblyDisponible()).toBe(true)
    expect(moteurRetenu({ octets, js: creerExportsEquixJs })).toBe('wasm')
    expect(moteurRetenu({ js: creerExportsEquixJs })).toBe('js')
    expect(moteurRetenu({ octets, moteur: 'js' })).toBeNull()
    await expect(resoudre({ graine, effort: 1, nombre: 1 })).rejects.toThrow('Aucun moteur Equi-X fourni')
  })

  test('estime la durée et le ralentissement d’après les mesures de référence', () => {
    expect(ralentissement('wasm')).toBe(1)
    expect(ralentissement('wasmCompile')).toBeLessThan(0.2)
    expect(ralentissement('jsSansJit')).toBeGreaterThan(100)
    expect(ralentissement('wasm', 'wasmCompile')).toBeGreaterThan(5)
    // 4 parts à l’effort 1 : un peu moins de 5 essais, répartis sur autant de fils.
    const essais = essaisAttendus(1, 4)
    expect(estimerDuree({ effort: 1, nombre: 4, execution: 'wasm', fils: 1 })).toBeCloseTo(essais * REFERENCE_MS_PAR_ESSAI.wasm)
    expect(estimerDuree({ effort: 1, nombre: 4, execution: 'wasm', fils: 64 })).toBeCloseTo(REFERENCE_MS_PAR_ESSAI.wasm)
    // Chaque pas de n double au moins la durée d’un essai.
    expect(estimerDuree({ effort: 1, nombre: 4, execution: 'wasmCompile', fils: 1, n: 64 })).toBeCloseTo(essais * msParEssai('wasmCompile', 64))
    expect(msParEssai('wasmCompile', 80)).toBeGreaterThan(32 * REFERENCE_MS_PAR_ESSAI.wasmCompile)
    expect(executionPrevue({ octets })).toBe('wasmCompile')
    expect(executionPrevue({ octets, compilation: 'jamais' })).toBe('wasm')
    expect(executionPrevue({ js: creerExportsEquixJs })).toBe('js')
    expect(executionPrevue({})).toBeNull()
  })

  test('la progression donne le moteur, la durée et une estimation du temps restant', async () => {
    const vues: Array<{ moteur: string; compilation: boolean; n: number; dureeMs: number; restantEstimeMs: number | null; parts: number }> = []
    await resoudre({ octets, graine, effort: 1, nombre: 3, fils: 0, onProgression: (progression) => vues.push(progression) })
    expect(vues.every((vue) => vue.moteur === 'wasm' && vue.compilation && vue.n === 60)).toBe(true)
    expect(vues[0]!.restantEstimeMs).not.toBeNull()
    expect(vues.at(-1)!.restantEstimeMs).toBe(0)
    expect(vues.at(-1)!.dureeMs).toBeGreaterThan(0)
  }, 60_000)
})

/** Enveloppe un Web Worker pour noter les compteurs distribués et les essais rapportés. */
function espion(travailleur: Worker, distribues: number[], rapportes: number[]): Worker {
  const enveloppe = {
    postMessage(message: { compteur: number }) {
      distribues.push(message.compteur)
      travailleur.postMessage(message)
    },
    terminate: () => travailleur.terminate(),
    set onmessage(ecouteur: (evenement: MessageEvent) => void) {
      travailleur.onmessage = (evenement) => {
        if ((evenement.data as { type: string }).type === 'essai') rapportes.push((evenement.data as { compteur: number }).compteur)
        ecouteur(evenement)
      }
    },
    set onerror(ecouteur: (evenement: ErrorEvent) => void) {
      travailleur.onerror = ecouteur
    },
  }
  return enveloppe as unknown as Worker
}

/** Un Web Worker qui échoue dès son premier compteur, comme faute de mémoire. */
function travailleurDefaillant(): Worker {
  const faux: { onmessage: ((evenement: MessageEvent) => void) | null; onerror: unknown; postMessage(): void; terminate(): void } = {
    onmessage: null,
    onerror: null,
    postMessage() {
      setTimeout(() => faux.onmessage?.({ data: { type: 'erreur', message: 'Mémoire insuffisante.' } } as MessageEvent), 5)
    },
    terminate() {},
  }
  return faux as unknown as Worker
}

const etat = (partiel: Partial<EtatFils>): EtatFils => ({ essaisTermines: 1, dureePremierEssaiMs: 40, dureeMoyenneEssaiMs: 35, filsActifs: 1, n: 60, execution: 'wasmCompile', ...partiel })

describe('fils adaptatifs', () => {
  test('les fils montent de 1 à 4 en cours de calcul, sans trou ni doublon de compteur, et la preuve est valide', async () => {
    const distribues: number[] = []
    const rapportes: number[] = []
    const vus: number[] = []
    const politique = ({ essaisTermines }: EtatFils): number => (essaisTermines >= 2 ? 4 : essaisTermines >= 1 ? 2 : 1)
    const resultat = await resoudre({
      octets, graine, effort: 8, nombre: 3, fils: politique,
      creerTravailleur: (moteur, js) => espion(travailleurEquix(moteur, js), distribues, rapportes),
      onProgression: ({ filsActifs }) => vus.push(filsActifs),
    })
    // Un fil au départ ; la politique en demande 2 dès le premier essai, avant son rapport.
    expect(vus[0]).toBe(2)
    expect(vus.every((fils, index) => index === 0 || fils >= vus[index - 1]!)).toBe(true)
    expect(resultat.fils).toBe(4)
    // Chaque compteur distribué une seule fois, sans trou : 0, 1, 2… ; aucun essai rapporté deux fois.
    expect([...distribues].sort((a, b) => a - b)).toEqual(distribues.map((_, index) => index))
    expect(new Set(rapportes).size).toBe(rapportes.length)
    expect(rapportes.length).toBe(resultat.essais)
    const module = await ModuleEquix.instancier(octets)
    expect(module.verifier(graine, resultat.parts, 8, 3)).toBe(true)
    expect(module.compteurs(resultat.parts, 3)!.every((compteur) => rapportes.includes(compteur))).toBe(true)
  }, 120_000)

  test('l’échec de création d’un fil supplémentaire est toléré, et aucun autre n’est tenté', async () => {
    for (const echec of ['exception', 'erreur avant tout résultat'] as const) {
      let creations = 0
      const rapportes: number[] = []
      const resultat = await resoudre({
        // 4 fils d’emblée, puis 8 : sans l’arrêt de la montée, d’autres fils seraient créés.
        octets, graine, effort: 4, nombre: 2, fils: ({ essaisTermines }) => (essaisTermines ? 8 : 4),
        creerTravailleur: (moteur, js) => {
          creations++
          if (creations === 1) return espion(travailleurEquix(moteur, js), [], rapportes)
          if (echec === 'exception') throw new RangeError('Mémoire insuffisante.')
          return travailleurDefaillant()
        },
      })
      // Une exception à la création arrête aussitôt la montée ; un Web Worker qui
      // échoue plus tard (ici 5 ms) n’est connu qu’après la première salve, jusqu’à 4.
      expect(creations).toBe(echec === 'exception' ? 2 : 4)
      if (echec === 'exception') expect(resultat.fils).toBe(1)
      expect(resultat.moteur).toBe('wasm')
      // Le compteur confié au fil défaillant a été redistribué : aucun trou.
      expect([...rapportes].sort((a, b) => a - b)).toEqual(rapportes.map((_, index) => index))
      expect((await ModuleEquix.instancier(octets)).verifier(graine, resultat.parts, 4, 2)).toBe(true)
    }
  }, 120_000)

  test('une annulation pendant la montée arrête tout, sans repli', async () => {
    let appels = 0
    const annulation = new AbortController()
    const calcul = resoudre({
      octets, graine, effort: 2 ** 30, nombre: 1, fils: ({ essaisTermines }) => 1 + essaisTermines, signal: annulation.signal,
      chargerJs: async () => { appels++; return creerExportsEquixJs },
      onProgression: ({ filsActifs }) => { if (filsActifs >= 3) annulation.abort() },
    })
    await expect(calcul).rejects.toMatchObject({ name: 'AbortError' })
    expect(appels).toBe(0)
  }, 60_000)

  test('la mise en route d’un Web Worker n’entre pas dans la durée mesurée d’un essai', async () => {
    const etats: EtatFils[] = []
    // Mise en route lente simulée : le premier message (réglage et module) n’arrive qu’après 600 ms.
    const lent = (travailleur: Worker): Worker => {
      let premier = true
      const enveloppe = {
        postMessage(message: unknown) {
          if (premier) setTimeout(() => travailleur.postMessage(message), 600)
          else travailleur.postMessage(message)
          premier = false
        },
        terminate: () => travailleur.terminate(),
        set onmessage(ecouteur: (evenement: MessageEvent) => void) { travailleur.onmessage = ecouteur },
        set onerror(ecouteur: (evenement: ErrorEvent) => void) { travailleur.onerror = ecouteur },
      }
      return enveloppe as unknown as Worker
    }
    await resoudre({
      octets, graine, effort: 1, nombre: 2, creerTravailleur: (moteur, js) => lent(travailleurEquix(moteur, js)),
      fils: (etat) => { etats.push(etat); return 1 },
    })
    const mesure = etats.find((etat) => etat.essaisTermines === 1)!
    expect(mesure.dureePremierEssaiMs).not.toBeNull()
    // Un essai compilé dure quelques dizaines de millisecondes : ni l’attente de 600 ms ni l’instanciation n’y sont.
    expect(mesure.dureePremierEssaiMs!).toBeLessThan(400)
    expect(mesure.dureeMoyenneEssaiMs).toBe(mesure.dureePremierEssaiMs)
  }, 60_000)

  test('filsAdaptatifs : mémoire de l’appareil connue', () => {
    // 1/32 de la mémoire : 4 Go → 128 Mio, soit 71 fils à n = 60 (plafonnés à 8), 2 à n = 80.
    expect(filsAdaptatifs({ memoireAppareilGo: 4, coeurs: 8 })(etat({ essaisTermines: 0, dureeMoyenneEssaiMs: null }))).toBe(8)
    expect(filsAdaptatifs({ memoireAppareilGo: 4, coeurs: 8 })(etat({ n: 80 }))).toBe(2)
    expect(filsAdaptatifs({ memoireAppareilGo: 1, coeurs: 4 })(etat({}))).toBe(4)
    expect(filsAdaptatifs({ memoireAppareilGo: 0.5, coeurs: 8 })(etat({ n: 76 }))).toBe(1)
    expect(filsAdaptatifs({ memoireAppareilGo: 8, coeurs: 16, filsMax: 12 })(etat({}))).toBe(12)
  })

  test('filsAdaptatifs : sans mémoire connue, d’après la durée mesurée et l’écran', () => {
    const politique = (ecranPx: number | null, coeurs = 8) => filsAdaptatifs({ memoireAppareilGo: null, ecranPx, coeurs })
    const reference = 35 // durée de référence d’un essai compilé à n = 60
    // Un seul fil avant toute mesure.
    expect(politique(2560)(etat({ essaisTermines: 0, dureeMoyenneEssaiMs: null }))).toBe(1)
    // Rapide et écran bien défini : jusqu’à 8, et pas plus que les cœurs.
    expect(politique(2560)(etat({ dureeMoyenneEssaiMs: reference }))).toBe(8)
    expect(politique(2560, 4)(etat({ dureeMoyenneEssaiMs: reference }))).toBe(4)
    // Lent, ou écran peu défini (téléphone modeste) : un fil.
    expect(politique(2560)(etat({ dureeMoyenneEssaiMs: 3 * reference }))).toBe(1)
    expect(politique(1080)(etat({ dureeMoyenneEssaiMs: reference }))).toBe(1)
    // Entre les deux : 4, ou 2 si r > 2 ; un écran inconnu compte comme moyen.
    expect(politique(1600)(etat({ dureeMoyenneEssaiMs: 1.5 * reference }))).toBe(4)
    expect(politique(1600)(etat({ dureeMoyenneEssaiMs: 2.2 * reference }))).toBe(2)
    expect(politique(null)(etat({ dureeMoyenneEssaiMs: reference }))).toBe(4)
    expect(politique(1600, 1)(etat({ dureeMoyenneEssaiMs: reference }))).toBe(1)
    // La référence suit n et l’exécution : 36 × plus long à n = 80, 12 × en interprété.
    expect(politique(2560)(etat({ n: 80, dureeMoyenneEssaiMs: 36 * reference }))).toBe(8)
    expect(politique(2560)(etat({ execution: 'wasm', dureeMoyenneEssaiMs: 430 }))).toBe(8)
    // Seuils surchargeables.
    expect(SEUILS_FILS_ADAPTATIFS.rapportLent).toBe(2.5)
    expect(filsAdaptatifs({ memoireAppareilGo: null, ecranPx: 1600, coeurs: 8, rapportLent: 5 })(etat({ dureeMoyenneEssaiMs: 3 * reference }))).toBe(2)
    expect(filsAdaptatifs({ memoireAppareilGo: null, ecranPx: 1000, coeurs: 8, ecranPeuDefini: 900 })(etat({ dureeMoyenneEssaiMs: 1.5 * reference }))).toBe(4)
  })

  test('resoudre borne une politique aux essais restants attendus', async () => {
    const vus: number[] = []
    const resultat = await resoudre({ octets, graine, effort: 1, nombre: 1, fils: () => 8, onProgression: ({ filsActifs }) => vus.push(filsActifs) })
    // Une part à l’effort 1 : 1,2 essai attendu, donc 2 fils au plus.
    expect(resultat.fils).toBeLessThanOrEqual(2)
    expect(Math.max(...vus)).toBeLessThanOrEqual(2)
  }, 60_000)
})
