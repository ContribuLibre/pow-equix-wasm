// Tests du banc comparatif (démo seulement) : SHA-256 spécialisé, scénarios,
// statistiques, exécution sur de vrais Web Workers, agrégation, et absence de
// tout cela dans le paquet publié.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { calibrer, debitVerification, repetition, resumer } from '../demo/banc/executeur.ts'
import { tailleNonces, verifierNonces, zerosEnTete } from '../demo/banc/moteurs.ts'
import { type Scenario, SCENARIOS_PROVISOIRES, centile, debit100s, estimerScenario, essaisAttendusScenario, statistiques, validerScenarios } from '../demo/banc/scenarios.ts'
import { type ExportBanc, FORMAT_BANC, VERSION_BANC } from '../demo/banc/schema.ts'
import { hacheurHashcash } from '../demo/banc/sha256.ts'
import { agreger, lireExport, versMarkdown } from '../scripts/agreger-banc.ts'

const racine = resolve(import.meta.dir, '..')
const env = {
  creerTravailleur: () => new Worker(resolve(racine, 'demo/banc/travailleur.ts')),
  octetsEquix: new Uint8Array(readFileSync(resolve(racine, 'dist/equix.wasm'))),
  coeurs: 2,
}

describe('SHA-256 spécialisé pour hashcash', () => {
  test('donne l’empreinte de WebCrypto, quelle que soit la longueur du préfixe', async () => {
    for (let longueur = 0; longueur < 140; longueur += 7) {
      const prefixe = new Uint8Array(longueur).map((_, rang) => (rang * 31 + 7) & 255)
      const hacheur = hacheurHashcash(prefixe)
      for (const nonce of [0, 1, 0x80, 0x12345678, 0xffffffff]) {
        const message = new Uint8Array(longueur + 4)
        message.set(prefixe)
        new DataView(message.buffer).setUint32(longueur, nonce, true)
        const attendue = new Uint8Array(await crypto.subtle.digest('SHA-256', message))
        const obtenue = new Uint8Array(32)
        hacheur.empreinte(nonce).forEach((mot, rang) => new DataView(obtenue.buffer).setInt32(rang * 4, mot))
        expect(obtenue).toEqual(attendue)
        expect(hacheur.zerosEnTete(nonce)).toBe(zerosEnTete(attendue))
      }
    }
  })

  test('bits nuls en tête et taille des preuves hashcash', () => {
    expect(zerosEnTete(new Uint8Array([0, 0x0f, 0xff]))).toBe(12)
    expect(zerosEnTete(new Uint8Array(4))).toBe(32)
    expect(tailleNonces([5, 6, 300])).toBe(1 + 1 + 2)
  })
})

describe('scénarios et statistiques', () => {
  test('les scénarios provisoires sont valides, marqués comme tels, avec au moins 100 répétitions', () => {
    expect(validerScenarios(SCENARIOS_PROVISOIRES)).toEqual({ scenarios: SCENARIOS_PROVISOIRES })
    expect(SCENARIOS_PROVISOIRES.every((scenario) => scenario.libelle?.startsWith('PROVISOIRE') && scenario.repetitions >= 100)).toBe(true)
  })

  test('un scénario invalide est refusé avec un message clair', () => {
    const base = { id: 'x', algorithme: 'sha256', parametres: {}, parts: 1, difficulte: 8, fils: 1, repetitions: 100 }
    const cas: Array<[unknown, string]> = [
      [[], 'liste non vide'],
      [[{ ...base, algorithme: 'md5' }], '« algorithme »'],
      [[{ ...base, parts: 65 }], '« parts »'],
      [[{ ...base, fils: 'tous' }], '« fils »'],
      [[base, base], '« id » unique'],
      [[{ ...base, vitesse: 1 }], 'champ inconnu « vitesse »'],
      [[{ ...base, difficulte: 41 }], 'de 0 à 40'],
      [[{ ...base, algorithme: 'argon2id', parametres: { memoireKio: 4, iterations: 1, parallelisme: 1 }, difficulte: 1 }], 'memoireKio de 8'],
      [[{ ...base, algorithme: 'equix', parametres: { n: 62, compilation: 'auto' }, difficulte: 1 }], 'n parmi'],
    ]
    for (const [valeur, attendu] of cas) {
      const lecture = validerScenarios(valeur)
      expect('erreur' in lecture ? lecture.erreur : 'accepté').toContain(attendu)
    }
  })

  test('centiles, rapport p95/p5, débit en 100 s et essais attendus', () => {
    expect(centile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(centile([10, 20], 0.95)).toBeCloseTo(19.5)
    const valeurs = Array.from({ length: 101 }, (_, rang) => rang + 100)
    const s = statistiques(valeurs)
    expect([s.min, s.p5, s.mediane, s.p95, s.max, s.moyenne]).toEqual([100, 105, 150, 195, 200, 150])
    expect(s.rapportP95P5).toBeCloseTo(195 / 105)
    expect(debit100s([1000, 1000, 1000])).toEqual({ extrapole: 100, mesure: null })
    expect(debit100s(Array.from({ length: 150 }, () => 1000))).toEqual({ extrapole: 100, mesure: 100 })
    const sha: Scenario = { id: 's', algorithme: 'sha256', parametres: {}, parts: 4, difficulte: 10, fils: 2, repetitions: 100 }
    expect(essaisAttendusScenario(sha)).toBe(4096)
    expect(estimerScenario(sha, 8, 0.001)).toBeCloseTo(100 * (4096 * 0.001 / 2 + 4 * 0.001))
  })
})

describe('exécution sur de vrais Web Workers', () => {
  const petits: Scenario[] = [
    { id: 'sha', algorithme: 'sha256', parametres: {}, parts: 3, difficulte: 12, fils: 2, repetitions: 2 },
    { id: 'argon', algorithme: 'argon2id', parametres: { memoireKio: 1024, iterations: 1, parallelisme: 1 }, parts: 2, difficulte: 1, fils: 2, repetitions: 2 },
    { id: 'equix', algorithme: 'equix', parametres: { n: 60, compilation: 'auto' }, parts: 2, difficulte: 1, fils: 'coeurs', repetitions: 2 },
  ]

  test('chaque algorithme résout, vérifie, se calibre et mesure son débit de vérification', async () => {
    for (const scenario of petits) {
      const repetitions = [await repetition(scenario, env), await repetition(scenario, env)]
      expect(repetitions.every((r) => r.verification.valide && r.essais >= scenario.parts && r.dureeMs > 0)).toBe(true)
      const resultat = resumer(scenario, repetitions, env.coeurs, null)
      expect(resultat.statistiques.dureeMs.nombre).toBe(2)
      expect(resultat.filsEffectifs).toBe(2)
      expect(await calibrer(scenario, env, 100)).toBeGreaterThan(0)
      const debit = await debitVerification(scenario, 2, env, 150)
      expect(debit.fils).toBe(2)
      expect(debit.parSeconde).toBeGreaterThan(0)
    }
  }, 120_000)

  test('une preuve hashcash altérée ou dupliquée est refusée', async () => {
    const graine = new TextEncoder().encode('banc\0test')
    const hacheur = hacheurHashcash(graine)
    const nonces: number[] = []
    for (let nonce = 0; nonces.length < 3; nonce++) if (hacheur.zerosEnTete(nonce) >= 8) nonces.push(nonce)
    expect(await verifierNonces('sha256', {}, graine, nonces, 8)).toBe(true)
    expect(await verifierNonces('sha256', {}, graine, [nonces[0]!, nonces[0]!, nonces[1]!], 8)).toBe(false)
    expect(await verifierNonces('sha256', {}, graine, [nonces[0]! + 1, nonces[1]!, nonces[2]!], 8)).toBe(hacheur.zerosEnTete(nonces[0]! + 1) >= 8)
  })

  test('une annulation arrête le défi en cours', async () => {
    const annulation = new AbortController()
    const calcul = repetition({ id: 'long', algorithme: 'sha256', parametres: {}, parts: 1, difficulte: 40, fils: 1, repetitions: 1 }, { ...env, signal: annulation.signal })
    setTimeout(() => annulation.abort(), 100)
    await expect(calcul).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('agrégation de plusieurs appareils', () => {
  function exportSynthetique(modele: string, facteur: number): ExportBanc {
    const scenario: Scenario = { id: 'eq', libelle: 'Equi-X essai', algorithme: 'equix', parametres: { n: 60, compilation: 'auto' }, parts: 4, difficulte: 1, fils: 1, repetitions: 100 }
    const repetitions = Array.from({ length: 100 }, (_, rang) => ({
      dureeMs: (500 + rang * 5) * facteur, essais: 5, memoireOctets: 3_000_000, memoire: 'mesuree' as const, tailleOctets: 68,
      verification: { dureeMs: 1, memoireOctets: 1_200_000, memoire: 'mesuree' as const, valide: true },
    }))
    return {
      format: FORMAT_BANC, version: VERSION_BANC, date: '2026-09-19T00:00:00.000Z', paquet: '0.5.0', rapide: false,
      appareil: { detecte: { agent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0', coeurs: 8, memoireAppareilGo: 8, ecran: null, plateforme: 'Linux', webAssembly: true }, saisi: { modele, processeur: '', gpu: '', ram: '', remarques: '' } },
      scenarios: [resumer(scenario, repetitions, 8, 35)],
      verification: [{ algorithme: 'equix', parametres: { n: 60, compilation: 'auto' }, fils: 8, verifications: 1000, dureeMs: 3000, parSeconde: 30_000 / facteur }],
    }
  }

  test('produit les lignes du tableau, par appareil, et l’écart entre appareils', () => {
    const agregat = agreger([exportSynthetique('PC 2020', 1), exportSynthetique('Mobile', 4)])
    const ligne = (debut: string): Array<string | null> => agregat.lignes.find((l) => l.libelle.startsWith(debut))!.valeurs
    expect(agregat.colonnes.map((c) => c.id)).toEqual(['eq'])
    expect(ligne('Vérifier une preuve : temps')).toEqual(['250,0 µs'])
    expect(ligne('Combien de parts')).toEqual(['4 parts'])
    expect(ligne('sur PC 2020')[0]).toContain('≈ 134') // 100 000 / 747,5 ms
    expect(ligne('Écart en scénario d’usage')).toEqual(['× 4,0'])
    expect(ligne('Vérifications par seconde, tous les cœurs, sur Mobile')).toEqual(['7\u202f500 (8 fils)'])
    expect(versMarkdown(agregat)).toContain('| Equi-X essai |')
  })

  test('refuse un fichier d’un autre format ou d’une autre version', () => {
    expect(() => lireExport(JSON.stringify({ format: 'autre', version: 1 }), 'a.json')).toThrow('format « autre »')
    expect(() => lireExport(JSON.stringify({ format: FORMAT_BANC, version: 2 }), 'b.json')).toThrow('version 2')
  })
})

describe('le banc reste hors du paquet', () => {
  test('ni hash-wasm ni le banc dans dist/ ni dans les dépendances d’exécution', () => {
    const paquet = JSON.parse(readFileSync(resolve(racine, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies: Record<string, string>; files: string[] }
    expect(paquet.dependencies ?? {}).toEqual({})
    expect(paquet.devDependencies['hash-wasm']).toBe('4.12.0')
    expect(paquet.files).toEqual(['dist', 'LICENSE', 'COPYING', 'README.md'])
    const chargeur = readFileSync(resolve(racine, 'dist/index.js'), 'utf8')
    expect(chargeur).not.toMatch(/argon2|hash-wasm|hashcash|banc/i)
  })
})
