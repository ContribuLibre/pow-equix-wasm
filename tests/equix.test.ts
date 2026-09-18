// Tests du paquet construit (`bun run build` d’abord) : ils importent dist/ comme
// le ferait un projet qui dépend de pow-equix-wasm.

import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  GRAINE_MAX, ModuleEquix, TAILLE_PART, construireGraine, depuisHexadecimal, essaisAttendus, hexadecimal, probabiliteEssai, resoudre,
} from '../dist/index.js'
import { SHA256_EQUIX, octetsEquix } from '../dist/octets.js'

const octets = new Uint8Array(readFileSync(resolve(import.meta.dir, '../dist/equix.wasm')))
const empreinte = JSON.parse(readFileSync(resolve(import.meta.dir, '../dist/empreinte.json'), 'utf8')) as { sha256: string; octets: number }
const graine = await construireGraine('pow-equix-wasm/test', '{"message":"bonjour"}')

describe('module publié', () => {
  test('le module intégré en base64 est celui du fichier, et l’empreinte les décrit', () => {
    const sha = createHash('sha256').update(octets).digest('hex')
    expect(empreinte.sha256).toBe(sha)
    expect(empreinte.octets).toBe(octets.length)
    expect(SHA256_EQUIX).toBe(sha)
    expect(octetsEquix()).toEqual(octets)
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
    expect(parts.length).toBe(3 * TAILLE_PART)
    const module = await ModuleEquix.instancier(octets)
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
    expect(progression.at(-1)).toBe(resultat.essais)
    // Chaque fil garde en mémoire la zone de travail du solveur (≈ 1,8 Mo).
    expect(resultat.memoireOctets).toBeGreaterThan(2 * 1_800_000)
    expect((await ModuleEquix.instancier(octets)).verifier(graine, resultat.parts, 1, 4)).toBe(true)
  }, 60_000)

  test('s’interrompt dès que le calcul est annulé, sur le fil courant comme dans les Web Workers', async () => {
    await expect(resoudre({ octets, graine, effort: 1, nombre: 1, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
    for (const fils of [0, 2]) {
      const annulation = new AbortController()
      // Effort inatteignable en pratique : seul l’arrêt demandé termine le calcul.
      const calcul = resoudre({ octets, graine, effort: 2 ** 30, nombre: 1, fils, signal: annulation.signal, onProgression: ({ essais }) => { if (essais >= 2) annulation.abort() } })
      await expect(calcul).rejects.toMatchObject({ name: 'AbortError' })
    }
  }, 60_000)

  test('refuse des paramètres hors limites sans rien calculer', async () => {
    await expect(resoudre({ octets, graine, effort: 0, nombre: 1 })).rejects.toThrow('Paramètres de preuve invalides.')
    await expect(resoudre({ octets, graine, effort: 1, nombre: 65 })).rejects.toThrow('Paramètres de preuve invalides.')
    await expect(resoudre({ octets, graine: new Uint8Array(0), effort: 1, nombre: 1 })).rejects.toThrow('Paramètres de preuve invalides.')
  })
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
