// Garde-fou des fils quand la mémoire de l’appareil est inconnue (Firefox,
// Safari…) : le banc monte jusqu’aux cœurs, par paliers (1, 2, 4, 8…), en
// notant chaque tentative dans localStorage avant de la lancer, et sa réussite
// après. Un onglet tué par manque de mémoire ne peut rien signaler : au
// chargement suivant, une tentative restée ouverte est prise pour un plantage,
// et le réglage mémoire concerné est limité, sur cet appareil, au dernier
// palier réussi en dessous. La limite ne se lève que par effacement explicite.

import type { Scenario } from './scenarios.ts'
import type { Support } from './stockage.ts'

export const PREFIXE_GARDE = 'pow-equix-banc-garde/'

/** Réglage mémoire : ce qui détermine la mémoire d’un fil. */
export function cleMemoire(scenario: Scenario): string | null {
  if (scenario.algorithme === 'argon2id') return `argon2id:m=${scenario.parametres.memoireKio}:p=${scenario.parametres.parallelisme}`
  if (scenario.algorithme === 'equix') return `equix:n=${scenario.parametres.n}`
  return null // SHA-256 : mémoire négligeable, pas de garde-fou
}

/** Paliers jusqu’à `maximum` : 1, 2, 4, 8…, puis `maximum` lui-même. */
export function paliers(maximum: number): number[] {
  const liste: number[] = []
  for (let fils = 1; fils < maximum; fils *= 2) liste.push(fils)
  liste.push(Math.max(1, maximum))
  return liste
}

export interface EtatGarde {
  /** Palier lancé mais pas encore réussi (plantage si la page recharge avant). */
  tentative: { fils: number; date: string } | null
  /** Paliers réussis. */
  reussis: number[]
  /** Limite définitive sur cet appareil, ou null. */
  limite: number | null
  raison: string | null
}

const vide = (): EtatGarde => ({ tentative: null, reussis: [], limite: null, raison: null })

export class Garde {
  constructor(private readonly support: Support, private readonly appareil: string) {}

  private cle(memoire: string): string {
    return `${PREFIXE_GARDE}${this.appareil}/${memoire}`
  }

  lire(memoire: string): EtatGarde {
    try {
      return { ...vide(), ...(JSON.parse(this.support.getItem(this.cle(memoire)) ?? '{}') as Partial<EtatGarde>) }
    } catch {
      return vide()
    }
  }

  private ecrire(memoire: string, etat: EtatGarde): void {
    this.support.setItem(this.cle(memoire), JSON.stringify(etat))
  }

  /**
   * Au chargement de la page : toute tentative restée ouverte est un plantage.
   * Le réglage est alors limité au plus grand palier réussi en dessous (1 au moins).
   */
  constaterPlantages(): Array<{ memoire: string; fils: number; limite: number }> {
    const constats: Array<{ memoire: string; fils: number; limite: number }> = []
    for (let rang = 0; rang < this.support.length; rang++) {
      const cle = this.support.key(rang)
      const prefixe = `${PREFIXE_GARDE}${this.appareil}/`
      if (!cle?.startsWith(prefixe)) continue
      const memoire = cle.slice(prefixe.length)
      const etat = this.lire(memoire)
      if (!etat.tentative) continue
      const dessous = etat.reussis.filter((fils) => fils < etat.tentative!.fils)
      const limite = Math.max(1, ...dessous)
      const nouvelle = etat.limite === null ? limite : Math.min(etat.limite, limite)
      this.ecrire(memoire, {
        ...etat, tentative: null, limite: nouvelle,
        raison: `onglet interrompu pendant une tentative à ${etat.tentative.fils} fils (${etat.tentative.date}) : limite au dernier palier réussi, ${nouvelle} fil(s)`,
      })
      constats.push({ memoire, fils: etat.tentative.fils, limite: nouvelle })
    }
    return constats
  }

  /** Limite de fils pour ce réglage mémoire, ou null. */
  limite(memoire: string | null): number | null {
    return memoire === null ? null : this.lire(memoire).limite
  }

  commencer(memoire: string | null, fils: number): void {
    if (memoire === null) return
    this.ecrire(memoire, { ...this.lire(memoire), tentative: { fils, date: new Date().toISOString() } })
  }

  reussir(memoire: string | null, fils: number): void {
    if (memoire === null) return
    const etat = this.lire(memoire)
    this.ecrire(memoire, { ...etat, tentative: null, reussis: [...new Set([...etat.reussis, fils])].sort((a, b) => a - b) })
  }

  /** Échec rattrapable à `fils` fils (allocation refusée…) : limite au dernier palier réussi en dessous. */
  echouer(memoire: string | null, fils: number, message: string): void {
    if (memoire === null) return
    const etat = this.lire(memoire)
    const limite = Math.max(1, ...etat.reussis.filter((palier) => palier < fils))
    this.ecrire(memoire, { ...etat, tentative: null, limite: etat.limite === null ? limite : Math.min(etat.limite, limite), raison: `échec à ${fils} fils (${message}) : limite à ${limite} fil(s)` })
  }

  /** Arrêt volontaire (annulation, erreur rattrapée) : la tentative n’est pas un plantage. */
  abandonner(memoire: string | null): void {
    if (memoire === null) return
    this.ecrire(memoire, { ...this.lire(memoire), tentative: null })
  }

  /** Paliers déjà validés sur cet appareil pour ce réglage. */
  reussis(memoire: string | null): number[] {
    return memoire === null ? [] : this.lire(memoire).reussis
  }

  /** Tout l’état du garde-fou de cet appareil, pour l’export. */
  instantane(): Record<string, EtatGarde> {
    const resultat: Record<string, EtatGarde> = {}
    const prefixe = `${PREFIXE_GARDE}${this.appareil}/`
    for (let rang = 0; rang < this.support.length; rang++) {
      const cle = this.support.key(rang)
      if (cle?.startsWith(prefixe)) resultat[cle.slice(prefixe.length)] = this.lire(cle.slice(prefixe.length))
    }
    return resultat
  }

  /** Effacement explicite : lève les limites de tous les appareils de ce navigateur. */
  static toutEffacer(support: Support): number {
    const cles: string[] = []
    for (let rang = 0; rang < support.length; rang++) {
      const cle = support.key(rang)
      if (cle?.startsWith(PREFIXE_GARDE)) cles.push(cle)
    }
    for (const cle of cles) support.removeItem(cle)
    return cles.length
  }
}
