// Schéma de l’export du banc : `pow-equix-wasm/banc`, version 1. Un fichier par
// appareil et par lancement ; scripts/agreger-banc.ts en réunit plusieurs.
// Toute évolution incompatible incrémente VERSION_BANC.

import type { Scenario, Statistiques } from './scenarios.ts'

export const FORMAT_BANC = 'pow-equix-wasm/banc'
export const VERSION_BANC = 1

/** Fiche de l’appareil : détectée par la page, et saisie par la personne qui lance le banc. */
export interface FicheAppareil {
  detecte: {
    agent: string
    /** `navigator.hardwareConcurrency`. */
    coeurs: number | null
    /** `navigator.deviceMemory` en Go (Chromium seulement, arrondi et plafonné par le navigateur). */
    memoireAppareilGo: number | null
    ecran: { largeur: number; hauteur: number; ratio: number } | null
    plateforme: string | null
    webAssembly: boolean
  }
  /** Champs libres, remplis avant de lancer : modèle, processeur, GPU, RAM, remarques. */
  saisi: { modele: string; processeur: string; gpu: string; ram: string; remarques: string }
}

/** Une répétition : un défi résolu puis vérifié. */
export interface Repetition {
  /** Du lancement du calcul à la preuve complète, Web Workers créés compris. */
  dureeMs: number
  essais: number
  /** Mémoire du calcul : mesurée (Equi-X : mémoire réelle des modules) ou estimée (Argon2id : m × fils ; SHA-256 : 0). */
  memoireOctets: number
  memoire: 'mesuree' | 'estimee'
  /** Taille de la preuve encodée (Equi-X : format du paquet ; hashcash : écarts de nonces en LEB128). */
  tailleOctets: number
  verification: { dureeMs: number; memoireOctets: number; memoire: 'mesuree' | 'estimee'; valide: boolean }
}

export interface ResultatScenario {
  /** Le scénario tel que lancé (répétitions effectives, réduites en mode rapide). */
  scenario: Scenario
  filsEffectifs: number
  /** Durée d’un essai sur un fil, mesurée au calibrage, ou null. */
  msParEssaiCalibre: number | null
  repetitions: Repetition[]
  statistiques: { dureeMs: Statistiques; essais: Statistiques; verificationMs: Statistiques; tailleOctets: Statistiques }
  /** Défis résolus en 100 s : extrapolé de la durée moyenne ; mesuré si les répétitions enchaînées couvrent 100 s. */
  debit100s: { extrapole: number; mesure: number | null }
}

/** Débit de vérification d’une configuration (algorithme et paramètres), sur 1 fil ou sur tous les cœurs. */
export interface DebitVerification {
  algorithme: Scenario['algorithme']
  parametres: Scenario['parametres']
  fils: number
  verifications: number
  dureeMs: number
  /** Vérifications de parts valides par seconde, tous fils confondus. */
  parSeconde: number
}

export interface ExportBanc {
  format: typeof FORMAT_BANC
  version: typeof VERSION_BANC
  /** Date ISO de fin du banc. */
  date: string
  /** Version du paquet pow-equix-wasm mesuré. */
  paquet: string
  /** Mode rapide : moins de répétitions, résultats non représentatifs. */
  rapide: boolean
  appareil: FicheAppareil
  scenarios: ResultatScenario[]
  verification: DebitVerification[]
}
