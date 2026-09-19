// Page du banc standardisé (démo seulement) : fiche de l’appareil, scénarios
// configurables, estimation et calibrage, exécution, statistiques, export JSON.

import pkg from '../../package.json'
import { descriptionAppareil, horodatage } from '../outils.ts'
import type { Langue } from '../textes.ts'
import { type Environnement, calibrer, configurations, debitVerification, repetition, resumer } from './executeur.ts'
import {
  DUREE_BANC_VERIFICATION_MS, REPETITIONS_RAPIDE, SCENARIOS_PROVISOIRES, type Scenario, type Statistiques, cleConfiguration, essaisAttendusScenario,
  estimerScenario, filsEffectifs, msParEssaiReference, validerScenarios,
} from './scenarios.ts'
import { type DebitVerification, type ExportBanc, FORMAT_BANC, type FicheAppareil, type ResultatScenario, VERSION_BANC } from './schema.ts'
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

// Scénarios.
const zone = element<HTMLTextAreaElement>('scenarios')
const messageScenarios = element('message-scenarios')
const rapide = element<HTMLInputElement>('rapide')
let scenarios: Scenario[] = []
/** Durée d’un essai sur un fil, par configuration, mesurée au calibrage. */
const calibrages = new Map<string, number>()

const repetitionsEffectives = (scenario: Scenario): number => (rapide.checked ? Math.min(REPETITIONS_RAPIDE, scenario.repetitions) : scenario.repetitions)
const msParEssai = (scenario: Scenario): number => calibrages.get(cleConfiguration(scenario)) ?? msParEssaiReference(scenario)
const estimation = (scenario: Scenario): number => estimerScenario(scenario, coeurs, msParEssai(scenario), repetitionsEffectives(scenario))
const dureeVerification = (): number => configurations(scenarios).length * (coeurs > 1 ? 2 : 1) * (DUREE_BANC_VERIFICATION_MS + 500)

function lireScenarios(): void {
  let valeur: unknown
  try {
    valeur = JSON.parse(zone.value)
  } catch (erreur) {
    scenarios = []
    messageScenarios.textContent = t.scenariosInvalides(erreur instanceof Error ? erreur.message : String(erreur))
    messageScenarios.classList.add('erreur')
    return afficherScenarios()
  }
  const lecture = validerScenarios(valeur)
  scenarios = 'scenarios' in lecture ? lecture.scenarios : []
  messageScenarios.textContent = 'scenarios' in lecture ? t.scenariosValides(scenarios.length) : t.scenariosInvalides(lecture.erreur)
  messageScenarios.classList.toggle('erreur', 'erreur' in lecture)
  afficherScenarios()
}

function afficherScenarios(): void {
  remplirTableau(element('entete-scenarios'), element('lignes-scenarios'), t.colonnes, scenarios.map((scenario) => [
    scenario.id, scenario.algorithme, JSON.stringify(scenario.parametres), String(scenario.parts), String(scenario.difficulte),
    String(filsEffectifs(scenario, coeurs)), String(repetitionsEffectives(scenario)), nombres.format(essaisAttendusScenario(scenario)), duree(estimation(scenario)),
  ]))
  const total = scenarios.reduce((somme, scenario) => somme + estimation(scenario), 0) + dureeVerification()
  element('estimation').textContent = scenarios.length ? t.estimationTotale(duree(total), scenarios.every((scenario) => calibrages.has(cleConfiguration(scenario)))) : ''
  element<HTMLButtonElement>('lancer').disabled = scenarios.length === 0
}

zone.value = JSON.stringify(SCENARIOS_PROVISOIRES, null, 2)
zone.addEventListener('input', lireScenarios)
rapide.addEventListener('change', afficherScenarios)
element('reinitialiser').addEventListener('click', () => {
  zone.value = JSON.stringify(SCENARIOS_PROVISOIRES, null, 2)
  lireScenarios()
})
element('exporter-scenarios').addEventListener('click', () => telecharger('pow-equix-banc-scenarios.json', `${JSON.stringify(scenarios, null, 2)}\n`))
const fichier = element<HTMLInputElement>('fichier-scenarios')
element('importer-scenarios').addEventListener('click', () => fichier.click())
fichier.addEventListener('change', async () => {
  const choisi = fichier.files?.[0]
  if (!choisi) return
  zone.value = await choisi.text()
  fichier.value = ''
  lireScenarios()
  if (scenarios.length) messageScenarios.textContent = `${t.importes(choisi.name)} ${messageScenarios.textContent}`
})
lireScenarios()

// Exécution.
const octetsEquix = fetch(new URL('equix.wasm', racine)).then(async (reponse) => new Uint8Array(await reponse.arrayBuffer()))
let annulation: AbortController | undefined
const etat = element('etat')
const boutons = { calibrer: element<HTMLButtonElement>('calibrer'), lancer: element<HTMLButtonElement>('lancer'), annuler: element<HTMLButtonElement>('annuler') }

async function environnement(): Promise<Environnement> {
  annulation = new AbortController()
  return {
    creerTravailleur: () => new Worker(new URL('banc-travailleur.js', racine), { type: 'module' }),
    octetsEquix: await octetsEquix, coeurs, signal: annulation.signal,
  }
}

async function calibrerTout(env: Environnement): Promise<void> {
  for (const scenario of configurations(scenarios)) {
    if (calibrages.has(cleConfiguration(scenario))) continue
    etat.textContent = t.calibrage(scenario.id)
    calibrages.set(cleConfiguration(scenario), await calibrer(scenario, env, 1000))
    afficherScenarios()
  }
}

async function executer(travail: (env: Environnement) => Promise<void>): Promise<void> {
  boutons.calibrer.disabled = true
  boutons.lancer.disabled = true
  boutons.annuler.hidden = false
  element('bloc-progression').hidden = false
  try {
    await travail(await environnement())
  } catch (erreur) {
    etat.textContent = annulation?.signal.aborted ? t.annule : t.erreur(erreur instanceof Error ? erreur.message : String(erreur))
  } finally {
    boutons.calibrer.disabled = false
    boutons.lancer.disabled = scenarios.length === 0
    boutons.annuler.hidden = true
  }
}

boutons.annuler.addEventListener('click', () => annulation?.abort())
boutons.calibrer.addEventListener('click', () => executer(async (env) => {
  await calibrerTout(env)
  etat.textContent = t.calibre
}))

let dernierExport = ''

boutons.lancer.addEventListener('click', () => executer(async (env) => {
  const liste = scenarios.map((scenario) => ({ ...scenario, repetitions: repetitionsEffectives(scenario) }))
  const modeRapide = rapide.checked
  await calibrerTout(env)
  const debut = performance.now()
  const prevu = liste.reduce((somme, scenario) => somme + estimation(scenario), 0) + dureeVerification()
  let fait = 0
  const barre = element<HTMLProgressElement>('barre')
  barre.max = prevu
  const avancer = (): void => {
    barre.value = Math.min(fait, prevu)
    const ecoule = performance.now() - debut
    element('temps').textContent = t.progression(duree(ecoule), duree(fait > 0 ? Math.max(0, (prevu - fait) * ecoule / fait) : prevu))
  }
  const resultats: ResultatScenario[] = []
  element('bloc-resultats').hidden = false
  for (const [rang, scenario] of liste.entries()) {
    const repetitions = []
    const parRepetition = estimation(scenario) / scenario.repetitions
    for (let numero = 1; numero <= scenario.repetitions; numero++) {
      etat.textContent = t.enCours(scenario.id, rang + 1, liste.length, numero, scenario.repetitions)
      repetitions.push(await repetition(scenario, env))
      fait += parRepetition
      avancer()
    }
    resultats.push(resumer(scenario, repetitions, coeurs, calibrages.get(cleConfiguration(scenario)) ?? null))
    afficherResultats(resultats, [], modeRapide)
  }
  const debits: DebitVerification[] = []
  for (const scenario of configurations(liste)) {
    for (const fils of coeurs > 1 ? [1, coeurs] : [1]) {
      etat.textContent = t.verificationEnCours(`${scenario.algorithme} ${JSON.stringify(scenario.parametres)}`, fils)
      debits.push(await debitVerification(scenario, fils, env, DUREE_BANC_VERIFICATION_MS))
      fait += DUREE_BANC_VERIFICATION_MS + 500
      avancer()
      afficherResultats(resultats, debits, modeRapide)
    }
  }
  const exporte: ExportBanc = {
    format: FORMAT_BANC, version: VERSION_BANC, date: new Date().toISOString(), paquet: pkg.version, rapide: modeRapide,
    appareil: { detecte, saisi: saisi() }, scenarios: resultats, verification: debits,
  }
  dernierExport = `${JSON.stringify(exporte, null, 2)}\n`
  element<HTMLTextAreaElement>('export').value = dernierExport
  etat.textContent = t.termine
}))

function afficherResultats(resultats: ResultatScenario[], debits: DebitVerification[], modeRapide: boolean): void {
  const avertissement = element('avertissement-rapide')
  avertissement.hidden = !modeRapide
  avertissement.textContent = t.nonRepresentatif
  const d = (stats: Statistiques, cle: keyof Statistiques): string => duree(stats[cle] as number)
  remplirTableau(element('entete-resultats'), element('lignes-resultats'), t.colonnesResultats, resultats.map((resultat) => {
    const s = resultat.statistiques.dureeMs
    const memoire = resultat.repetitions[0] ? `${taille(resultat.repetitions[0].memoireOctets)}${resultat.repetitions[0].memoire === 'estimee' ? ' ≈' : ''}` : ''
    return [
      resultat.scenario.id, String(s.nombre), d(s, 'mediane'), d(s, 'moyenne'), d(s, 'p5'), d(s, 'p10'), d(s, 'p90'), d(s, 'p95'), d(s, 'min'), d(s, 'max'),
      nombres.format(s.rapportP95P5), `${resultat.debit100s.mesure ?? '—'} (≈ ${nombres.format(resultat.debit100s.extrapole)})`,
      nombres.format(resultat.statistiques.essais.moyenne), duree(resultat.statistiques.verificationMs.mediane), taille(resultat.statistiques.tailleOctets.moyenne), memoire,
    ]
  }))
  remplirTableau(element('entete-verification'), element('lignes-verification'), t.colonnesVerification, debits.map((debit) => [
    debit.algorithme, JSON.stringify(debit.parametres), String(debit.fils), nombres.format(debit.parSeconde),
  ]))
}

element('telecharger').addEventListener('click', () => {
  if (!dernierExport) return
  telecharger(`pow-equix-banc_${descriptionAppareil(navigator.userAgent)}_${horodatage(new Date())}.json`, dernierExport)
})
