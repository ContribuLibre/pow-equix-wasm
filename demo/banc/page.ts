// Page du banc standardisé (démo seulement) : fiche de l’appareil, scénarios
// configurables, estimation et calibrage, exécution, statistiques, export JSON.

import pkg from '../../package.json'
import { descriptionAppareil, horodatage } from '../outils.ts'
import type { Langue } from '../textes.ts'
import { type Environnement, calibrer, calibrerDifficulte, configurations, debitMaximal, debitVerification, repetition, resumer } from './executeur.ts'
import {
  DUREE_BANC_VERIFICATION_MS, DUREE_DEBIT_RAPIDE_MS, type FichierScenarios, REGULARITE_MAX, REPETITIONS_RAPIDE, type Scenario, type Statistiques, TENTATIVES_MAX, auDessusDeLaCible,
  cleConfiguration, empreinteFichier, essaisAttendusScenario, estimerScenario, fichierProvisoire, msParEssaiReference, plafondFils, validerFichierScenarios,
} from './scenarios.ts'
import { type ExportBanc, FORMAT_BANC, type FicheAppareil, type ResultatScenario, VERSION_BANC } from './schema.ts'
import { Stockage, cleAppareil } from './stockage.ts'
import { TEXTES_BANC } from './textes.ts'

const langue: Langue = document.documentElement.lang === 'en' ? 'en' : 'fr'
const textes = TEXTES_BANC[langue]
const t = textes.dynamique
const nombres = new Intl.NumberFormat(textes.locale, { maximumFractionDigits: 1 })
const racine = new URL('../../', location.href)

const element = <T extends HTMLElement>(id: string): T => {
  const trouve = document.getElementById(id)
  if (!trouve) throw new Error(`Élément absent : ${id}`)
  return trouve as T
}

function duree(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1) return `${nombres.format(ms * 1000)} µs`
  if (ms < 1000) return `${nombres.format(ms)} ms`
  if (ms < 120_000) return `${nombres.format(ms / 1000)} s`
  if (ms < 7_200_000) return `${nombres.format(ms / 60_000)} min`
  return `${nombres.format(ms / 3_600_000)} h`
}

function taille(octets: number): string {
  if (octets < 1024) return `${Math.round(octets)} o`
  return octets >= 1024 * 1024 ? `${nombres.format(octets / 1024 / 1024)} Mio` : `${nombres.format(octets / 1024)} Kio`
}

function remplirListe(liste: HTMLElement, lignes: Array<[string, string]>): void {
  liste.replaceChildren(...lignes.flatMap(([terme, valeur]) => {
    const dt = document.createElement('dt')
    dt.textContent = terme
    const dd = document.createElement('dd')
    dd.textContent = valeur
    return [dt, dd]
  }))
}

function remplirTableau(entete: HTMLElement, corps: HTMLElement, colonnes: string[], lignes: string[][]): void {
  const ligneEntete = document.createElement('tr')
  for (const colonne of colonnes) {
    const th = document.createElement('th')
    th.scope = 'col'
    th.textContent = colonne
    ligneEntete.append(th)
  }
  entete.replaceChildren(ligneEntete)
  corps.replaceChildren(...lignes.map((valeurs) => {
    const tr = document.createElement('tr')
    for (const valeur of valeurs) {
      const td = document.createElement('td')
      td.textContent = valeur
      tr.append(td)
    }
    return tr
  }))
}

function telecharger(nom: string, contenu: string): void {
  const url = URL.createObjectURL(new Blob([contenu], { type: 'application/json' }))
  const lien = document.createElement('a')
  lien.href = url
  lien.download = nom
  document.body.append(lien)
  lien.click()
  lien.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Fiche de l’appareil.
const navigateur = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string } }
const coeurs = navigator.hardwareConcurrency || 1
const detecte: FicheAppareil['detecte'] = {
  agent: navigator.userAgent,
  coeurs: navigator.hardwareConcurrency ?? null,
  memoireAppareilGo: navigateur.deviceMemory ?? null,
  ecran: typeof screen === 'undefined' ? null : { largeur: screen.width, hauteur: screen.height, ratio: devicePixelRatio },
  plateforme: navigateur.userAgentData?.platform ?? navigator.platform ?? null,
  webAssembly: typeof WebAssembly === 'object',
}
remplirListe(element('detecte'), [
  [t.navigateur, detecte.agent],
  [t.coeurs, String(detecte.coeurs ?? t.inconnu)],
  [t.memoireAppareil, detecte.memoireAppareilGo ? `≥ ${detecte.memoireAppareilGo} Go` : t.inconnu],
  [t.ecran, detecte.ecran ? `${detecte.ecran.largeur} × ${detecte.ecran.hauteur} × ${detecte.ecran.ratio}` : t.inconnu],
  [t.plateforme, detecte.plateforme ?? t.inconnu],
])
const fiche = element<HTMLFormElement>('fiche')
const saisi = (): FicheAppareil['saisi'] => {
  const lire = (nom: string): string => (fiche.elements.namedItem(nom) as HTMLInputElement).value.trim()
  return { modele: lire('modele'), processeur: lire('processeur'), gpu: lire('gpu'), ram: lire('ram'), remarques: lire('remarques') }
}

// Scénarios : le fichier entier (durée cible, débit, calibrage, scénarios) est dans la zone de texte.
const zone = element<HTMLTextAreaElement>('scenarios')
const messageScenarios = element('message-scenarios')
const rapide = element<HTMLInputElement>('rapide')
rapide.checked = localStorage.getItem('pow-equix-banc/rapide') === '1'
rapide.addEventListener('change', () => localStorage.setItem('pow-equix-banc/rapide', rapide.checked ? '1' : '0'))
let fichierScenarios: FichierScenarios | null = null
let empreinte = ''
let scenarios: Scenario[] = []
/** Durée d’un essai sur un fil, par configuration, mesurée par « Mesurer la vitesse ». */
const vitesses = new Map<string, number>()
const appareil = cleAppareil(detecte.agent, JSON.stringify(detecte.ecran))

const repetitionsEffectives = (scenario: Scenario): number => (rapide.checked ? Math.min(REPETITIONS_RAPIDE, scenario.repetitions) : scenario.repetitions)
const dureeDebit = (): number => (rapide.checked ? DUREE_DEBIT_RAPIDE_MS : fichierScenarios?.dureeDebitMs ?? 0)
const plafond = (scenario: Scenario) => plafondFils(scenario, coeurs, detecte.memoireAppareilGo)
const msParEssai = (scenario: Scenario): number => vitesses.get(cleConfiguration(scenario)) ?? msParEssaiReference(scenario)
/** Fenêtre du débit maximal : au moins dureeDebitMs, et le temps d’un défi sur un fil (plus un pour finir). */
const fenetreDebit = (scenario: Scenario): number => Math.max(dureeDebit(), 2 * essaisAttendusScenario(scenario) * msParEssai(scenario))
const estimation = (scenario: Scenario): number => estimerScenario(scenario, plafond(scenario).retenus, msParEssai(scenario), repetitionsEffectives(scenario)) + fenetreDebit(scenario)
const dureeVerification = (): number => configurations(scenarios).length * (coeurs > 1 ? 2 : 1) * (DUREE_BANC_VERIFICATION_MS + 500)
const stockage = (): Stockage => new Stockage(localStorage, appareil, empreinte, rapide.checked)

async function lireScenarios(): Promise<void> {
  let valeur: unknown
  let lecture: ReturnType<typeof validerFichierScenarios>
  try {
    valeur = JSON.parse(zone.value)
    lecture = validerFichierScenarios(valeur)
  } catch (erreur) {
    lecture = { erreur: erreur instanceof Error ? erreur.message : String(erreur) }
  }
  fichierScenarios = 'fichier' in lecture ? lecture.fichier : null
  scenarios = fichierScenarios?.scenarios ?? []
  empreinte = fichierScenarios ? await empreinteFichier(fichierScenarios) : ''
  if (fichierScenarios) localStorage.setItem(CLE_FICHIER, zone.value)
  messageScenarios.textContent = fichierScenarios ? `${t.scenariosValides(scenarios.length)} (${empreinte})` : t.scenariosInvalides('erreur' in lecture ? lecture.erreur : '')
  messageScenarios.classList.toggle('erreur', !fichierScenarios)
  afficherScenarios()
}

function afficherScenarios(): void {
  remplirTableau(element('entete-scenarios'), element('lignes-scenarios'), t.colonnes, scenarios.map((scenario) => {
    const p = plafond(scenario)
    return [
      scenario.id, scenario.algorithme, JSON.stringify(scenario.parametres), String(scenario.parts), String(scenario.difficulte),
      p.applique ? t.plafond(p.retenus, p.demandes) : String(p.retenus), String(repetitionsEffectives(scenario)), nombres.format(essaisAttendusScenario(scenario)), duree(estimation(scenario)),
    ]
  }))
  const total = scenarios.reduce((somme, scenario) => somme + estimation(scenario), 0) + dureeVerification()
  element('estimation').textContent = scenarios.length ? t.estimationTotale(duree(total), scenarios.every((scenario) => vitesses.has(cleConfiguration(scenario)))) : ''
  for (const bouton of ['lancer', 'calibrer', 'calibrer-difficultes']) element<HTMLButtonElement>(bouton).disabled = scenarios.length === 0 || enCours
  // L’export partiel reste possible à tout moment, même pendant le banc.
  element<HTMLButtonElement>('exporter-partiel').disabled = scenarios.length === 0
  afficherReprise()
}

function afficherReprise(): void {
  if (!fichierScenarios) return
  const magasin = stockage()
  const faits = scenarios.reduce((somme, scenario) => somme + magasin.lire(scenario.id).repetitions.length, 0)
  const total = scenarios.reduce((somme, scenario) => somme + repetitionsEffectives(scenario), 0)
  element('reprise').textContent = faits ? t.reprise(faits, total) : t.aucuneReprise
  const resultats = construireResultats()
  if (resultats.some((resultat) => resultat.repetitions.length)) {
    element('bloc-resultats').hidden = false
    afficherResultats(resultats)
  }
}

const ecrireFichier = (fichier: FichierScenarios): void => {
  zone.value = JSON.stringify(fichier, null, 2)
}
// Après un plantage, la page retrouve le fichier de scénarios et la fiche saisie.
const CLE_FICHIER = 'pow-equix-banc/fichier-en-cours'
const CLE_FICHE = 'pow-equix-banc/fiche'
const fichierGarde = localStorage.getItem(CLE_FICHIER)
if (fichierGarde) zone.value = fichierGarde
else ecrireFichier(fichierProvisoire())
try {
  for (const [nom, valeur] of Object.entries(JSON.parse(localStorage.getItem(CLE_FICHE) ?? '{}') as Record<string, string>)) {
    const champ = fiche.elements.namedItem(nom) as HTMLInputElement | null
    if (champ) champ.value = valeur
  }
} catch {}
fiche.addEventListener('input', () => localStorage.setItem(CLE_FICHE, JSON.stringify(saisi())))
zone.addEventListener('input', () => void lireScenarios())
rapide.addEventListener('change', afficherScenarios)
element('reinitialiser').addEventListener('click', () => {
  ecrireFichier(fichierProvisoire())
  void lireScenarios()
})
element('exporter-scenarios').addEventListener('click', () => {
  if (fichierScenarios) telecharger(`pow-equix-banc-scenarios_${empreinte}.json`, `${JSON.stringify(fichierScenarios, null, 2)}\n`)
})
const fichier = element<HTMLInputElement>('fichier-scenarios')
element('importer-scenarios').addEventListener('click', () => fichier.click())
fichier.addEventListener('change', async () => {
  const choisi = fichier.files?.[0]
  if (!choisi) return
  zone.value = await choisi.text()
  fichier.value = ''
  await lireScenarios()
  if (scenarios.length) messageScenarios.textContent = `${t.importes(choisi.name)} ${messageScenarios.textContent}`
})

// Exécution.
const octetsEquix = fetch(new URL('equix.wasm', racine)).then(async (reponse) => new Uint8Array(await reponse.arrayBuffer()))
let annulation: AbortController | undefined
let enCours = false
const etat = element('etat')
const boutons = { annuler: element<HTMLButtonElement>('annuler') }

async function environnement(): Promise<Environnement> {
  annulation = new AbortController()
  return {
    creerTravailleur: () => new Worker(new URL('banc-travailleur.js', racine), { type: 'module' }),
    octetsEquix: await octetsEquix, coeurs, signal: annulation.signal,
  }
}

async function mesurerVitesses(env: Environnement): Promise<void> {
  for (const scenario of configurations(scenarios)) {
    if (vitesses.has(cleConfiguration(scenario))) continue
    etat.textContent = t.calibrage(scenario.id)
    vitesses.set(cleConfiguration(scenario), await calibrer(scenario, env, 1000))
    afficherScenarios()
  }
}

async function executer(travail: (env: Environnement) => Promise<void>): Promise<void> {
  enCours = true
  afficherScenarios()
  boutons.annuler.hidden = false
  element('bloc-progression').hidden = false
  try {
    await travail(await environnement())
  } catch (erreur) {
    etat.textContent = annulation?.signal.aborted ? t.annule : t.erreur(erreur instanceof Error ? erreur.message : String(erreur))
  } finally {
    enCours = false
    boutons.annuler.hidden = true
    afficherScenarios()
  }
}

boutons.annuler.addEventListener('click', () => annulation?.abort())
element('calibrer').addEventListener('click', () => executer(async (env) => {
  await mesurerVitesses(env)
  etat.textContent = t.calibre
}))

// Mode « calibrer » : sur la machine de référence, difficultés ajustées puis figées dans le fichier.
element('calibrer-difficultes').addEventListener('click', () => executer(async (env) => {
  const source = fichierScenarios!
  const cible = source.dureeCibleMs
  const calibres: Scenario[] = []
  for (const scenario of source.scenarios) {
    const resultat = await calibrerDifficulte(scenario, plafond(scenario).retenus, cible, env, {
      onTour: (difficulte, mediane, parts) => { etat.textContent = t.calibrageDifficulte(`${scenario.id} (${parts} parts)`, difficulte, duree(mediane), duree(cible)) },
    })
    calibres.push({
      ...scenario, difficulte: resultat.difficulte, parts: resultat.parts,
      calibrage: { medianeMs: Math.round(resultat.medianeMs), repetitions: resultat.defis, rapportP90P10: Number(resultat.rapportP90P10.toFixed(3)), ...(resultat.parts !== scenario.parts ? { partsInitiales: scenario.parts } : {}) },
    } as Scenario)
  }
  const saisie = saisi()
  ecrireFichier({ ...source, scenarios: calibres, calibrage: { date: new Date().toISOString(), appareil: [saisie.modele, saisie.processeur].filter(Boolean).join(', ') || descriptionAppareil(detecte.agent), agent: detecte.agent } })
  await lireScenarios()
  etat.textContent = t.difficultesCalibrees(duree(cible))
}))

/** Résultats de chaque scénario d’après le stockage : complets, partiels ou non commencés. */
function construireResultats(): ResultatScenario[] {
  const magasin = stockage()
  return scenarios.map((scenario) => {
    const etatScenario = magasin.lire(scenario.id)
    const lance = { ...scenario, repetitions: repetitionsEffectives(scenario) } as Scenario
    return resumer(lance, etatScenario.repetitions, plafond(scenario), etatScenario.msParEssai ?? vitesses.get(cleConfiguration(scenario)) ?? null, {
      statut: etatScenario.statut, tentatives: etatScenario.tentatives, erreurs: etatScenario.erreurs, debitMaximal: etatScenario.debitMaximal,
    })
  })
}

function exporter(): string {
  const resultats = construireResultats()
  const exporte: ExportBanc = {
    format: FORMAT_BANC, version: VERSION_BANC, date: new Date().toISOString(), paquet: pkg.version, rapide: rapide.checked,
    partiel: resultats.some((resultat) => resultat.statut !== 'complet'),
    fichierScenarios: { ...fichierScenarios!, empreinte },
    appareil: { detecte, saisi: saisi() }, scenarios: resultats, verification: stockage().verifications(),
  }
  const texte = `${JSON.stringify(exporte, null, 2)}\n`
  element<HTMLTextAreaElement>('export').value = texte
  return texte
}

element('lancer').addEventListener('click', () => executer(async (env) => {
  const magasin = stockage()
  await mesurerVitesses(env)
  const debut = performance.now()
  const prevu = scenarios.reduce((somme, scenario) => somme + estimation(scenario), 0) + dureeVerification()
  let fait = 0
  const barre = element<HTMLProgressElement>('barre')
  barre.max = prevu
  const avancer = (duree_: number): void => {
    fait += duree_
    barre.value = Math.min(fait, prevu)
    const ecoule = performance.now() - debut
    element('temps').textContent = t.progression(duree(ecoule), duree(fait > 0 ? Math.max(0, (prevu - fait) * ecoule / fait) : prevu))
  }
  element('bloc-resultats').hidden = false
  for (const [rang, scenario] of scenarios.entries()) {
    const repetitions = repetitionsEffectives(scenario)
    const p = plafond(scenario)
    const parRepetition = (estimation(scenario) - fenetreDebit(scenario)) / repetitions
    // Jusqu’à 3 tentatives ; une annulation n’en consomme pas.
    while (magasin.commencerTentative(scenario.id)) {
      const courant = magasin.lire(scenario.id)
      etat.textContent = t.tentative(scenario.id, courant.tentatives, TENTATIVES_MAX)
      try {
        magasin.modifier(scenario.id, (e) => { e.msParEssai = vitesses.get(cleConfiguration(scenario)) ?? null })
        for (let numero = magasin.lire(scenario.id).repetitions.length + 1; numero <= repetitions; numero++) {
          etat.textContent = t.enCours(scenario.id, rang + 1, scenarios.length, numero, repetitions)
          const faite = await repetition(scenario, p.retenus, env)
          magasin.modifier(scenario.id, (e) => { e.repetitions.push(faite) })
          avancer(parRepetition)
          afficherResultats(construireResultats())
        }
        if (!magasin.lire(scenario.id).debitMaximal) {
          etat.textContent = t.debitEnCours(scenario.id, p.retenus, duree(dureeDebit()))
          const debit = await debitMaximal(scenario, p.retenus, env, dureeDebit())
          magasin.modifier(scenario.id, (e) => { e.debitMaximal = debit })
          avancer(fenetreDebit(scenario))
        }
        magasin.modifier(scenario.id, (e) => { e.statut = 'complet' })
        afficherResultats(construireResultats())
      } catch (erreur) {
        if (annulation?.signal.aborted) {
          magasin.rendreTentative(scenario.id)
          throw erreur
        }
        const apres = magasin.echec(scenario.id, erreur instanceof Error ? erreur.message : String(erreur))
        if (apres.statut === 'incomplet') etat.textContent = t.scenarioIncomplet(scenario.id, apres.tentatives)
      }
    }
  }
  // Débit de vérification : une fois par configuration et nombre de fils (repris s’il est déjà stocké).
  const deja = magasin.verifications()
  for (const scenario of configurations(scenarios)) {
    for (const fils of coeurs > 1 ? [1, coeurs] : [1]) {
      if (deja.some((d) => d.fils === fils && d.algorithme === scenario.algorithme && JSON.stringify(d.parametres) === JSON.stringify(scenario.parametres))) continue
      etat.textContent = t.verificationEnCours(`${scenario.algorithme} ${JSON.stringify(scenario.parametres)}`, fils)
      magasin.ajouterVerification(await debitVerification(scenario, fils, env, DUREE_BANC_VERIFICATION_MS))
      avancer(DUREE_BANC_VERIFICATION_MS + 500)
      afficherResultats(construireResultats())
    }
  }
  dernierExport = exporter()
  etat.textContent = t.termine
}))

let dernierExport = ''

/** Nom daté à la seconde ; « partiel » tant que tous les scénarios ne sont pas complets. */
function nomExport(texte: string): string {
  const date = new Date()
  const partiel = (JSON.parse(texte) as ExportBanc).partiel ? '_partiel' : ''
  return `pow-equix-banc_${descriptionAppareil(navigator.userAgent)}_${horodatage(date)}${String(date.getSeconds()).padStart(2, '0')}${partiel}.json`
}

element('exporter-partiel').addEventListener('click', () => {
  dernierExport = exporter()
  element('bloc-resultats').hidden = false
  telecharger(nomExport(dernierExport), dernierExport)
})
element('effacer').addEventListener('click', () => {
  element('reprise').textContent = t.efface(Stockage.toutEffacer(localStorage))
  element('bloc-resultats').hidden = true
})

function afficherResultats(resultats: ResultatScenario[]): void {
  const avertissement = element('avertissement-rapide')
  avertissement.hidden = !rapide.checked
  avertissement.textContent = t.nonRepresentatif
  const d = (stats: Statistiques, cle: keyof Statistiques): string => duree(stats[cle] as number)
  remplirTableau(element('entete-resultats'), element('lignes-resultats'), t.colonnesResultats, resultats.map((resultat) => {
    const s = resultat.statistiques.dureeMs
    const premiere = resultat.repetitions[0]
    const memoire = premiere ? `${taille(premiere.memoireOctets)}${premiere.memoire === 'estimee' ? ' ≈' : ''}` : ''
    const fils = resultat.plafond.applique ? t.plafond(resultat.plafond.retenus, resultat.plafond.demandes) : String(resultat.filsEffectifs)
    if (!resultat.repetitions.length) return [resultat.scenario.id, t.statuts[resultat.statut], fils, '0', ...Array(16).fill('')]
    const cible = fichierScenarios?.dureeCibleMs ?? 0
    return [
      `${resultat.scenario.id}${cible && auDessusDeLaCible(resultat.scenario, s.mediane, cible) ? ` (${t.auDessus})` : ''}`, t.statuts[resultat.statut], fils, String(s.nombre), d(s, 'mediane'), d(s, 'moyenne'), d(s, 'p5'), d(s, 'p10'), d(s, 'p90'), d(s, 'p95'), d(s, 'min'), d(s, 'max'),
      `${nombres.format(s.rapportP90P10)}${s.rapportP90P10 > REGULARITE_MAX ? ' ⚠' : ''}`, nombres.format(s.rapportP95P5), `${resultat.debit100s.mesure ?? '—'} (≈ ${nombres.format(resultat.debit100s.extrapole)})`,
      resultat.debitMaximal ? nombres.format(resultat.debitMaximal.parCentSecondes) : '—',
      nombres.format(resultat.statistiques.essais.moyenne), duree(resultat.statistiques.verificationMs.mediane), taille(resultat.statistiques.tailleOctets.moyenne), memoire,
    ]
  }))
  remplirTableau(element('entete-verification'), element('lignes-verification'), t.colonnesVerification, stockage().verifications().map((debit) => [
    debit.algorithme, JSON.stringify(debit.parametres), String(debit.fils), nombres.format(debit.parSeconde),
  ]))
}

element('telecharger').addEventListener('click', () => {
  if (!dernierExport) dernierExport = exporter()
  telecharger(nomExport(dernierExport), dernierExport)
})

void lireScenarios()
