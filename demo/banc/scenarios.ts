// Scénarios du banc standardisé, leur validation, leurs statistiques et
// l’estimation de leur durée. Sans DOM : testé dans tests/banc.test.ts.
//
// Rien de ce dossier n’entre dans le paquet publié (dist/) : c’est un outil de
// la démo, pour remplir le tableau comparatif du README.

import { EFFORT_MAX, N_VALIDES, PARTS_MAX, msParEssai, probabiliteEssai } from '../../src/index.ts'

export type Algorithme = 'sha256' | 'argon2id' | 'equix'
export const ALGORITHMES: readonly Algorithme[] = ['sha256', 'argon2id', 'equix']

export interface ParametresArgon2id {
  /** Mémoire en Kio (paramètre m d’Argon2). */
  memoireKio: number
  /** Passes (paramètre t). */
  iterations: number
  /** Voies (paramètre p) ; hash-wasm les calcule l’une après l’autre sur un fil. */
  parallelisme: number
}

export interface ParametresEquix {
  n: number
  compilation: 'auto' | 'jamais'
}

/**
 * Un scénario : un algorithme, ses paramètres, le nombre de parts de la preuve,
 * la difficulté de chaque part, le nombre de fils et le nombre de répétitions.
 * Difficulté : bits nuls en tête de l’empreinte (SHA-256, Argon2id : une
 * chance sur 2^difficulte par essai) ; effort d’Equi-X (règle de Tor).
 */
export type Scenario = {
  id: string
  /** Libellé libre, repris dans les exports et l’agrégation. */
  libelle?: string
  parts: number
  difficulte: number
  /** Nombre de Web Workers, ou `coeurs` : `navigator.hardwareConcurrency`. */
  fils: number | 'coeurs'
  repetitions: number
} & (
  | { algorithme: 'sha256'; parametres: Record<string, never> }
  | { algorithme: 'argon2id'; parametres: ParametresArgon2id }
  | { algorithme: 'equix'; parametres: ParametresEquix }
)

/** Au moins 100 répétitions par scénario pour des centiles p5/p95 fiables ; le mode rapide les réduit. */
export const REPETITIONS_MIN = 100
export const REPETITIONS_RAPIDE = 10

/**
 * Scénarios PROVISOIRES : à remplacer par les valeurs arbitrées. Ils visent
 * grossièrement « ≈ 1 s par défi » sur un portable récent, sans plus.
 */
export const SCENARIOS_PROVISOIRES: Scenario[] = [
  { id: 'sha256-4x20', libelle: 'PROVISOIRE SHA-256, 4 parts de 20 bits', algorithme: 'sha256', parametres: {}, parts: 4, difficulte: 20, fils: 'coeurs', repetitions: REPETITIONS_MIN },
  { id: 'argon2id-64m-4x1', libelle: 'PROVISOIRE Argon2id 64 Mio, t = 1, 4 parts de 1 bit', algorithme: 'argon2id', parametres: { memoireKio: 65_536, iterations: 1, parallelisme: 1 }, parts: 4, difficulte: 1, fils: 'coeurs', repetitions: REPETITIONS_MIN },
  { id: 'equix-n60-4x4', libelle: 'PROVISOIRE Equi-X n = 60, 4 parts d’effort 4', algorithme: 'equix', parametres: { n: 60, compilation: 'auto' }, parts: 4, difficulte: 4, fils: 'coeurs', repetitions: REPETITIONS_MIN },
]

/** Durée d’une mesure de débit de vérification (par configuration et par nombre de fils). */
export const DUREE_BANC_VERIFICATION_MS = 3000

type Erreur = { erreur: string }

function entier(valeur: unknown, min: number, max: number): valeur is number {
  return typeof valeur === 'number' && Number.isInteger(valeur) && valeur >= min && valeur <= max
}

/** Valide une liste de scénarios (texte JSON ou valeur) ; messages en français, repris tels quels par la page. */
export function validerScenarios(valeur: unknown): { scenarios: Scenario[] } | Erreur {
  if (!Array.isArray(valeur) || valeur.length === 0) return { erreur: 'une liste non vide de scénarios est attendue' }
  const ids = new Set<string>()
  const scenarios: Scenario[] = []
  for (const [rang, brut] of valeur.entries()) {
    const ou = `scénario ${rang + 1}`
    if (typeof brut !== 'object' || brut === null) return { erreur: `${ou} : objet attendu` }
    const s = brut as Record<string, unknown>
    const connus = ['id', 'libelle', 'algorithme', 'parametres', 'parts', 'difficulte', 'fils', 'repetitions']
    const inconnu = Object.keys(s).find((cle) => !connus.includes(cle))
    if (inconnu) return { erreur: `${ou} : champ inconnu « ${inconnu} »` }
    if (typeof s.id !== 'string' || !/^[\w.-]{1,64}$/.test(s.id) || ids.has(s.id)) return { erreur: `${ou} : « id » unique attendu (lettres, chiffres, . _ -)` }
    ids.add(s.id)
    if (s.libelle !== undefined && typeof s.libelle !== 'string') return { erreur: `${ou} : « libelle » doit être un texte` }
    if (!ALGORITHMES.includes(s.algorithme as Algorithme)) return { erreur: `${ou} : « algorithme » parmi ${ALGORITHMES.join(', ')}` }
    if (!entier(s.parts, 1, PARTS_MAX)) return { erreur: `${ou} : « parts » entier de 1 à ${PARTS_MAX}` }
    if (!(s.fils === 'coeurs' || entier(s.fils, 1, 64))) return { erreur: `${ou} : « fils » entier de 1 à 64 ou « coeurs »` }
    if (!entier(s.repetitions, 1, 100_000)) return { erreur: `${ou} : « repetitions » entier de 1 à 100 000` }
    const p = (s.parametres ?? {}) as Record<string, unknown>
    if (typeof p !== 'object' || p === null || Array.isArray(p)) return { erreur: `${ou} : « parametres » objet attendu` }
    if (s.algorithme === 'sha256') {
      if (Object.keys(p).length) return { erreur: `${ou} : SHA-256 n’a pas de paramètres` }
      if (!entier(s.difficulte, 0, 40)) return { erreur: `${ou} : « difficulte » (bits nuls) de 0 à 40` }
    } else if (s.algorithme === 'argon2id') {
      if (Object.keys(p).some((cle) => !['memoireKio', 'iterations', 'parallelisme'].includes(cle))) return { erreur: `${ou} : paramètres Argon2id : memoireKio, iterations, parallelisme` }
      if (!entier(p.memoireKio, 8, 4 * 1024 * 1024) || !entier(p.iterations, 1, 100) || !entier(p.parallelisme, 1, 16)) return { erreur: `${ou} : Argon2id : memoireKio de 8 à 4 194 304, iterations de 1 à 100, parallelisme de 1 à 16` }
      if ((p.memoireKio as number) < 8 * (p.parallelisme as number)) return { erreur: `${ou} : Argon2id : memoireKio doit valoir au moins 8 × parallelisme` }
      if (!entier(s.difficulte, 0, 20)) return { erreur: `${ou} : « difficulte » (bits nuls) de 0 à 20` }
    } else {
      if (Object.keys(p).some((cle) => !['n', 'compilation'].includes(cle))) return { erreur: `${ou} : paramètres Equi-X : n, compilation` }
      if (!(N_VALIDES as readonly unknown[]).includes(p.n) || !['auto', 'jamais'].includes(p.compilation as string)) return { erreur: `${ou} : Equi-X : n parmi ${N_VALIDES.join(', ')}, compilation « auto » ou « jamais »` }
      if (!entier(s.difficulte, 1, EFFORT_MAX)) return { erreur: `${ou} : « difficulte » (effort) de 1 à ${EFFORT_MAX}` }
    }
    scenarios.push({ ...(s as unknown as Scenario), parametres: p } as Scenario)
  }
  return { scenarios }
}

/** Probabilité qu’un essai réussisse. */
export function probabiliteSucces(scenario: Scenario): number {
  return scenario.algorithme === 'equix' ? probabiliteEssai(scenario.difficulte) : 2 ** -scenario.difficulte
}

/** Essais attendus pour une preuve du scénario. */
export function essaisAttendusScenario(scenario: Scenario): number {
  return scenario.parts / probabiliteSucces(scenario)
}

/** Clé d’une configuration de calcul (algorithme et paramètres) : même coût par essai. */
export function cleConfiguration(scenario: Scenario): string {
  return `${scenario.algorithme}:${JSON.stringify(scenario.parametres)}`
}

export function filsEffectifs(scenario: Scenario, coeurs: number): number {
  return scenario.fils === 'coeurs' ? Math.max(1, coeurs) : scenario.fils
}

/**
 * Durée d’un essai par défaut, avant calibrage (PROVISOIRE, portable x86-64) :
 * SHA-256 ≈ 1 µs ; Argon2id ≈ 1,5 ns par Kio et par passe ; Equi-X d’après
 * les références de la bibliothèque. Le calibrage les remplace par des mesures.
 */
export function msParEssaiReference(scenario: Scenario): number {
  if (scenario.algorithme === 'sha256') return 0.001
  if (scenario.algorithme === 'argon2id') return scenario.parametres.memoireKio * scenario.parametres.iterations * 1.5e-6 + 1
  return msParEssai(scenario.parametres.compilation === 'jamais' ? 'wasm' : 'wasmCompile', scenario.parametres.n)
}

/** Durée estimée d’un scénario (preuves et leur vérification), en ms. */
export function estimerScenario(scenario: Scenario, coeurs: number, msParEssai: number, repetitions = scenario.repetitions): number {
  const fils = filsEffectifs(scenario, coeurs)
  const essais = essaisAttendusScenario(scenario)
  // Parallélisme utile : pas plus de fils que d’essais attendus.
  const parPreuve = essais * msParEssai / Math.max(1, Math.min(fils, essais))
  const verification = scenario.algorithme === 'equix' ? scenario.parts * 0.3 : scenario.parts * msParEssai
  return repetitions * (parPreuve + verification)
}

export interface Statistiques {
  nombre: number
  moyenne: number
  mediane: number
  p5: number
  p10: number
  p90: number
  p95: number
  min: number
  max: number
  /** Rapport p95 / p5 : 2 ou moins signifie que 90 % des défis durent « du simple au double » au plus. */
  rapportP95P5: number
}

/** Centile par interpolation linéaire entre rangs (méthode 7 de Hyndman et Fan, celle des tableurs). */
export function centile(triees: readonly number[], rang: number): number {
  if (!triees.length) return Number.NaN
  const position = (triees.length - 1) * rang
  const bas = Math.floor(position)
  const haut = Math.ceil(position)
  return triees[bas]! + (triees[haut]! - triees[bas]!) * (position - bas)
}

export function statistiques(valeurs: readonly number[]): Statistiques {
  const triees = [...valeurs].sort((a, b) => a - b)
  const moyenne = triees.reduce((somme, valeur) => somme + valeur, 0) / Math.max(1, triees.length)
  const p5 = centile(triees, 0.05)
  const p95 = centile(triees, 0.95)
  return {
    nombre: triees.length, moyenne, mediane: centile(triees, 0.5), p5, p10: centile(triees, 0.1), p90: centile(triees, 0.9), p95,
    min: triees[0] ?? Number.NaN, max: triees.at(-1) ?? Number.NaN, rapportP95P5: p95 / p5,
  }
}

/**
 * Défis résolus en 100 s : extrapolé de la durée moyenne, et mesuré quand les
 * répétitions, enchaînées, couvrent au moins 100 s (null sinon).
 */
export function debit100s(durees: readonly number[]): { extrapole: number; mesure: number | null } {
  const moyenne = durees.reduce((somme, valeur) => somme + valeur, 0) / Math.max(1, durees.length)
  let cumul = 0
  let resolus = 0
  for (const duree of durees) {
    cumul += duree
    if (cumul > 100_000) break
    resolus++
  }
  return { extrapole: 100_000 / moyenne, mesure: cumul >= 100_000 ? resolus : null }
}
