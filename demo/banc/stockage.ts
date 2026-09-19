// Reprise du banc : chaque répétition terminée est enregistrée (localStorage),
// par appareil, par fichier de scénarios (empreinte) et par scénario, pour
// reprendre après un plantage ou exporter un résultat partiel.

import { TENTATIVES_MAX } from './scenarios.ts'
import type { DebitMaximal, DebitVerification, Repetition, StatutScenario } from './schema.ts'

export const PREFIXE_STOCKAGE = 'pow-equix-banc/'

/** Ce que le banc garde d’un scénario entre deux chargements de la page. */
export interface EtatScenario {
  statut: StatutScenario
  tentatives: number
  erreurs: string[]
  repetitions: Repetition[]
  debitMaximal: DebitMaximal | null
  msParEssai: number | null
}

export type Support = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

export function etatVide(): EtatScenario {
  return { statut: 'nonCommence', tentatives: 0, erreurs: [], repetitions: [], debitMaximal: null, msParEssai: null }
}

/** Identifiant d’appareil pour les clés : agent et écran, résumés. */
export function cleAppareil(agent: string, ecran: string): string {
  let h = 2166136261
  for (const caractere of `${agent}|${ecran}`) h = Math.imul(h ^ caractere.charCodeAt(0), 16777619)
  return (h >>> 0).toString(16).padStart(8, '0')
}

export class Stockage {
  private readonly prefixe: string

  constructor(private readonly support: Support, appareil: string, empreinte: string, rapide: boolean) {
    this.prefixe = `${PREFIXE_STOCKAGE}${appareil}/${empreinte}${rapide ? '/rapide' : ''}/`
  }

  private lireJson<T>(cle: string, defaut: T): T {
    try {
      const texte = this.support.getItem(this.prefixe + cle)
      return texte === null ? defaut : (JSON.parse(texte) as T)
    } catch {
      return defaut
    }
  }

  private ecrireJson(cle: string, valeur: unknown): void {
    this.support.setItem(this.prefixe + cle, JSON.stringify(valeur))
  }

  lire(id: string): EtatScenario {
    return { ...etatVide(), ...this.lireJson<Partial<EtatScenario>>(`scenario/${id}`, {}) }
  }

  ecrire(id: string, etat: EtatScenario): void {
    this.ecrireJson(`scenario/${id}`, etat)
  }

  modifier(id: string, changement: (etat: EtatScenario) => void): EtatScenario {
    const etat = this.lire(id)
    changement(etat)
    this.ecrire(id, etat)
    return etat
  }

  /**
   * Début d’une tentative : comptée avant de calculer, pour qu’un plantage de
   * l’onglet la consomme aussi. Renvoie faux si les tentatives sont épuisées
   * (le scénario est alors marqué incomplet).
   */
  commencerTentative(id: string): boolean {
    const etat = this.lire(id)
    if (etat.statut === 'complet' || etat.statut === 'incomplet') return false
    if (etat.tentatives >= TENTATIVES_MAX) {
      etat.statut = 'incomplet'
      this.ecrire(id, etat)
      return false
    }
    etat.tentatives++
    etat.statut = 'enCours'
    this.ecrire(id, etat)
    return true
  }

  /** Une annulation volontaire ne consomme pas de tentative. */
  rendreTentative(id: string): void {
    this.modifier(id, (etat) => { etat.tentatives = Math.max(0, etat.tentatives - 1) })
  }

  /** Une erreur : consignée ; au-delà des tentatives, le scénario est incomplet. */
  echec(id: string, message: string): EtatScenario {
    return this.modifier(id, (etat) => {
      etat.erreurs.push(message)
      if (etat.tentatives >= TENTATIVES_MAX) etat.statut = 'incomplet'
    })
  }

  verifications(): DebitVerification[] {
    return this.lireJson<DebitVerification[]>('verification', [])
  }

  ajouterVerification(debit: DebitVerification): void {
    this.ecrireJson('verification', [...this.verifications(), debit])
  }

  /**
   * Efface tous les résultats du banc stockés dans ce navigateur, tous fichiers
   * et appareils confondus ; garde la fiche saisie et le fichier de scénarios.
   */
  static toutEffacer(support: Support): number {
    const cles: string[] = []
    for (let rang = 0; rang < support.length; rang++) {
      const cle = support.key(rang)
      if (cle?.startsWith(PREFIXE_STOCKAGE) && cle.slice(PREFIXE_STOCKAGE.length).includes('/')) cles.push(cle)
    }
    for (const cle of cles) support.removeItem(cle)
    return cles.length
  }
}
