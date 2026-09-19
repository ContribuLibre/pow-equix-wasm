// Calculs et formats de la démo, sans DOM : validation des réglages importés
// (fichier ou adresse), probabilités de taille de preuve, noms de fichiers,
// choix de la langue. Testés dans tests/demo.test.ts.

import { EFFORT_MAX, N_VALIDES, PARTS_MAX, probabiliteEssai, tailleSolution } from '../src/index.ts'
import type { Langue, Textes } from './textes.ts'

export interface Reglages {
  effort: number
  nombre: number
  n: number
  compilation: 'auto' | 'jamais'
  repartition: 'fixe' | 'adaptatif'
  fils: number
  moteur: 'auto' | 'wasm' | 'js'
  repetitions: number
  verifications: number
}

export const FORMAT_REGLAGES = 'pow-equix-wasm/reglages'
export const FORMAT_MESURES = 'pow-equix-wasm/mesures'

type Regle = { entier: [number, number] } | { parmi: readonly (string | number)[] }

/** Champs connus et leurs bornes : les mêmes que celles du formulaire. */
export const REGLES: Record<keyof Reglages, Regle> = {
  effort: { entier: [1, EFFORT_MAX] },
  nombre: { entier: [1, PARTS_MAX] },
  n: { parmi: N_VALIDES },
  compilation: { parmi: ['auto', 'jamais'] },
  repartition: { parmi: ['fixe', 'adaptatif'] },
  fils: { entier: [0, 64] },
  moteur: { parmi: ['auto', 'wasm', 'js'] },
  repetitions: { entier: [1, 200] },
  verifications: { entier: [1, 100_000] },
}

type Erreurs = Textes['dynamique']['erreurs']
export type Lecture = { reglages: Partial<Reglages> } | { erreur: string }

/** Valide un objet de réglages : champs connus seulement, bornes respectées ; les absents gardent leur valeur. */
export function validerReglages(valeur: unknown, erreurs: Erreurs): Lecture {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) return { erreur: erreurs.objet }
  const reglages: Partial<Record<keyof Reglages, unknown>> = {}
  for (const [champ, contenu] of Object.entries(valeur)) {
    if (!(champ in REGLES)) return { erreur: erreurs.champInconnu(champ) }
    const regle = REGLES[champ as keyof Reglages]
    if ('entier' in regle) {
      const [min, max] = regle.entier
      if (typeof contenu !== 'number' || !Number.isInteger(contenu) || contenu < min || contenu > max) return { erreur: erreurs.valeur(champ, erreurs.entier(min, max)) }
    } else if (!regle.parmi.includes(contenu as string | number)) {
      return { erreur: erreurs.valeur(champ, erreurs.parmi(regle.parmi.join(', '))) }
    }
    reglages[champ as keyof Reglages] = contenu
  }
  return { reglages: reglages as Partial<Reglages> }
}

/**
 * Lit un fichier de réglages (`pow-equix-wasm/reglages`), ou de mesures
 * (`pow-equix-wasm/mesures`, dont seuls les réglages servent) : de quoi refaire
 * le même test sur un autre appareil.
 */
export function lireFichierReglages(texte: string, erreurs: Erreurs): Lecture {
  let contenu: unknown
  try {
    contenu = JSON.parse(texte)
  } catch {
    return { erreur: erreurs.json }
  }
  if (typeof contenu !== 'object' || contenu === null || Array.isArray(contenu)) return { erreur: erreurs.objet }
  const { format, version, reglages, ...autres } = contenu as Record<string, unknown>
  if (format !== FORMAT_REGLAGES && format !== FORMAT_MESURES) return { erreur: erreurs.format(String(format)) }
  if (version !== 1) return { erreur: erreurs.valeur('version', '1') }
  if (format === FORMAT_REGLAGES) {
    const inconnu = Object.keys(autres)[0]
    if (inconnu !== undefined) return { erreur: erreurs.champInconnu(inconnu) }
  }
  return validerReglages(reglages, erreurs)
}

export function fichierReglages(reglages: Reglages): string {
  return `${JSON.stringify({ format: FORMAT_REGLAGES, version: 1, reglages }, null, 2)}\n`
}

/** Réglages dans l’adresse, pour passer d’une langue à l’autre sans les perdre. */
export function versParametres(reglages: Reglages): URLSearchParams {
  return new URLSearchParams(Object.entries(reglages).map(([champ, valeur]) => [champ, String(valeur)]))
}

/** Réglages lus dans l’adresse ; un paramètre invalide est ignoré. */
export function depuisParametres(parametres: URLSearchParams, erreurs: Erreurs): Partial<Reglages> {
  const lus: Partial<Reglages> = {}
  for (const [champ, texte] of parametres) {
    const regle = REGLES[champ as keyof Reglages]
    if (!regle) continue
    const valeur = 'entier' in regle || champ === 'n' ? Number(texte) : texte
    const lecture = validerReglages({ [champ]: valeur }, erreurs)
    if ('reglages' in lecture) Object.assign(lus, lecture.reglages)
  }
  return lus
}

/** Taille exacte d’une preuve quand chaque écart de compteur tient sur un octet (moins de 128). */
export function tailleCourante(nombre: number, n: number): number {
  return nombre * (1 + tailleSolution(n))
}

/**
 * Probabilité qu’au moins un écart de compteur dépasse 127 (donc prenne 2
 * octets ou plus) : 128 essais ratés d’affilée, `(1 − p)^128` par part, avec
 * p = `probabiliteEssai(effort)` ; les compteurs sont distribués dans l’ordre.
 */
export function probabiliteEcartLong(effort: number, nombre: number): number {
  const parPart = (1 - probabiliteEssai(effort)) ** 128
  return 1 - (1 - parPart) ** nombre
}

/** Navigateur et système, en clair, d’après l’agent utilisateur : pour nommer les fichiers. */
export function descriptionAppareil(agent: string): string {
  const navigateur = /Edg\//.test(agent) ? 'edge' : /OPR\//.test(agent) ? 'opera' : /Firefox\//.test(agent) ? 'firefox'
    : /HeadlessChrome\//.test(agent) ? 'chromium-headless' : /Chrom(e|ium)\//.test(agent) ? 'chromium' : /Safari\//.test(agent) ? 'safari' : 'navigateur'
  const systeme = /Android/.test(agent) ? 'android' : /iPhone|iPad|iOS/.test(agent) ? 'ios' : /Windows/.test(agent) ? 'windows'
    : /Mac OS X|Macintosh/.test(agent) ? 'macos' : /CrOS/.test(agent) ? 'chromeos' : /Linux/.test(agent) ? 'linux' : 'systeme'
  return `${navigateur}-${systeme}`
}

function horodatage(date: Date): string {
  const deux = (valeur: number): string => String(valeur).padStart(2, '0')
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}_${deux(date.getHours())}h${deux(date.getMinutes())}`
}

/** Par exemple `pow-equix-mesures_firefox-android_n60_2026-09-19_14h05.json`. */
export function nomFichierMesures(agent: string, n: number, date: Date): string {
  return `pow-equix-mesures_${descriptionAppareil(agent)}_n${n}_${horodatage(date)}.json`
}

export function nomFichierReglages(reglages: Reglages, date: Date): string {
  return `pow-equix-reglages_n${reglages.n}_effort${reglages.effort}_${reglages.nombre}parts_${horodatage(date)}.json`
}

/** Français si l’une des langues préférées commence par « fr », sinon anglais. */
export function langueNavigateur(langues: readonly string[]): Langue {
  return langues.some((langue) => /^fr\b/i.test(langue)) ? 'fr' : 'en'
}
