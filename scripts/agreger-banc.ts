// Agrège les exports du banc standardisé (un fichier JSON par appareil,
// format `pow-equix-wasm/banc`, voir demo/banc/schema.ts) en valeurs du tableau
// comparatif du README (hors lignes « 10 000 € » et « 1 000 000 € », extrapolées ensuite).
//
//   bun scripts/agreger-banc.ts mesures/*.json [--attaque materiels.json] [--json]
//
// Colonnes : un scénario (même `id`) par colonne, dans l’ordre de première
// apparition. Lignes : celles du tableau, puis une ligne par appareil.
//
// Débits : « défis résolus en 100 s » est le débit maximal de chaque appareil
// (défis en parallèle, un fil chacun) ; la latence d’un défi seul sur tous les
// cœurs, ce que vit l’utilisateur, figure à part.
//
// Écarts : d’usage = débit du meilleur appareil ÷ débit du plus faible ;
// d’attaque = débit d’un matériel d’attaque (fichier --attaque, valeurs
// extrapolées) ÷ débit du pire appareil, et ÷ débit de l’appareil médian ;
// résistance au déni de service = vérifications par seconde, tous les cœurs.
//
// Fichier --attaque (format pow-equix-wasm/banc-attaque, version 1) :
//   { "format": "pow-equix-wasm/banc-attaque", "version": 1,
//     "materiels": [ { "nom": "10 000 €", "description": "…", "debits": { "<id de scénario>": <défis en 100 s> } }, … ] }

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { descriptionAppareil } from '../demo/outils.ts'
import type { Scenario } from '../demo/banc/scenarios.ts'
import { auDessusDeLaCible, centile } from '../demo/banc/scenarios.ts'
import { type ExportBanc, FORMAT_BANC, type ResultatScenario, VERSION_BANC } from '../demo/banc/schema.ts'

export interface Ligne { libelle: string; valeurs: Array<string | null> }
export interface Agregat { colonnes: Array<{ id: string; libelle: string; algorithme: Scenario['algorithme'] }>; lignes: Ligne[]; avertissements: string[] }

export const FORMAT_ATTAQUE = 'pow-equix-wasm/banc-attaque'
export interface MaterielAttaque { nom: string; description?: string; debits: Record<string, number> }

export function lireAttaque(texte: string, nom: string): MaterielAttaque[] {
  const contenu = JSON.parse(texte) as { format?: string; version?: number; materiels?: MaterielAttaque[] }
  if (contenu.format !== FORMAT_ATTAQUE || contenu.version !== 1 || !Array.isArray(contenu.materiels)) throw new Error(`${nom} : format ${FORMAT_ATTAQUE} version 1 attendu`)
  return contenu.materiels
}

export function lireExport(texte: string, nom: string): ExportBanc {
  const contenu = JSON.parse(texte) as Partial<ExportBanc>
  if (contenu.format !== FORMAT_BANC) throw new Error(`${nom} : format « ${String(contenu.format)} » inattendu (attendu : ${FORMAT_BANC})`)
  if (contenu.version !== VERSION_BANC) throw new Error(`${nom} : version ${String(contenu.version)} non prise en charge (attendue : ${VERSION_BANC})`)
  return contenu as ExportBanc
}

export function nomAppareil(fichier: ExportBanc): string {
  const saisi = fichier.appareil.saisi
  const precision = [saisi.processeur, saisi.ram].filter(Boolean).join(', ')
  return `${saisi.modele || descriptionAppareil(fichier.appareil.detecte.agent)}${precision ? ` {${precision}}` : ''}`
}

const mediane = (valeurs: number[]): number => centile([...valeurs].sort((a, b) => a - b), 0.5)

const virgule = (texte: string): string => texte.replace('.', ',')

function taille(octets: number): string {
  if (octets === 0) return 'négligeable'
  if (octets < 1024) return `${Math.round(octets)} o`
  if (octets < 1024 * 1024) return `${virgule((octets / 1024).toFixed(1))} Kio`
  return `${virgule((octets / 1024 / 1024).toFixed(1))} Mio`
}

function duree(ms: number): string {
  if (ms < 1) return `${virgule((ms * 1000).toFixed(1))} µs`
  if (ms < 1000) return `${virgule(ms.toFixed(ms < 10 ? 2 : 0))} ms`
  return `${virgule((ms / 1000).toFixed(2))} s`
}

const nombre = (valeur: number): string => (valeur >= 100 ? Math.round(valeur).toLocaleString('fr-FR') : valeur.toFixed(1).replace('.', ','))

export function agreger(fichiers: ExportBanc[], attaques: MaterielAttaque[] = []): Agregat {
  const avertissements: string[] = []
  for (const fichier of fichiers) {
    if (fichier.rapide) avertissements.push(`${nomAppareil(fichier)} : mode rapide, résultats non représentatifs`)
    if (fichier.partiel) avertissements.push(`${nomAppareil(fichier)} : export partiel (${fichier.scenarios.filter((r) => r.statut !== 'complet').map((r) => `${r.scenario.id} ${r.statut}`).join(', ')})`)
    for (const resultat of fichier.scenarios) {
      if (resultat.plafond.applique) avertissements.push(`${nomAppareil(fichier)} : ${resultat.scenario.id} plafonné à ${resultat.plafond.retenus} fils sur ${resultat.plafond.demandes} (mémoire)`)
    }
  }
  const empreintes = new Set(fichiers.map((fichier) => fichier.fichierScenarios.empreinte))
  if (empreintes.size > 1) avertissements.push(`fichiers de scénarios différents (${[...empreintes].join(', ')}) : colonnes comparables seulement si les scénarios de même id sont identiques`)
  const colonnes: Agregat['colonnes'] = []
  for (const fichier of fichiers) {
    for (const resultat of fichier.scenarios) {
      if (!colonnes.some((colonne) => colonne.id === resultat.scenario.id)) colonnes.push({ id: resultat.scenario.id, libelle: resultat.scenario.libelle ?? resultat.scenario.id, algorithme: resultat.scenario.algorithme })
    }
  }
  const resultats = (id: string): ResultatScenario[] => fichiers.flatMap((fichier) => fichier.scenarios.filter((resultat) => resultat.scenario.id === id && resultat.repetitions.length > 0))
  /** Débit maximal (défis en 100 s), à défaut celui des défis seuls enchaînés. */
  const debit = (resultat: ResultatScenario): number => resultat.debitMaximal?.parCentSecondes ?? resultat.debit100s.extrapole
  const parColonne = (calcul: (liste: ResultatScenario[]) => string | null): Array<string | null> => colonnes.map((colonne) => {
    const liste = resultats(colonne.id)
    return liste.length ? calcul(liste) : null
  })
  const memoire = (liste: ResultatScenario[], lire: (resultat: ResultatScenario) => { octets: number; mode: string }): string => {
    const valeurs = liste.map(lire)
    return `${taille(mediane(valeurs.map((valeur) => valeur.octets)))}${valeurs.some((valeur) => valeur.mode === 'estimee') && mediane(valeurs.map((valeur) => valeur.octets)) > 0 ? ' (estimée)' : ''}`
  }
  const lignes: Ligne[] = [
    { libelle: 'Mémoire nécessaire au calcul sans parallélisation (par fil)', valeurs: parColonne((liste) => memoire(liste, (r) => ({ octets: mediane(r.repetitions.map((rep) => rep.memoireOctets)) / r.filsEffectifs, mode: r.repetitions[0]?.memoire ?? 'mesuree' }))) },
    { libelle: 'Vérifier une preuve : temps (par part, médiane)', valeurs: parColonne((liste) => duree(mediane(liste.map((r) => r.statistiques.verificationMs.mediane / r.scenario.parts)))) },
    { libelle: 'Vérifier une preuve : mémoire', valeurs: parColonne((liste) => memoire(liste, (r) => ({ octets: r.repetitions[0]?.verification.memoireOctets ?? 0, mode: r.repetitions[0]?.verification.memoire ?? 'mesuree' }))) },
    {
      libelle: 'Parts, et rapport p90/p10 de la durée du défi (pire appareil ; ≤ 2 : du simple au double sur 80 % des cas ; p95/p5 pour information)',
      valeurs: parColonne((liste) => {
        const pire = (cle: 'rapportP90P10' | 'rapportP95P5'): string => virgule(Math.max(...liste.map((r) => r.statistiques.dureeMs[cle])).toFixed(2))
        return `${liste[0]!.scenario.parts} parts : ${pire('rapportP90P10')} (p95/p5 : ${pire('rapportP95P5')})`
      }),
    },
    {
      // Parmi les scénarios d’un même algorithme et mêmes paramètres, le plus petit nombre de parts
      // dont la durée reste « du simple au double » (p90/p10 ≤ 2) sur 80 % des défis, sur tous les appareils.
      libelle: 'Combien de parts pour que p90/p10 ≤ 2 sur tous les appareils (parmi les scénarios mesurés)',
      valeurs: colonnes.map((colonne) => {
        const reference = resultats(colonne.id)[0]!.scenario
        const semblables = colonnes.filter((autre) => {
          const scenario = resultats(autre.id)[0]!.scenario
          return scenario.algorithme === reference.algorithme && JSON.stringify(scenario.parametres) === JSON.stringify(reference.parametres)
        })
        const conformes = semblables
          .map((autre) => ({ parts: resultats(autre.id)[0]!.scenario.parts, pire: Math.max(...resultats(autre.id).map((r) => r.statistiques.dureeMs.rapportP90P10)) }))
          .filter((mesure) => mesure.pire <= 2)
          .sort((a, b) => a.parts - b.parts)
        const plusGrand = Math.max(...semblables.map((autre) => resultats(autre.id)[0]!.scenario.parts))
        return conformes.length ? `${conformes[0]!.parts} parts` : `non atteint (jusqu’à ${plusGrand} parts testées)`
      }),
    },
    { libelle: 'Taille des preuves (moyenne)', valeurs: parColonne((liste) => taille(mediane(liste.map((r) => r.statistiques.tailleOctets.moyenne)))) },
    { libelle: 'Temps pour vérifier les preuves du défi (médiane)', valeurs: parColonne((liste) => duree(mediane(liste.map((r) => r.statistiques.verificationMs.mediane)))) },
    { libelle: 'Mémoire pour vérifier les preuves du défi', valeurs: parColonne((liste) => memoire(liste, (r) => ({ octets: r.repetitions[0]?.verification.memoireOctets ?? 0, mode: r.repetitions[0]?.verification.memoire ?? 'mesuree' }))) },
    { libelle: 'Défis résolus en 100 s (débit maximal : défis en parallèle, un fil chacun)', valeurs: colonnes.map(() => null) },
  ]
  for (const fichier of fichiers) {
    lignes.push({
      libelle: `sur ${nomAppareil(fichier)}`,
      valeurs: colonnes.map((colonne) => {
        const resultat = fichier.scenarios.find((r) => r.scenario.id === colonne.id && r.repetitions.length > 0)
        if (!resultat) return null
        if (resultat.debitMaximal) return `${nombre(resultat.debitMaximal.parCentSecondes)}${resultat.debitMaximal.dureeMs >= 100_000 ? '' : ' ¹'}`
        return `≈ ${nombre(resultat.debit100s.extrapole)} (défis seuls)`
      }),
    })
  }
  for (const materiel of attaques) {
    lignes.push({ libelle: `avec ${materiel.nom}${materiel.description ? ` {${materiel.description}}` : ''} ¹`, valeurs: colonnes.map((colonne) => (materiel.debits[colonne.id] === undefined ? null : nombre(materiel.debits[colonne.id]!))) })
  }
  lignes.push({ libelle: 'Latence d’un défi seul sur tous les cœurs (médiane, pire appareil)', valeurs: parColonne((liste) => duree(Math.max(...liste.map((r) => r.statistiques.dureeMs.mediane)))) })
  // Médiane sur la machine de référence du calibrage (sinon le meilleur appareil), comparée à la durée cible.
  lignes.push({
    libelle: 'Durée médiane d’un défi sur la machine de référence (cible du fichier de scénarios)',
    valeurs: colonnes.map((colonne) => {
      const avec = fichiers.map((fichier) => ({ fichier, resultat: fichier.scenarios.find((r) => r.scenario.id === colonne.id && r.repetitions.length > 0) })).filter((x) => x.resultat)
      if (!avec.length) return null
      const reference = avec.find((x) => x.fichier.fichierScenarios.calibrage?.agent === x.fichier.appareil.detecte.agent) ?? avec.sort((a, b) => a.resultat!.statistiques.dureeMs.mediane - b.resultat!.statistiques.dureeMs.mediane)[0]!
      const cible = reference.fichier.fichierScenarios.dureeCibleMs
      const mediane = reference.resultat!.statistiques.dureeMs.mediane
      return `${duree(mediane)} (cible ${duree(cible)})${auDessusDeLaCible(reference.resultat!.scenario, mediane, cible) ? ', au-dessus de la cible' : ''}`
    }),
  })
  lignes.push({
    libelle: 'Écart en scénario d’usage : meilleur appareil ÷ plus faible',
    valeurs: parColonne((liste) => (liste.length < 2 ? null : `× ${nombre(Math.max(...liste.map(debit)) / Math.min(...liste.map(debit)))}`)),
  })
  for (const materiel of attaques) {
    for (const [reference, choisir] of [['pire appareil', (valeurs: number[]) => Math.min(...valeurs)], ['appareil médian', mediane]] as const) {
      lignes.push({
        libelle: `Écart en scénario d’attaque (${materiel.nom}) ÷ ${reference}`,
        valeurs: parColonne((liste) => {
          const attaque = materiel.debits[liste[0]!.scenario.id]
          return attaque === undefined ? null : `× ${nombre(attaque / choisir(liste.map(debit)))}`
        }),
      })
    }
  }
  // Résistance au déni de service : vérifications de parts valides par seconde, sur tous les cœurs.
  for (const fichier of fichiers) {
    lignes.push({
      libelle: `Résistance au DoS : vérifications par seconde, tous les cœurs, sur ${nomAppareil(fichier)}`,
      valeurs: colonnes.map((colonne) => {
        const scenario = fichiers.flatMap((f) => f.scenarios).find((r) => r.scenario.id === colonne.id)!.scenario
        const debits = fichier.verification.filter((d) => d.algorithme === scenario.algorithme && JSON.stringify(d.parametres) === JSON.stringify(scenario.parametres))
        const tous = debits.sort((x, y) => y.fils - x.fils)[0]
        return tous ? `${nombre(tous.parSeconde)} (${tous.fils} fils)` : null
      }),
    })
  }
  return { colonnes, lignes, avertissements }
}

export function versMarkdown(agregat: Agregat): string {
  const entete = `| | ${agregat.colonnes.map((colonne) => colonne.libelle).join(' | ')} |`
  const separateur = `|---|${agregat.colonnes.map(() => '---').join('|')}|`
  const corps = agregat.lignes.map((ligne) => `| ${ligne.libelle} | ${ligne.valeurs.map((valeur) => valeur ?? '').join(' | ')} |`)
  const notes = agregat.avertissements.map((avertissement) => `> ⚠ ${avertissement}`)
  return [...notes, ...(notes.length ? [''] : []), entete, separateur, ...corps, '', '¹ extrapolé : débit maximal mesuré sur moins de 100 s et ramené à 100 s, ou matériel d’attaque ; ≈ : extrapolé de la durée moyenne des défis seuls.'].join('\n')
}

if (import.meta.main) {
  const arguments_ = process.argv.slice(2)
  const indexAttaque = arguments_.indexOf('--attaque')
  const cheminAttaque = indexAttaque >= 0 ? arguments_[indexAttaque + 1] : undefined
  const chemins = arguments_.filter((argument, index) => !argument.startsWith('--') && index !== indexAttaque + 1)
  if (!chemins.length) {
    console.error('Usage : bun scripts/agreger-banc.ts fichier.json… [--attaque materiels.json] [--json]')
    process.exit(1)
  }
  const attaques = cheminAttaque ? lireAttaque(readFileSync(cheminAttaque, 'utf8'), basename(cheminAttaque)) : []
  const agregat = agreger(chemins.map((chemin) => lireExport(readFileSync(chemin, 'utf8'), basename(chemin))), attaques)
  console.log(process.argv.includes('--json') ? JSON.stringify(agregat, null, 2) : versMarkdown(agregat))
}
