// Agrège les exports du banc standardisé (un fichier JSON par appareil,
// format `pow-equix-wasm/banc`, voir demo/banc/schema.ts) en valeurs du tableau
// comparatif du README (hors lignes « 10 000 € » et « 1 000 000 € », extrapolées ensuite).
//
//   bun scripts/agreger-banc.ts mesures/*.json [--json]
//
// Colonnes : un scénario (même `id`) par colonne, dans l’ordre de première
// apparition. Lignes : celles du tableau, puis une ligne par appareil.

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { descriptionAppareil } from '../demo/outils.ts'
import type { Scenario } from '../demo/banc/scenarios.ts'
import { centile } from '../demo/banc/scenarios.ts'
import { type ExportBanc, FORMAT_BANC, type ResultatScenario, VERSION_BANC } from '../demo/banc/schema.ts'

export interface Ligne { libelle: string; valeurs: Array<string | null> }
export interface Agregat { colonnes: Array<{ id: string; libelle: string; algorithme: Scenario['algorithme'] }>; lignes: Ligne[]; avertissements: string[] }

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

export function agreger(fichiers: ExportBanc[]): Agregat {
  const avertissements: string[] = []
  for (const fichier of fichiers) if (fichier.rapide) avertissements.push(`${nomAppareil(fichier)} : mode rapide, résultats non représentatifs`)
  const colonnes: Agregat['colonnes'] = []
  for (const fichier of fichiers) {
    for (const resultat of fichier.scenarios) {
      if (!colonnes.some((colonne) => colonne.id === resultat.scenario.id)) colonnes.push({ id: resultat.scenario.id, libelle: resultat.scenario.libelle ?? resultat.scenario.id, algorithme: resultat.scenario.algorithme })
    }
  }
  const resultats = (id: string): ResultatScenario[] => fichiers.flatMap((fichier) => fichier.scenarios.filter((resultat) => resultat.scenario.id === id))
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
    { libelle: 'Parts, et rapport p95/p5 de la durée du défi (pire appareil ; ≤ 2 : du simple au double sur 90 % des cas)', valeurs: parColonne((liste) => `${liste[0]!.scenario.parts} parts : ${Math.max(...liste.map((r) => r.statistiques.dureeMs.rapportP95P5)).toFixed(2).replace('.', ',')}`) },
    {
      // Parmi les scénarios d’un même algorithme et mêmes paramètres, le plus petit nombre de parts
      // dont la durée reste « du simple au double » (p95/p5 ≤ 2) sur 90 % des défis, sur tous les appareils.
      libelle: 'Combien de parts pour que p95/p5 ≤ 2 sur tous les appareils (parmi les scénarios mesurés)',
      valeurs: colonnes.map((colonne) => {
        const reference = resultats(colonne.id)[0]!.scenario
        const semblables = colonnes.filter((autre) => {
          const scenario = resultats(autre.id)[0]!.scenario
          return scenario.algorithme === reference.algorithme && JSON.stringify(scenario.parametres) === JSON.stringify(reference.parametres)
        })
        const conformes = semblables
          .map((autre) => ({ parts: resultats(autre.id)[0]!.scenario.parts, pire: Math.max(...resultats(autre.id).map((r) => r.statistiques.dureeMs.rapportP95P5)) }))
          .filter((mesure) => mesure.pire <= 2)
          .sort((a, b) => a.parts - b.parts)
        const plusGrand = Math.max(...semblables.map((autre) => resultats(autre.id)[0]!.scenario.parts))
        return conformes.length ? `${conformes[0]!.parts} parts` : `non atteint (jusqu’à ${plusGrand} parts testées)`
      }),
    },
    { libelle: 'Taille des preuves (moyenne)', valeurs: parColonne((liste) => taille(mediane(liste.map((r) => r.statistiques.tailleOctets.moyenne)))) },
    { libelle: 'Temps pour vérifier les preuves du défi (médiane)', valeurs: parColonne((liste) => duree(mediane(liste.map((r) => r.statistiques.verificationMs.mediane)))) },
    { libelle: 'Mémoire pour vérifier les preuves du défi', valeurs: parColonne((liste) => memoire(liste, (r) => ({ octets: r.repetitions[0]?.verification.memoireOctets ?? 0, mode: r.repetitions[0]?.verification.memoire ?? 'mesuree' }))) },
    { libelle: 'Défis résolus en 100 s', valeurs: colonnes.map(() => null) },
  ]
  for (const fichier of fichiers) {
    lignes.push({
      libelle: `sur ${nomAppareil(fichier)}`,
      valeurs: colonnes.map((colonne) => {
        const resultat = fichier.scenarios.find((r) => r.scenario.id === colonne.id)
        if (!resultat) return null
        const { mesure, extrapole } = resultat.debit100s
        return mesure === null ? `≈ ${nombre(extrapole)}` : `${mesure} (≈ ${nombre(extrapole)})`
      }),
    })
  }
  lignes.push({
    libelle: 'Écart en scénario d’usage, du pire au meilleur appareil mesuré',
    valeurs: parColonne((liste) => (liste.length < 2 ? null : `× ${nombre(Math.max(...liste.map((r) => r.debit100s.extrapole)) / Math.min(...liste.map((r) => r.debit100s.extrapole)))}`)),
  })
  // Résistance au déni de service : vérifications de parts valides par seconde, sur tous les cœurs.
  for (const fichier of fichiers) {
    lignes.push({
      libelle: `Vérifications par seconde, tous les cœurs, sur ${nomAppareil(fichier)}`,
      valeurs: colonnes.map((colonne) => {
        const scenario = resultats(colonne.id)[0]!.scenario
        const debits = fichier.verification.filter((d) => d.algorithme === scenario.algorithme && JSON.stringify(d.parametres) === JSON.stringify(scenario.parametres))
        const tous = debits.sort((a, b) => b.fils - a.fils)[0]
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
  return [...notes, ...(notes.length ? [''] : []), entete, separateur, ...corps, '', '≈ : extrapolé de la durée moyenne ; sans ≈ : mesuré sur 100 s de défis enchaînés.'].join('\n')
}

if (import.meta.main) {
  const chemins = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))
  if (!chemins.length) {
    console.error('Usage : bun scripts/agreger-banc.ts fichier.json… [--json]')
    process.exit(1)
  }
  const agregat = agreger(chemins.map((chemin) => lireExport(readFileSync(chemin, 'utf8'), basename(chemin))))
  console.log(process.argv.includes('--json') ? JSON.stringify(agregat, null, 2) : versMarkdown(agregat))
}
