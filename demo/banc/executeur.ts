// Exécution du banc, sans DOM : un défi (répétition) par scénario, sur des Web
// Workers créés pour lui puis arrêtés, comme une page qui calcule une preuve ;
// vérification de la preuve ; calibrage et débit de vérification.

import { ModuleEquix, resoudre } from '../../src/index.ts'
import { tailleNonces, verifierNonces } from './moteurs.ts'
import {
  type ParametresArgon2id, type Plafond, REGULARITE_MAX, type Scenario, ajusterDifficulte, centile, cleConfiguration, debit100s, difficultePourDuree, statistiques,
} from './scenarios.ts'
import type { DebitMaximal, DebitVerification, Repetition, ResultatScenario, StatutScenario } from './schema.ts'

export interface Environnement {
  /** Crée un Web Worker du banc (demo/banc/travailleur.ts une fois construit). */
  creerTravailleur: () => Worker
  /** Octets de equix.wasm. */
  octetsEquix: Uint8Array
  coeurs: number
  signal?: AbortSignal
}

export interface ProgressionBanc {
  etape: 'calibrage' | 'scenario' | 'verification'
  scenario?: string
  repetition?: number
  repetitions?: number
  essais?: number
  parts?: number
}

function erreurAnnulation(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('Banc annulé.', 'AbortError')
}

function graineAleatoire(): Uint8Array {
  // Préfixe court : graine et nonce tiennent dans un seul bloc SHA-256.
  const graine = new Uint8Array(21)
  graine.set(new TextEncoder().encode('banc'))
  crypto.getRandomValues(graine.subarray(5))
  return graine
}

/** Attend une réponse d’un Web Worker (ou son erreur). */
function reponse<T>(travailleur: Worker, type: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const annuler = (): void => reject(erreurAnnulation(signal))
    signal?.addEventListener('abort', annuler, { once: true })
    travailleur.onmessage = (evenement: MessageEvent) => {
      const message = evenement.data as { type: string; message?: string }
      signal?.removeEventListener('abort', annuler)
      if (message.type === type) resolve(message as T)
      else reject(new Error(message.message ?? `Réponse inattendue du Web Worker : ${message.type}`))
    }
    travailleur.onerror = (evenement) => {
      evenement.preventDefault?.()
      reject(new Error(evenement.message || 'Web Worker du banc en échec.'))
    }
  })
}

/** Un défi SHA-256 ou Argon2id : plages de nonces distribuées aux fils jusqu’à `parts` nonces réussis. */
async function resoudreHashcash(scenario: Scenario & { algorithme: 'sha256' | 'argon2id' }, graine: Uint8Array, fils: number, env: Environnement, onEssais: (essais: number, parts: number) => void): Promise<{ nonces: number[]; essais: number }> {
  const tranche = scenario.algorithme === 'sha256' ? 1 << 14 : 1
  const travailleurs = Array.from({ length: fils }, () => env.creerTravailleur())
  try {
    return await new Promise((resolve, reject) => {
      const trouves: number[] = []
      let prochain = 0
      let essais = 0
      let fini = false
      const annuler = (): void => {
        fini = true
        reject(erreurAnnulation(env.signal))
      }
      env.signal?.addEventListener('abort', annuler, { once: true })
      const confier = (travailleur: Worker): void => {
        const debut = prochain
        prochain = Math.min(0x1_0000_0000, prochain + tranche)
        if (debut >= prochain) return reject(new Error('Nonces épuisés.'))
        travailleur.postMessage({ type: 'plage', debut, fin: prochain })
      }
      for (const travailleur of travailleurs) {
        travailleur.onerror = (evenement) => {
          evenement.preventDefault?.()
          if (!fini) reject(new Error(evenement.message || 'Web Worker du banc en échec.'))
        }
        travailleur.onmessage = (evenement: MessageEvent) => {
          if (fini) return
          const message = evenement.data as { type: string; trouves?: number[]; essais?: number; message?: string }
          if (message.type !== 'plage') {
            fini = true
            return reject(new Error(message.message ?? 'Erreur du Web Worker du banc.'))
          }
          essais += message.essais!
          trouves.push(...message.trouves!)
          onEssais(essais, Math.min(trouves.length, scenario.parts))
          if (trouves.length >= scenario.parts) {
            fini = true
            env.signal?.removeEventListener('abort', annuler)
            return resolve({ nonces: trouves.sort((a, b) => a - b).slice(0, scenario.parts), essais })
          }
          confier(travailleur)
        }
        travailleur.postMessage({ type: 'config', algorithme: scenario.algorithme, parametres: scenario.parametres, graine, difficulte: scenario.difficulte })
        confier(travailleur)
      }
    })
  } finally {
    for (const travailleur of travailleurs) travailleur.terminate()
  }
}

/** Une répétition : un défi neuf, résolu sur `fils` fils, puis vérifié. */
export async function repetition(scenario: Scenario, fils: number, env: Environnement, onEssais: (essais: number, parts: number) => void = () => {}): Promise<Repetition> {
  env.signal?.throwIfAborted()
  const graine = graineAleatoire()
  if (scenario.algorithme === 'equix') {
    const { n, compilation } = scenario.parametres
    const resultat = await resoudre({
      octets: env.octetsEquix, graine, effort: scenario.difficulte, nombre: scenario.parts, n, compilation, fils, signal: env.signal,
      onProgression: ({ essais, parts }) => onEssais(essais, parts),
    })
    const module = await ModuleEquix.instancier(env.octetsEquix)
    const debut = performance.now()
    const valide = module.verifier(graine, resultat.parts, scenario.difficulte, scenario.parts, n)
    const verification = performance.now() - debut
    return {
      dureeMs: resultat.dureeMs, essais: resultat.essais, memoireOctets: resultat.memoireOctets, memoire: 'mesuree', tailleOctets: resultat.parts.length,
      verification: { dureeMs: verification, memoireOctets: module.memoireOctets, memoire: 'mesuree', valide },
    }
  }
  const debut = performance.now()
  const { nonces, essais } = await resoudreHashcash(scenario, graine, fils, env, onEssais)
  const dureeMs = performance.now() - debut
  const memoireParFil = scenario.algorithme === 'argon2id' ? (scenario.parametres as ParametresArgon2id).memoireKio * 1024 : 0
  const departVerification = performance.now()
  const valide = await verifierNonces(scenario.algorithme, scenario.parametres, graine, nonces, scenario.difficulte)
  return {
    dureeMs, essais, memoireOctets: memoireParFil * fils, memoire: 'estimee', tailleOctets: tailleNonces(nonces),
    verification: { dureeMs: performance.now() - departVerification, memoireOctets: memoireParFil, memoire: 'estimee', valide },
  }
}

export function resumer(
  scenario: Scenario, repetitions: Repetition[], plafond: Plafond, msParEssaiCalibre: number | null,
  suivi: { statut: StatutScenario; tentatives: number; erreurs: string[]; debitMaximal: DebitMaximal | null } = { statut: 'complet', tentatives: 1, erreurs: [], debitMaximal: null },
): ResultatScenario {
  const durees = repetitions.map((r) => r.dureeMs)
  return {
    scenario, ...suivi, filsEffectifs: plafond.retenus, plafond, msParEssaiCalibre, repetitions,
    statistiques: {
      dureeMs: statistiques(durees), essais: statistiques(repetitions.map((r) => r.essais)),
      verificationMs: statistiques(repetitions.map((r) => r.verification.dureeMs)), tailleOctets: statistiques(repetitions.map((r) => r.tailleOctets)),
    },
    debit100s: debit100s(durees),
  }
}

/**
 * Débit maximal : autant de défis en parallèle que de fils permis, un fil
 * chacun (sans les essais perdus d’un défi court réparti sur plusieurs fils),
 * enchaînés au moins `dureeMs`, et jusqu’à ce que chaque voie ait fini un défi
 * (au plus 10 × `dureeMs`). Le rythme de chaque voie est mesuré sur ses défis
 * finis seulement (le défi en cours à l’arrêt est abandonné), puis les voies
 * s’additionnent.
 */
export async function debitMaximal(scenario: Scenario, concurrence: number, env: Environnement, dureeMs: number): Promise<DebitMaximal> {
  const fenetre = new AbortController()
  const arret = (): void => fenetre.abort()
  env.signal?.addEventListener('abort', arret, { once: true })
  const plafond = setTimeout(arret, 10 * dureeMs)
  const debut = performance.now()
  const voies = Array.from({ length: concurrence }, () => ({ defis: 0, occupeMs: 0, durees: [] as number[] }))
  const sousEnv: Environnement = { ...env, signal: fenetre.signal }
  const verifierFin = (): void => {
    if (performance.now() - debut >= dureeMs && voies.every((voie) => voie.defis > 0)) fenetre.abort()
  }
  const minuterie = setTimeout(verifierFin, dureeMs)
  const parcourir = async (voie: (typeof voies)[number]): Promise<void> => {
    while (!fenetre.signal.aborted) {
      const depart = performance.now()
      try {
        const faite = await repetition(scenario, 1, sousEnv)
        if (fenetre.signal.aborted) break
        voie.defis++
        voie.occupeMs += performance.now() - depart
        voie.durees.push(faite.dureeMs)
        verifierFin()
      } catch (erreur) {
        if (!fenetre.signal.aborted) throw erreur
      }
    }
  }
  try {
    await Promise.all(voies.map(parcourir))
  } finally {
    clearTimeout(plafond)
    clearTimeout(minuterie)
    env.signal?.removeEventListener('abort', arret)
  }
  env.signal?.throwIfAborted()
  const durees = voies.flatMap((voie) => voie.durees)
  return {
    concurrence, dureeMs: performance.now() - debut, defis: durees.length,
    parCentSecondes: voies.reduce((somme, voie) => somme + (voie.occupeMs > 0 ? voie.defis * 100_000 / voie.occupeMs : 0), 0),
    dureeMoyenneDefiMs: durees.length ? durees.reduce((somme, duree) => somme + duree, 0) / durees.length : null,
  }
}

/**
 * Mode « calibrer » (sur le PC de référence, tous les cœurs) : part de la
 * difficulté du scénario (issue de la simulation) — ou d’une estimation
 * d’après la vitesse si elle vaut 0 —, l’ajuste sur des défis réels jusqu’à ce
 * que la médiane approche la cible, sans descendre sous `difficulteMin`. Puis
 * contrôle la régularité sur `defisControle` défis : si p90/p10 dépasse 2, le
 * nombre de parts augmente (×1,3) à durée égale, et l’on recommence (3 fois au
 * plus). SHA-256 et Argon2id ne se règlent que par bits entiers : la médiane
 * reste à un facteur √2 près de la cible.
 */
export async function calibrerDifficulte(
  scenario: Scenario, fils: number, cibleMs: number, env: Environnement,
  options: { defis?: number; defisControle?: number; tours?: number; onTour?: (difficulte: number, medianeMs: number, parts: number) => void } = {},
): Promise<{ difficulte: number; parts: number; medianeMs: number; rapportP90P10: number; defis: number }> {
  const defis = options.defis ?? 15
  const defisControle = options.defisControle ?? 30
  let courant: Scenario = scenario.difficulte > 0 ? scenario : { ...scenario, difficulte: difficultePourDuree(scenario, cibleMs, await calibrer(scenario, env, 1000), fils) } as Scenario
  const serie = async (nombre: number): Promise<number[]> => {
    const durees: number[] = []
    for (let rang = 0; rang < nombre; rang++) durees.push((await repetition(courant, fils, env)).dureeMs)
    return durees.sort((a, b) => a - b)
  }
  let mediane = Number.NaN
  let rapport = Number.NaN
  for (let augmentation = 0; augmentation <= 3; augmentation++) {
    for (let tour = 0; tour < (options.tours ?? 4); tour++) {
      mediane = centile(await serie(defis), 0.5)
      options.onTour?.(courant.difficulte, mediane, courant.parts)
      const suivante = ajusterDifficulte(courant, mediane, cibleMs)
      const assezProche = courant.algorithme === 'equix' ? Math.abs(Math.log(mediane / cibleMs)) < Math.log(1.15) : Math.abs(Math.log2(mediane / cibleMs)) < 0.5
      if (assezProche || suivante === courant.difficulte) break
      courant = { ...courant, difficulte: suivante } as Scenario
    }
    const controle = await serie(defisControle)
    mediane = centile(controle, 0.5)
    rapport = centile(controle, 0.9) / centile(controle, 0.1)
    options.onTour?.(courant.difficulte, mediane, courant.parts)
    if (rapport <= REGULARITE_MAX || augmentation === 3) break
    // Plus de parts, chacune plus facile : même durée attendue, dispersion moindre.
    const parts = Math.min(64, Math.ceil(courant.parts * 1.3))
    courant = { ...courant, parts, difficulte: ajusterDifficulte(courant, mediane * parts / courant.parts, cibleMs) } as Scenario
  }
  return { difficulte: courant.difficulte, parts: courant.parts, medianeMs: mediane, rapportP90P10: rapport, defis: defisControle }
}

/** Configuration d’un Web Worker pour un scénario (calibrage, vérification). */
function configurer(travailleur: Worker, scenario: Scenario, env: Environnement): void {
  travailleur.postMessage({ type: 'config', algorithme: scenario.algorithme, parametres: scenario.parametres, graine: graineAleatoire(), difficulte: 0, octetsEquix: env.octetsEquix.slice().buffer })
}

/** Durée d’un essai sur un fil, mesurée pendant ≈ `dureeMs` après un essai de mise en température. */
export async function calibrer(scenario: Scenario, env: Environnement, dureeMs = 1000): Promise<number> {
  const travailleur = env.creerTravailleur()
  try {
    configurer(travailleur, scenario, env)
    travailleur.postMessage({ type: 'calibrer', dureeMs })
    const { essais, dureeMs: mesure } = await reponse<{ essais: number; dureeMs: number }>(travailleur, 'calibrage', env.signal)
    return mesure / essais
  } finally {
    travailleur.terminate()
  }
}

/** Vérifications par seconde d’une configuration, sur `fils` Web Workers en parallèle. */
export async function debitVerification(scenario: Scenario, fils: number, env: Environnement, dureeMs: number): Promise<DebitVerification> {
  const travailleurs = Array.from({ length: fils }, () => env.creerTravailleur())
  try {
    const mesures = await Promise.all(travailleurs.map((travailleur) => {
      configurer(travailleur, scenario, env)
      travailleur.postMessage({ type: 'verifier', dureeMs })
      return reponse<{ nombre: number; dureeMs: number }>(travailleur, 'verifications', env.signal)
    }))
    const verifications = mesures.reduce((somme, mesure) => somme + mesure.nombre, 0)
    const parSeconde = mesures.reduce((somme, mesure) => somme + mesure.nombre / (mesure.dureeMs / 1000), 0)
    return { algorithme: scenario.algorithme, parametres: scenario.parametres, fils, verifications, dureeMs: Math.max(...mesures.map((m) => m.dureeMs)), parSeconde }
  } finally {
    for (const travailleur of travailleurs) travailleur.terminate()
  }
}

/** Une configuration par (algorithme, paramètres) : le coût d’une vérification n’en dépend pas davantage. */
export function configurations(scenarios: readonly Scenario[]): Scenario[] {
  const vues = new Map<string, Scenario>()
  for (const scenario of scenarios) if (!vues.has(cleConfiguration(scenario))) vues.set(cleConfiguration(scenario), scenario)
  return [...vues.values()]
}
