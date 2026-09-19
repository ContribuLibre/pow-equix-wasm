// Exécution du banc, sans DOM : un défi (répétition) par scénario, sur des Web
// Workers créés pour lui puis arrêtés, comme une page qui calcule une preuve ;
// vérification de la preuve ; calibrage et débit de vérification.

import { ModuleEquix, resoudre } from '../../src/index.ts'
import { tailleNonces, verifierNonces } from './moteurs.ts'
import {
  type ParametresArgon2id, type Scenario, cleConfiguration, debit100s, filsEffectifs, statistiques,
} from './scenarios.ts'
import type { DebitVerification, Repetition, ResultatScenario } from './schema.ts'

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
async function resoudreHashcash(scenario: Scenario & { algorithme: 'sha256' | 'argon2id' }, graine: Uint8Array, env: Environnement, onEssais: (essais: number, parts: number) => void): Promise<{ nonces: number[]; essais: number }> {
  const fils = filsEffectifs(scenario, env.coeurs)
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

/** Une répétition : un défi neuf, résolu puis vérifié. */
export async function repetition(scenario: Scenario, env: Environnement, onEssais: (essais: number, parts: number) => void = () => {}): Promise<Repetition> {
  env.signal?.throwIfAborted()
  const graine = graineAleatoire()
  const fils = filsEffectifs(scenario, env.coeurs)
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
  const { nonces, essais } = await resoudreHashcash(scenario, graine, env, onEssais)
  const dureeMs = performance.now() - debut
  const memoireParFil = scenario.algorithme === 'argon2id' ? (scenario.parametres as ParametresArgon2id).memoireKio * 1024 : 0
  const departVerification = performance.now()
  const valide = await verifierNonces(scenario.algorithme, scenario.parametres, graine, nonces, scenario.difficulte)
  return {
    dureeMs, essais, memoireOctets: memoireParFil * fils, memoire: 'estimee', tailleOctets: tailleNonces(nonces),
    verification: { dureeMs: performance.now() - departVerification, memoireOctets: memoireParFil, memoire: 'estimee', valide },
  }
}

export function resumer(scenario: Scenario, repetitions: Repetition[], coeurs: number, msParEssaiCalibre: number | null): ResultatScenario {
  const durees = repetitions.map((r) => r.dureeMs)
  return {
    scenario, filsEffectifs: filsEffectifs(scenario, coeurs), msParEssaiCalibre, repetitions,
    statistiques: {
      dureeMs: statistiques(durees), essais: statistiques(repetitions.map((r) => r.essais)),
      verificationMs: statistiques(repetitions.map((r) => r.verification.dureeMs)), tailleOctets: statistiques(repetitions.map((r) => r.tailleOctets)),
    },
    debit100s: debit100s(durees),
  }
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
