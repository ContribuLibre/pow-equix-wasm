// Tests des outils de la démo (sans DOM) et de ses deux dictionnaires.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  FORMAT_MESURES, FORMAT_REGLAGES, type Reglages, depuisParametres, descriptionAppareil, fichierReglages, langueNavigateur, lireFichierReglages,
  nomFichierMesures, probabiliteEcartLong, tailleCourante, versParametres,
} from '../demo/outils.ts'
import { TEXTES } from '../demo/textes.ts'

const erreurs = TEXTES.fr.dynamique.erreurs
const complets: Reglages = { effort: 16, nombre: 4, n: 64, compilation: 'jamais', repartition: 'adaptatif', fils: 3, moteur: 'wasm', repetitions: 7, verifications: 250 }

describe('réglages exportés et importés', () => {
  test('un fichier exporté se réimporte à l’identique, y compris depuis un fichier de mesures', () => {
    expect(lireFichierReglages(fichierReglages(complets), erreurs)).toEqual({ reglages: complets })
    const mesures = JSON.stringify({ format: FORMAT_MESURES, version: 1, appareil: {}, reglages: complets, preuves: [] })
    expect(lireFichierReglages(mesures, erreurs)).toEqual({ reglages: complets })
    expect(JSON.parse(fichierReglages(complets)).format).toBe(FORMAT_REGLAGES)
  })

  test('un fichier invalide est refusé avec un message clair, dans chaque langue', () => {
    const fichier = (reglages: unknown, entete: Record<string, unknown> = {}): string => JSON.stringify({ format: FORMAT_REGLAGES, version: 1, reglages, ...entete })
    const cas: Array<[string, string]> = [
      ['pas du json', 'ce n’est pas du JSON valide.'],
      ['[1, 2]', 'un objet JSON est attendu.'],
      [JSON.stringify({ format: 'autre', version: 1, reglages: {} }), 'format « autre » inconnu'],
      [fichier({}, { version: 2 }), '« version » doit être 1.'],
      [fichier({}, { extra: true }), 'champ inconnu « extra ».'],
      [fichier({ vitesse: 3 }), 'champ inconnu « vitesse ».'],
      [fichier({ effort: 0 }), '« effort » doit être un entier de 1 à 4294967295.'],
      [fichier({ effort: 1.5 }), '« effort » doit être un entier'],
      [fichier({ nombre: 65 }), '« nombre » doit être un entier de 1 à 64.'],
      [fichier({ n: 62 }), '« n » doit être l’une de ces valeurs : 60, 64, 68, 72, 76, 80.'],
      [fichier({ n: '60' }), '« n » doit être l’une de ces valeurs'],
      [fichier({ moteur: 'gpu' }), '« moteur » doit être l’une de ces valeurs : auto, wasm, js.'],
      [fichier({ fils: -1 }), '« fils » doit être un entier de 0 à 64.'],
      [fichier(null), 'un objet JSON est attendu.'],
    ]
    for (const [texte, attendu] of cas) {
      const lecture = lireFichierReglages(texte, erreurs)
      expect('erreur' in lecture ? lecture.erreur : 'accepté').toContain(attendu)
    }
    const anglais = lireFichierReglages(fichier({ nombre: 65 }), TEXTES.en.dynamique.erreurs)
    expect('erreur' in anglais && anglais.erreur).toBe('“nombre” must be an integer from 1 to 64.')
    // Un fichier partiel ne touche qu’aux champs présents.
    expect(lireFichierReglages(fichier({ effort: 8 }), erreurs)).toEqual({ reglages: { effort: 8 } })
  })

  test('les réglages passent d’une langue à l’autre par l’adresse, et un paramètre invalide est ignoré', () => {
    expect(depuisParametres(versParametres(complets), erreurs)).toEqual(complets)
    expect(depuisParametres(new URLSearchParams('effort=0&nombre=8&n=61&moteur=gpu&inconnu=1'), erreurs)).toEqual({ nombre: 8 })
  })
})

describe('prévisions de taille', () => {
  test('taille exacte avec des écarts d’un octet, et probabilité qu’un écart dépasse 127', () => {
    expect(tailleCourante(4, 60)).toBe(68)
    expect(tailleCourante(4, 80)).toBe(88)
    // Effort 1 : 86 % de réussite par essai, un écart de 128 est impossible en pratique.
    expect(probabiliteEcartLong(1, 4)).toBeLessThan(1e-50)
    // Effort 64 : ≈ 3 % par essai, (1 − p)^128 ≈ 1,9 % par part, ≈ 7 % pour 4 parts.
    expect(probabiliteEcartLong(64, 1)).toBeCloseTo(0.019, 3)
    expect(probabiliteEcartLong(64, 4)).toBeCloseTo(1 - (1 - probabiliteEcartLong(64, 1)) ** 4, 10)
    expect(probabiliteEcartLong(16, 4)).toBeLessThan(0.01)
    expect(probabiliteEcartLong(32, 4)).toBeGreaterThan(0.001)
  })
})

describe('fichiers et langue', () => {
  test('nom de fichier daté et parlant', () => {
    const date = new Date(2026, 8, 19, 14, 5)
    expect(nomFichierMesures('Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0', 60, date)).toBe('pow-equix-mesures_firefox-android_n60_2026-09-19_14h05.json')
    expect(descriptionAppareil('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36')).toBe('chromium-linux')
    expect(descriptionAppareil('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('safari-ios')
  })

  test('la page d’accueil choisit le français si une langue préférée commence par « fr »', () => {
    expect(langueNavigateur(['de-DE', 'fr-CA'])).toBe('fr')
    expect(langueNavigateur(['FR'])).toBe('fr')
    expect(langueNavigateur(['en-US', 'frr'])).toBe('en')
    expect(langueNavigateur([])).toBe('en')
  })

  test('les deux dictionnaires ont les mêmes textes, et le modèle n’en demande aucun d’absent', () => {
    expect(Object.keys(TEXTES.en.page).sort()).toEqual(Object.keys(TEXTES.fr.page).sort())
    expect(Object.keys(TEXTES.en.dynamique).sort()).toEqual(Object.keys(TEXTES.fr.dynamique).sort())
    const modele = readFileSync(resolve(import.meta.dir, '../demo/modele.html'), 'utf8')
    const cles = [...modele.matchAll(/\{\{(\w+)\}\}/g)].map((correspondance) => correspondance[1]!)
    for (const cle of cles) if (!['langue', 'autreCode'].includes(cle)) expect([cle, cle in TEXTES.fr.page]).toEqual([cle, true])
  })
})
