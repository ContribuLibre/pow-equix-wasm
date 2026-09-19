// Tests du banc comparatif (démo seulement) : SHA-256 spécialisé, scénarios,
// statistiques, exécution sur de vrais Web Workers, agrégation, et absence de
// tout cela dans le paquet publié.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { calibrer, calibrerDifficulte, debitMaximal, debitVerification, monterParPaliers, repetition, resumer } from '../demo/banc/executeur.ts'
import { Garde, cleMemoire, paliers } from '../demo/banc/garde.ts'
import { resumeMachine, validerConfigMachine } from '../demo/banc/machine.ts'
import { tailleNonces, verifierNonces, zerosEnTete } from '../demo/banc/moteurs.ts'
import {
  type Scenario, SCENARIOS_PROVISOIRES, TENTATIVES_MAX, ajusterDifficulte, centile, debit100s, difficultePourDuree, empreinteFichier,
  auDessusDeLaCible, essaisAttendusScenario, estimerScenario, fichierProvisoire, plafondFils, statistiques, validerFichierScenarios, validerScenarios,
} from '../demo/banc/scenarios.ts'
import { Stockage, type Support } from '../demo/banc/stockage.ts'
import { type ExportBanc, FORMAT_BANC, VERSION_BANC } from '../demo/banc/schema.ts'
import { hacheurHashcash } from '../demo/banc/sha256.ts'
import { agreger, ficheResumee, lireAttaque, lireExport, versMarkdown } from '../scripts/agreger-banc.ts'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

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
  test('les scénarios par défaut sont ceux arbitrés, valides, avec au moins 100 répétitions sur tous les cœurs', () => {
    expect(validerScenarios(SCENARIOS_PROVISOIRES)).toEqual({ scenarios: SCENARIOS_PROVISOIRES })
    const resume = SCENARIOS_PROVISOIRES.map((s) => `${s.algorithme}${s.algorithme === 'argon2id' ? `-${s.parametres.memoireKio / 1024}m` : s.algorithme === 'equix' ? `-n${s.parametres.n}` : ''} ${s.parts}×${s.difficulte}`)
    expect(resume).toEqual(['sha256 13×19', 'argon2id-16m 12×2', 'argon2id-64m 5×1', 'equix-n60 13×33', 'equix-n72 7×7', 'equix-n80 3×2'])
    expect(SCENARIOS_PROVISOIRES.every((s) => s.repetitions >= 100 && s.fils === 'coeurs')).toBe(true)
    expect(fichierProvisoire().dureeCibleMs).toBe(1000)
    // n = 80 reste au-dessus de la cible : plancher d’effort 2, signalé dans le libellé.
    const n80 = SCENARIOS_PROVISOIRES.find((s) => s.id === 'equix-n80-3x2')!
    expect(n80.difficulteMin).toBe(2)
    expect(n80.libelle).toContain('au-dessus de la cible')
    expect(ajusterDifficulte(n80, 1300, 1000)).toBe(2)
    expect(auDessusDeLaCible(n80, 1300, 1000)).toBe(true)
    expect(auDessusDeLaCible(n80, 1100, 1000)).toBe(false)
  })

  test('le fichier de scénarios se valide, accepte une simple liste, et son empreinte change avec son contenu', async () => {
    const fichier = fichierProvisoire()
    expect(validerFichierScenarios(fichier)).toEqual({ fichier })
    expect(validerFichierScenarios(SCENARIOS_PROVISOIRES)).toEqual({ fichier })
    expect(validerFichierScenarios({ ...fichier, dureeCibleMs: 0 })).toMatchObject({ erreur: expect.stringContaining('dureeCibleMs') })
    expect(validerFichierScenarios({ ...fichier, autre: 1 })).toMatchObject({ erreur: 'champ inconnu « autre »' })
    const empreinte = await empreinteFichier(fichier)
    expect(empreinte).toMatch(/^[0-9a-f]{16}$/)
    expect(await empreinteFichier({ ...fichier, dureeCibleMs: 2000 })).not.toBe(empreinte)
  })

  test('tous les cœurs par défaut, un fil sans parallélisation, plafond de la mémoire annoncée et limite du garde-fou', () => {
    const argon64 = SCENARIOS_PROVISOIRES.find((s) => s.id === 'argon2id-64m-5x1')!
    const equix = SCENARIOS_PROVISOIRES.find((s) => s.id === 'equix-n60-13x33')!
    const seul: Scenario = { ...equix, id: 'seul', sansParallelisation: true }
    const sha = SCENARIOS_PROVISOIRES.find((s) => s.algorithme === 'sha256')!
    expect(plafondFils(sha, 16, null)).toMatchObject({ demandes: 16, retenus: 16, applique: false })
    expect(plafondFils(seul, 16, 8)).toMatchObject({ demandes: 1, retenus: 1, applique: false })
    // 4 Go : 1/32 → 128 Mio, soit 1 fil d’Argon2id à 64 Mio (65 Mio avec le reste), 41 d’Equi-X n = 60.
    expect(plafondFils(argon64, 8, 4)).toMatchObject({ demandes: 8, retenus: 1, applique: true, budgetMio: 128, source: 'deviceMemory' })
    expect(plafondFils(equix, 8, 4)).toMatchObject({ retenus: 8, applique: false })
    // Mémoire inconnue : plus de budget fixe, jusqu’aux cœurs (32 ici) ; seul le garde-fou limite après un plantage.
    expect(plafondFils(argon64, 32, null)).toMatchObject({ demandes: 32, retenus: 32, applique: false, source: null, budgetMio: null })
    expect(plafondFils(argon64, 32, null, { limite: 4, raison: 'plantage à 8 fils' })).toMatchObject({ retenus: 4, applique: true, source: 'garde', limiteGarde: 4, raisonGarde: 'plantage à 8 fils' })
    // Les deux à la fois : le plus strict l’emporte ; SHA-256 n’a pas de garde-fou.
    expect(plafondFils(argon64, 32, 4, { limite: 4, raison: '' })).toMatchObject({ retenus: 1, source: 'deviceMemory' })
    expect(plafondFils(sha, 32, null, { limite: 2, raison: '' })).toMatchObject({ retenus: 32, applique: false, limiteGarde: null })
  })

  test('calibrage des difficultés : estimation initiale et ajustement', () => {
    const sha: Scenario = { id: 's', algorithme: 'sha256', parametres: {}, parts: 4, difficulte: 0, repetitions: 100 }
    // 1 s sur 8 fils à 1 µs par essai : 8 000 000 essais, 2 000 000 par part → 2^21.
    expect(difficultePourDuree(sha, 1000, 0.001, 8)).toBe(21)
    expect(ajusterDifficulte({ ...sha, difficulte: 21 }, 250, 1000)).toBe(23)
    expect(ajusterDifficulte({ ...sha, difficulte: 21 }, 1400, 1000)).toBe(21)
    const equix: Scenario = { id: 'e', algorithme: 'equix', parametres: { n: 60, compilation: 'auto' }, parts: 4, difficulte: 1, repetitions: 100 }
    // 1 s sur 8 fils à 40 ms par essai : 200 essais, 50 par part → effort ≈ 100.
    const effort = difficultePourDuree(equix, 1000, 40, 8)
    expect(effort).toBeGreaterThan(90)
    expect(effort).toBeLessThan(110)
    expect(ajusterDifficulte({ ...equix, difficulte: 100 }, 500, 1000)).toBe(200)
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
    expect([s.min, s.p5, s.p10, s.mediane, s.p90, s.p95, s.max, s.moyenne]).toEqual([100, 105, 110, 150, 190, 195, 200, 150])
    expect(s.rapportP90P10).toBeCloseTo(190 / 110)
    expect(s.rapportP95P5).toBeCloseTo(195 / 105)
    expect(debit100s([1000, 1000, 1000])).toEqual({ extrapole: 100, mesure: null })
    expect(debit100s(Array.from({ length: 150 }, () => 1000))).toEqual({ extrapole: 100, mesure: 100 })
    const sha: Scenario = { id: 's', algorithme: 'sha256', parametres: {}, parts: 4, difficulte: 10, fils: 2, repetitions: 100 }
    expect(essaisAttendusScenario(sha)).toBe(4096)
    expect(estimerScenario(sha, 2, 0.001)).toBeCloseTo(100 * (4096 * 0.001 / 2 + 4 * 0.001))
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
      const plafond = plafondFils(scenario, env.coeurs, 8)
      const repetitions = [await repetition(scenario, plafond.retenus, env), await repetition(scenario, plafond.retenus, env)]
      expect(repetitions.every((r) => r.verification.valide && r.essais >= scenario.parts && r.dureeMs > 0)).toBe(true)
      const resultat = resumer(scenario, repetitions, plafond, null)
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

  test('débit maximal : des défis en parallèle, un fil chacun, comptés dans la fenêtre', async () => {
    const scenario: Scenario = { id: 'sha', algorithme: 'sha256', parametres: {}, parts: 1, difficulte: 10, repetitions: 1 }
    const debit = await debitMaximal(scenario, 2, env, 800)
    expect(debit.concurrence).toBe(2)
    expect(debit.defis).toBeGreaterThan(2)
    // Rythme mesuré voie par voie sur les défis finis : proche du compte brut sur la fenêtre, sans le défi abandonné.
    expect(debit.dureeMs).toBeGreaterThanOrEqual(800)
    expect(debit.parCentSecondes).toBeGreaterThanOrEqual(debit.defis * 100_000 / debit.dureeMs * 0.9)
    expect(debit.parCentSecondes).toBeLessThan(debit.defis * 100_000 / debit.dureeMs * 2)
    expect(debit.dureeMoyenneDefiMs).toBeGreaterThan(0)
  }, 30_000)

  test('débit maximal : attend que chaque voie ait fini un défi, même au-delà de la fenêtre', async () => {
    // Défi d’environ 100 ms sur un fil, fenêtre de 20 ms : la mesure attend la fin du premier défi de chaque voie.
    const scenario: Scenario = { id: 'lent', algorithme: 'sha256', parametres: {}, parts: 1, difficulte: 16, repetitions: 1 }
    const debit = await debitMaximal(scenario, 2, env, 20)
    expect(debit.defis).toBeGreaterThanOrEqual(2)
    expect(debit.parCentSecondes).toBeGreaterThan(0)
  }, 30_000)

  test('mode calibrer : la difficulté converge vers la durée cible, et les parts augmentent si p90/p10 dépasse 2', async () => {
    const scenario: Scenario = { id: 'sha', algorithme: 'sha256', parametres: {}, parts: 2, difficulte: 0, repetitions: 1 }
    const tours: number[] = []
    const resultat = await calibrerDifficulte(scenario, 2, 60, env, { defis: 7, defisControle: 20, onTour: (difficulte) => tours.push(difficulte) })
    // 2 parts : p90/p10 dépasse souvent 2 ; alors le calibrage ajoute des parts.
    expect(resultat.parts).toBeGreaterThanOrEqual(2)
    if (resultat.parts > 2) expect(tours.length).toBeGreaterThan(2)
    expect(resultat.rapportP90P10).toBeGreaterThan(1)
    expect(tours.length).toBeGreaterThan(0)
    // Réglage par bits entiers : médiane à un facteur ≈ 2 près de la cible, sur une machine chargée.
    expect(resultat.medianeMs).toBeGreaterThan(15)
    expect(resultat.medianeMs).toBeLessThan(240)
    expect(resultat.difficulte).toBeGreaterThan(8)
  }, 60_000)

  test('une annulation arrête le défi en cours', async () => {
    const annulation = new AbortController()
    const calcul = repetition({ id: 'long', algorithme: 'sha256', parametres: {}, parts: 1, difficulte: 40, fils: 1, repetitions: 1 }, 1, { ...env, signal: annulation.signal })
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
    const plafond = { demandes: 8, retenus: 8, applique: false, budgetMio: 256, source: null, limiteGarde: null, raisonGarde: null }
    return {
      format: FORMAT_BANC, version: VERSION_BANC, date: '2026-09-19T00:00:00.000Z', paquet: '0.5.0', rapide: false, partiel: false,
      fichierScenarios: { ...fichierProvisoire(), empreinte: '0123456789abcdef' },
      appareil: { detecte: { agent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0', coeurs: 8, memoireAppareilGo: 8, ecran: null, plateforme: 'Linux', webAssembly: true }, saisi: { modele, processeur: '', gpu: '', ram: '', remarques: '' }, machine: null },
      gardeFils: {},
      scenarios: [resumer(scenario, repetitions, plafond, 35, { statut: 'complet', tentatives: 1, erreurs: [], debitMaximal: { concurrence: 8, dureeMs: 30_000, defis: 60 / facteur, parCentSecondes: 200 / facteur, dureeMoyenneDefiMs: 4000 * facteur } })],
      verification: [{ algorithme: 'equix', parametres: { n: 60, compilation: 'auto' }, fils: 8, verifications: 1000, dureeMs: 3000, parSeconde: 30_000 / facteur }],
    }
  }

  test('produit les lignes du tableau, par appareil, et les écarts d’usage et d’attaque', () => {
    const attaques = lireAttaque(JSON.stringify({ format: 'pow-equix-wasm/banc-attaque', version: 1, materiels: [{ nom: '10 000 €', debits: { eq: 2000 } }, { nom: '1 000 000 €', debits: { eq: 40_000 } }] }), 'attaque.json')
    const agregat = agreger([exportSynthetique('PC 2020', 1), exportSynthetique('Tablette', 2), exportSynthetique('Mobile', 4)], attaques)
    const ligne = (debut: string): Array<string | null> => agregat.lignes.find((l) => l.libelle.startsWith(debut))!.valeurs
    expect(agregat.colonnes.map((c) => c.id)).toEqual(['eq'])
    expect(ligne('Vérifier une preuve : temps')).toEqual(['250,0 µs'])
    expect(ligne('Combien de parts')).toEqual(['4 parts'])
    expect(ligne('Parts, et rapport p90/p10')[0]).toMatch(/^4 parts : 1,\d\d \(p95\/p5 : 1,\d\d\)$/)
    expect(ligne('Durée médiane d’un défi sur la machine de référence')[0]).toBe('748 ms (cible 1,00 s)')
    // Débit maximal (défis en parallèle) par appareil, extrapolé de 30 s ; latence à part.
    expect(ligne('sur PC 2020')).toEqual(['200 ¹'])
    expect(ligne('sur Mobile')).toEqual(['50,0 ¹'])
    expect(ligne('avec 10 000 €')).toEqual(['2\u202f000'])
    expect(ligne('Latence')[0]).toBe('2,99 s') // médiane 747,5 ms × 4 sur le mobile
    expect(ligne('Écart en scénario d’usage')).toEqual(['× 4,0'])
    expect(ligne('Écart en scénario d’attaque (10 000 €) ÷ pire appareil')).toEqual(['× 40,0'])
    expect(ligne('Écart en scénario d’attaque (10 000 €) ÷ appareil médian')).toEqual(['× 20,0'])
    expect(ligne('Écart en scénario d’attaque (1 000 000 €) ÷ appareil médian')).toEqual(['× 400'])
    expect(ligne('Résistance au DoS : vérifications par seconde, tous les cœurs, sur Mobile')).toEqual(['7\u202f500 (8 fils)'])
    expect(versMarkdown(agregat)).toContain('| Equi-X essai |')
  })

  test('les fiches machine donnent le nom des appareils et le tableau des appareils', () => {
    const avecFiche = exportSynthetique('ignoré', 1)
    avecFiche.appareil.machine = (validerConfigMachine(JSON.stringify(ficheLinux)) as { machine: NonNullable<ExportBanc["appareil"]["machine"]> }).machine
    avecFiche.gardeFils = { 'equix:n=80': { tentative: null, reussis: [1, 2, 4], limite: 4, raison: 'plantage à 8 fils' } }
    const agregat = agreger([avecFiche, exportSynthetique('Mobile', 4)])
    expect(agregat.lignes.some((l) => l.libelle === 'sur TUXEDO Aura 15 Gen1 {AMD Ryzen 7 4700U with Radeon Graphics 2,0 GHz sans turbo, 8/8 cœurs, 31 Gio, AMD Renoir}')).toBe(true)
    expect(agregat.appareils[0]).toEqual({
      nom: 'TUXEDO Aura 15 Gen1', processeur: 'AMD Ryzen 7 4700U with Radeon Graphics', frequence: '2,0 GHz (turbo désactivé)', coeurs: '8 physiques / 8 logiques',
      ram: '31 Gio', gpu: 'AMD Renoir', systeme: 'LMDE 7 (gigi)', limitesFils: 'equix:n=80 → 4',
    })
    expect(versMarkdown(agregat)).toContain('| TUXEDO Aura 15 Gen1 | AMD Ryzen 7 4700U with Radeon Graphics | 2,0 GHz (turbo désactivé) |')
    // Un export de version 2 (sans fiche machine ni garde-fou) reste lisible.
    const ancien = { ...exportSynthetique('Ancien', 1), version: 2 } as Record<string, unknown>
    delete ancien.gardeFils
    delete (ancien.appareil as Record<string, unknown>).machine
    expect(ficheResumee(lireExport(JSON.stringify(ancien), 'v2.json')).nom).toBe('Ancien')
  })

  test('en ligne de commande, avec ou sans fichier d’attaque, tous les fichiers sont lus', () => {
    const dossier = mkdtempSync(resolve(tmpdir(), 'agreger-'))
    const premier = resolve(dossier, 'a.json')
    const second = resolve(dossier, 'b.json')
    writeFileSync(premier, JSON.stringify(exportSynthetique('PC 2020', 1)))
    writeFileSync(second, JSON.stringify(exportSynthetique('Mobile', 4)))
    const attaque = resolve(dossier, 'attaque.json')
    writeFileSync(attaque, JSON.stringify({ format: 'pow-equix-wasm/banc-attaque', version: 1, materiels: [{ nom: '10 000 €', debits: { eq: 2000 } }] }))
    for (const argumentsCommande of [[premier, second], ['--attaque', attaque, premier, second], [premier, '--attaque', attaque, second]]) {
      const sortie = spawnSync('bun', [resolve(racine, 'scripts/agreger-banc.ts'), ...argumentsCommande], { encoding: 'utf8' })
      expect(sortie.status).toBe(0)
      expect(sortie.stdout).toContain('| sur PC 2020 |')
      expect(sortie.stdout).toContain('| sur Mobile |')
    }
  })

  test('refuse un fichier d’un autre format ou d’une autre version', () => {
    expect(() => lireExport(JSON.stringify({ format: 'autre', version: 1 }), 'a.json')).toThrow('format « autre »')
    expect(() => lireExport(JSON.stringify({ format: FORMAT_BANC, version: 1 }), 'b.json')).toThrow('version 1')
    expect(() => lireExport(JSON.stringify({ format: FORMAT_BANC, version: 4 }), 'b.json')).toThrow('version 4')
    expect(() => lireAttaque(JSON.stringify({ format: 'autre' }), 'c.json')).toThrow('pow-equix-wasm/banc-attaque')
  })
})

describe('reprise après un plantage', () => {
  function memoire(): Support {
    const donnees = new Map<string, string>()
    return {
      getItem: (cle) => donnees.get(cle) ?? null,
      setItem: (cle, valeur) => void donnees.set(cle, valeur),
      removeItem: (cle) => void donnees.delete(cle),
      key: (rang) => [...donnees.keys()][rang] ?? null,
      get length() { return donnees.size },
    }
  }
  const faite = { dureeMs: 10, essais: 1, memoireOctets: 0, memoire: 'estimee' as const, tailleOctets: 2, verification: { dureeMs: 1, memoireOctets: 0, memoire: 'estimee' as const, valide: true } }

  test('les répétitions stockées survivent au rechargement, par appareil, fichier et mode', () => {
    const support = memoire()
    const avant = new Stockage(support, 'appareil', 'empreinte', false)
    expect(avant.commencerTentative('s')).toBe(true)
    avant.modifier('s', (e) => { e.repetitions.push(faite, faite) })
    // « Plantage » : nouvelle instance, mêmes clés.
    const apres = new Stockage(support, 'appareil', 'empreinte', false)
    expect(apres.lire('s')).toMatchObject({ statut: 'enCours', tentatives: 1, repetitions: [faite, faite] })
    expect(new Stockage(support, 'appareil', 'autre-fichier', false).lire('s').repetitions).toEqual([])
    expect(new Stockage(support, 'appareil', 'empreinte', true).lire('s').repetitions).toEqual([])
  })

  test('au plus 3 tentatives : un plantage ou une erreur en consomme une, pas une annulation', () => {
    const magasin = new Stockage(memoire(), 'a', 'e', false)
    expect(magasin.commencerTentative('s')).toBe(true)
    magasin.rendreTentative('s') // annulation
    expect(magasin.lire('s').tentatives).toBe(0)
    for (let tentative = 1; tentative <= TENTATIVES_MAX; tentative++) {
      expect(magasin.commencerTentative('s')).toBe(true)
      magasin.echec('s', `erreur ${tentative}`)
    }
    expect(magasin.lire('s')).toMatchObject({ statut: 'incomplet', tentatives: 3, erreurs: ['erreur 1', 'erreur 2', 'erreur 3'] })
    expect(magasin.commencerTentative('s')).toBe(false)
    // Un scénario fini ne se relance pas.
    magasin.commencerTentative('t')
    magasin.modifier('t', (e) => { e.statut = 'complet' })
    expect(magasin.commencerTentative('t')).toBe(false)
  })

  test('le bouton d’effacement retire tous les résultats du banc, et eux seuls', () => {
    const support = memoire()
    support.setItem('autre/cle', 'garde')
    support.setItem('pow-equix-banc/fiche', '{}')
    const magasin = new Stockage(support, 'a', 'e', false)
    magasin.commencerTentative('s')
    magasin.ajouterVerification({ algorithme: 'sha256', parametres: {}, fils: 1, verifications: 1, dureeMs: 1, parSeconde: 1 })
    expect(Stockage.toutEffacer(support)).toBe(2)
    expect(support.length).toBe(2)
    expect(magasin.verifications()).toEqual([])
  })
})

const ficheLinux = {
  format: 'pow-equix-wasm/config-machine', version: 1, source: 'linux', date: '2026-09-19T17:37:51Z',
  machine: { fabricant: 'TUXEDO', modele: 'Aura 15 Gen1' },
  processeur: { modele: 'AMD Ryzen 7 4700U with Radeon Graphics', frequenceMaxMHz: 2000, turbo: false, coeursPhysiques: 8, coeursLogiques: 8, architecture: 'x86_64' },
  memoire: { totaleOctets: 32_996_069_376 }, gpu: ['AMD Renoir'], systeme: { nom: 'LMDE 7 (gigi)', noyau: 'Linux 6.12' },
}

describe('fiche machine par commande', () => {
  test('la commande Linux produit une fiche valide sur cette machine, sans réseau', () => {
    const dossier = mkdtempSync(resolve(tmpdir(), 'config-machine-'))
    const execution = spawnSync('bash', [resolve(racine, 'scripts/config-machine/linux.sh')], { cwd: dossier, encoding: 'utf8' })
    expect(execution.status).toBe(0)
    const lecture = validerConfigMachine(readFileSync(resolve(dossier, 'config-machine.json'), 'utf8'))
    expect('machine' in lecture).toBe(true)
    const machine = (lecture as { machine: { processeur: { coeursLogiques: number }; memoire: { totaleOctets: number } } }).machine
    expect(machine.processeur.coeursLogiques).toBeGreaterThan(0)
    expect(machine.memoire.totaleOctets).toBeGreaterThan(0)
    expect(execution.stdout).toContain('"format": "pow-equix-wasm/config-machine"')
    for (const script of ['linux.sh', 'macos.sh', 'android-termux.sh']) {
      expect(spawnSync('bash', ['-n', resolve(racine, 'scripts/config-machine', script)]).status).toBe(0)
      // Aucun appel réseau dans les commandes.
      expect(readFileSync(resolve(racine, 'scripts/config-machine', script), 'utf8')).not.toMatch(/\b(curl|wget|nc|ssh)\b/)
    }
    expect(readFileSync(resolve(racine, 'scripts/config-machine/windows.ps1'), 'utf8')).not.toMatch(/Invoke-WebRequest|Invoke-RestMethod|Net\.WebClient/)
  })

  test('une fiche est validée, résumée comme les lignes du tableau, et refusée si mal formée', () => {
    const lecture = validerConfigMachine(JSON.stringify(ficheLinux))
    expect(resumeMachine((lecture as { machine: Parameters<typeof resumeMachine>[0] }).machine)).toBe('TUXEDO Aura 15 Gen1 {AMD Ryzen 7 4700U with Radeon Graphics 2,0 GHz sans turbo, 8/8 cœurs, 31 Gio, AMD Renoir}')
    expect(resumeMachine({ ...(lecture as { machine: Parameters<typeof resumeMachine>[0] }).machine, machine: { fabricant: 'TUXEDO', modele: 'TUXEDO Aura 15 Gen1' } })).toMatch(/^TUXEDO Aura 15 Gen1 \{/)
    expect(validerConfigMachine('pas du json')).toEqual({ erreur: 'ce n’est pas du JSON valide' })
    expect(validerConfigMachine(JSON.stringify({ ...ficheLinux, format: 'autre' }))).toMatchObject({ erreur: expect.stringContaining('format') })
    expect(validerConfigMachine(JSON.stringify({ ...ficheLinux, gpu: 'une seule' }))).toMatchObject({ erreur: expect.stringContaining('mal formés') })
  })
})

describe('garde-fou des fils', () => {
  function memoire(): Support {
    const donnees = new Map<string, string>()
    return {
      getItem: (cle) => donnees.get(cle) ?? null,
      setItem: (cle, valeur) => void donnees.set(cle, valeur),
      removeItem: (cle) => void donnees.delete(cle),
      key: (rang) => [...donnees.keys()][rang] ?? null,
      get length() { return donnees.size },
    }
  }
  const n80: Scenario = { id: 'e80', algorithme: 'equix', parametres: { n: 80, compilation: 'auto' }, parts: 3, difficulte: 2, repetitions: 100 }

  test('paliers 1, 2, 4, 8… jusqu’aux cœurs, et réglage mémoire par algorithme', () => {
    expect(paliers(32)).toEqual([1, 2, 4, 8, 16, 32])
    expect(paliers(12)).toEqual([1, 2, 4, 8, 12])
    expect(paliers(1)).toEqual([1])
    expect(cleMemoire(n80)).toBe('equix:n=80')
    expect(cleMemoire({ id: 'a', algorithme: 'argon2id', parametres: { memoireKio: 65_536, iterations: 1, parallelisme: 1 }, parts: 1, difficulte: 1, repetitions: 1 })).toBe('argon2id:m=65536:p=1')
    expect(cleMemoire({ id: 's', algorithme: 'sha256', parametres: {}, parts: 1, difficulte: 1, repetitions: 1 })).toBeNull()
  })

  test('une tentative restée ouverte au rechargement fixe une limite définitive au dernier palier réussi', () => {
    const support = memoire()
    const avant = new Garde(support, 'appareil')
    for (const palier of [1, 2, 4, 8]) {
      avant.commencer('equix:n=80', palier)
      avant.reussir('equix:n=80', palier)
    }
    avant.commencer('equix:n=80', 16) // l’onglet est tué ici
    const apres = new Garde(support, 'appareil')
    expect(apres.constaterPlantages()).toEqual([{ memoire: 'equix:n=80', fils: 16, limite: 8 }])
    expect(apres.limite('equix:n=80')).toBe(8)
    expect(apres.lire('equix:n=80').raison).toContain('tentative à 16 fils')
    // Un plantage pendant le scénario à 8 fils (palier validé) : limite au palier en dessous, 4.
    apres.commencer('equix:n=80', 8)
    const encore = new Garde(support, 'appareil')
    expect(encore.constaterPlantages()).toEqual([{ memoire: 'equix:n=80', fils: 8, limite: 4 }])
    expect(encore.limite('equix:n=80')).toBe(4)
    // La limite ne remonte jamais, et une annulation n’est pas un plantage.
    encore.commencer('equix:n=80', 4)
    encore.abandonner('equix:n=80')
    expect(new Garde(support, 'appareil').constaterPlantages()).toEqual([])
    expect(encore.instantane()['equix:n=80']!.limite).toBe(4)
    // Autre appareil : pas concerné ; effacement explicite : limite levée.
    expect(new Garde(support, 'autre').limite('equix:n=80')).toBeNull()
    expect(Garde.toutEffacer(support)).toBe(1)
    expect(encore.limite('equix:n=80')).toBeNull()
  })

  test('la montée par paliers sur de vrais Web Workers note chaque palier réussi', async () => {
    const garde = new Garde(memoire(), 'appareil')
    const vus: number[] = []
    const atteint = await monterParPaliers(n80, 4, env, garde, (palier) => vus.push(palier))
    expect(atteint).toBe(4)
    expect(vus).toEqual([1, 2, 4])
    expect(garde.reussis('equix:n=80')).toEqual([1, 2, 4])
    // Déjà validés : rien à refaire.
    vus.length = 0
    expect(await monterParPaliers(n80, 4, env, garde, (palier) => vus.push(palier))).toBe(4)
    expect(vus).toEqual([])
    expect(garde.lire('equix:n=80').tentative).toBeNull()
  }, 120_000)

  test('les défis stockés à un autre nombre de fils sont écartés après un plantage', () => {
    const magasin = new Stockage(memoire(), 'a', 'e', false)
    const faite = { dureeMs: 10, essais: 1, memoireOctets: 0, memoire: 'estimee' as const, tailleOctets: 2, verification: { dureeMs: 1, memoireOctets: 0, memoire: 'estimee' as const, valide: true } }
    magasin.alignerFils('s', 8)
    magasin.modifier('s', (e) => { e.repetitions.push(faite) })
    magasin.alignerFils('s', 8)
    expect(magasin.lire('s').repetitions).toHaveLength(1)
    magasin.alignerFils('s', 4)
    expect(magasin.lire('s')).toMatchObject({ fils: 4, repetitions: [], erreurs: ['1 défi(s) à 8 fils écartés : repris à 4 fil(s)'] })
  })
})

describe('Argon2id réutilisable', () => {
  test('même empreinte que hash-wasm, appel après appel, avec une seule instance par réglage', async () => {
    const { argon2id } = await import('hash-wasm')
    const { hacheurArgon2id } = await import('../demo/banc/argon2.ts')
    const sel = new TextEncoder().encode('pow-equix/banc16')
    for (const reglage of [{ memoireKio: 64, iterations: 1, parallelisme: 1 }, { memoireKio: 1024, iterations: 2, parallelisme: 1 }, { memoireKio: 512, iterations: 3, parallelisme: 2 }]) {
      const hacheur = await hacheurArgon2id(reglage)
      for (let rang = 0; rang < 5; rang++) {
        const motDePasse = new TextEncoder().encode(`mot de passe ${rang}`)
        const attendu = await argon2id({ password: motDePasse, salt: sel, iterations: reglage.iterations, parallelism: reglage.parallelisme, memorySize: reglage.memoireKio, hashLength: 32, outputType: 'binary' })
        expect(hacheur.hacher(motDePasse, sel)).toEqual(attendu)
      }
    }
  })

  test('le module extrait correspond à hash-wasm (version figée)', async () => {
    const { extraireArgon2, contenuFichier } = await import('../scripts/extraire-argon2.ts')
    expect(readFileSync(resolve(racine, 'demo/banc/argon2-wasm.ts'), 'utf8')).toBe(contenuFichier(extraireArgon2()))
  })

  test('les essayeurs d’un même réglage partagent leur hacheur', async () => {
    const { hacheurArgon2 } = await import('../demo/banc/moteurs.ts')
    const reglage = { memoireKio: 64, iterations: 1, parallelisme: 1 }
    const premier = await hacheurArgon2(reglage)
    expect(await hacheurArgon2({ ...reglage })).toBe(premier)
    // Un autre réglage remplace le précédent (sa mémoire est lâchée).
    const autre = await hacheurArgon2({ ...reglage, memoireKio: 128 })
    expect(autre).not.toBe(premier)
    expect(await hacheurArgon2(reglage)).not.toBe(premier)
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
