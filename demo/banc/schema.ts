// Schéma de l’export du banc : `pow-equix-wasm/banc`, version 2. Un fichier par
// appareil et par lancement ; scripts/agreger-banc.ts en réunit plusieurs.
// Toute évolution incompatible incrémente VERSION_BANC.

import type { FichierScenarios, Plafond, Scenario, Statistiques } from './scenarios.ts'

export const FORMAT_BANC = 'pow-equix-wasm/banc'
export const VERSION_BANC = 2

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

/** complet : toutes les répétitions et le débit ; incomplet : abandonné après 3 tentatives ; enCours : export partiel. */
export type StatutScenario = 'complet' | 'incomplet' | 'enCours' | 'nonCommence'

/**
 * Débit maximal de l’appareil : `concurrence` défis en parallèle, un fil
 * chacun, enchaînés pendant `dureeMs` ; défis finis dans la fenêtre.
 */
export interface DebitMaximal {
  concurrence: number
  dureeMs: number
  defis: number
  /** Défis résolus en 100 s à ce rythme (mesuré directement si dureeMs = 100 000). */
  parCentSecondes: number
  dureeMoyenneDefiMs: number | null
}

export interface ResultatScenario {
  /** Le scénario tel que lancé (répétitions effectives, réduites en mode rapide). */
  scenario: Scenario
  statut: StatutScenario
  /** Tentatives consommées (une par lancement interrompu par un plantage ou une erreur, au plus 3). */
  tentatives: number
  erreurs: string[]
  /** Fils de chaque défi : tous les cœurs (ou 1 sans parallélisation), sous le plafond mémoire. */
  filsEffectifs: number
  plafond: Plafond
  /** Durée d’un essai sur un fil, mesurée au calibrage, ou null. */
  msParEssaiCalibre: number | null
  /** Latence : chaque répétition est un défi seul sur `filsEffectifs` fils, ce que vit l’utilisateur. */
  repetitions: Repetition[]
  statistiques: { dureeMs: Statistiques; essais: Statistiques; verificationMs: Statistiques; tailleOctets: Statistiques }
  /** Défis seuls enchaînés en 100 s (latence) : extrapolé de la moyenne ; mesuré si les répétitions couvrent 100 s. */
  debit100s: { extrapole: number; mesure: number | null }
  /** Débit maximal de l’appareil (défis en parallèle), ou null s’il n’a pas été mesuré. */
  debitMaximal: DebitMaximal | null
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
  /** Export partiel : certains scénarios ne sont pas finis. */
  partiel: boolean
  /** Fichier de scénarios lancé, et son empreinte (clé des résultats stockés). */
  fichierScenarios: FichierScenarios & { empreinte: string }
  appareil: FicheAppareil
  scenarios: ResultatScenario[]
  verification: DebitVerification[]
}
