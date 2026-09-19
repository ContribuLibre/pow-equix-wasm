// Page de démo et de calibrage : mesure sur l’appareil le temps et la mémoire
// d’une preuve Equi-X, puis le coût de sa vérification. Tout ce qui se déduit des
// réglages s’affiche d’emblée ; les mesures se complètent à chaque preuve.
// Une seule page pour deux langues : la langue vient de <html lang>, les textes
// de textes.ts.

import {
  type CreateurEquixJs, type Execution, type Moteur, ModuleEquix, type PhasesEssai, SEUIL_JIT_MS, construireGraine, essaisAttendus, estimerDuree,
  executionEstimee, executionPrevue, filsAdaptatifs, filsConseilles, memoirePourN, msParEssai, probabiliteEssai, ralentissement, resoudre,
  webAssemblyDisponible,
} from '../src/index.ts'
import {
  FORMAT_MESURES, type Reglages, depuisParametres, fichierReglages, lireFichierReglages, nomFichierMesures, nomFichierReglages,
  probabiliteEcartLong, tailleCourante, versParametres,
} from './outils.ts'
import { type Langue, TEXTES } from './textes.ts'

interface Mesure {
  moteur: Moteur
  compilation: boolean
  execution: Execution
  n: number
  duree: number
  essais: number
  memoire: number
  taille: number
  fils: number
  phases: PhasesEssai | null
}
interface Verification { moteur: Moteur; parVerification: number; memoire: number }

/** Mémoire propre à une instance du module (pile, tas, tampon), en plus de la zone de travail du solveur : mesurée ≈ 1,3 Mio. */
const MEMOIRE_MODULE = 1.3 * 1024 * 1024

const langue: Langue = document.documentElement.lang === 'en' ? 'en' : 'fr'
const textes = TEXTES[langue]
const t = textes.dynamique

const element = <T extends HTMLElement>(id: string): T => {
  const trouve = document.getElementById(id)
  if (!trouve) throw new Error(`Élément absent : ${id}`)
  return trouve as T
}

const formulaire = element<HTMLFormElement>('reglages')
const lancer = element<HTMLButtonElement>('lancer')
const annuler = element<HTMLButtonElement>('annuler')
const nombres = new Intl.NumberFormat(textes.locale, { maximumFractionDigits: 1 })

function duree(ms: number): string {
  if (ms < 1) return `${nombres.format(ms * 1000)} µs`
  if (ms < 1000) return `${nombres.format(ms)} ms`
  if (ms < 120_000) return `${nombres.format(ms / 1000)} s`
  return `${nombres.format(ms / 60_000)} min`
}

function taille(octets: number): string {
  return octets >= 1024 * 1024 ? `${nombres.format(octets / 1024 / 1024)} ${textes.unites.mio}` : `${nombres.format(octets / 1024)} ${textes.unites.kio}`
}

function remplir(liste: HTMLElement, lignes: Array<[string, string]>): void {
  liste.replaceChildren(...lignes.flatMap(([terme, valeur]) => {
    const dt = document.createElement('dt')
    dt.textContent = terme
    const dd = document.createElement('dd')
    dd.textContent = valeur
    return [dt, dd]
  }))
}

function centile(valeurs: number[], rang: number): number {
  const triees = [...valeurs].sort((gauche, droite) => gauche - droite)
  return triees[Math.min(triees.length - 1, Math.ceil(rang * triees.length) - 1)] ?? 0
}

const champ = (nom: keyof Reglages): HTMLInputElement | HTMLSelectElement => formulaire.elements.namedItem(nom) as HTMLInputElement | HTMLSelectElement

function reglages(): Reglages {
  const valeur = (nom: keyof Reglages): number => Number(champ(nom).value)
  return {
    effort: valeur('effort'), nombre: valeur('nombre'), n: valeur('n'), compilation: champ('compilation').value as Reglages['compilation'],
    repartition: champ('repartition').value as Reglages['repartition'], fils: valeur('fils'), moteur: champ('moteur').value as Reglages['moteur'],
    repetitions: valeur('repetitions'), verifications: valeur('verifications'),
  }
}

/** Applique des réglages (déjà validés) au formulaire. */
function appliquer(partiels: Partial<Reglages>): void {
  for (const [nom, valeur] of Object.entries(partiels)) champ(nom as keyof Reglages).value = String(valeur)
  if (partiels.fils !== undefined) filsChoisis = true
}

const navigateur = navigator as Navigator & { deviceMemory?: number }
const appareil = {
  navigateur: navigator.userAgent,
  coeurs: navigator.hardwareConcurrency ?? null,
  memoireAppareilGo: navigateur.deviceMemory ?? null,
  webAssembly: webAssemblyDisponible(),
  langues: [...(navigator.languages ?? [])],
}
remplir(element('appareil'), [
  [t.coeurs, String(appareil.coeurs ?? t.inconnu)],
  [t.memoireAppareil, appareil.memoireAppareilGo ? t.memoireAppareilValeur(appareil.memoireAppareilGo) : t.nonCommuniquee],
  [t.webAssembly, appareil.webAssembly ? t.disponible : t.indisponible],
  [t.navigateur, appareil.navigateur],
])
element('alerte-wasm').hidden = appareil.webAssembly

const champFils = champ('fils') as HTMLInputElement
/** Tant qu’il n’est pas modifié à la main, le champ suit le choix par défaut du paquet. */
let filsChoisis = false
champFils.addEventListener('input', () => { filsChoisis = true })

// Réglages transmis par l’adresse (lien de l’autre langue) : appliqués s’ils sont valides.
appliquer(depuisParametres(new URLSearchParams(location.search), t.erreurs))

/** Le lien vers l’autre langue emporte les réglages en cours. */
function mettreAJourLienLangue(): void {
  const lien = element<HTMLAnchorElement>('autre-langue')
  const base = lien.getAttribute('href')!.split('?')[0]!
  const parametres = versParametres(reglages())
  // Un nombre de fils non choisi à la main suit le défaut du paquet, là-bas aussi.
  if (!filsChoisis) parametres.delete('fils')
  lien.setAttribute('href', `${base}?${parametres}`)
}

/** Exécution que le calcul emploiera, avec les deux moteurs fournis. */
function executionChoisie(choix: Reglages): Execution | null {
  return executionPrevue({ octets: new Uint8Array(1), chargerJs: () => Promise.reject(new Error('non chargé')), moteur: choix.moteur, compilation: choix.compilation })
}

/** Durée moyenne d’un essai sur un fil, d’après les phases mesurées de la dernière série. */
let essaiMesure: { ms: number; n: number } | undefined

function prevoir(): void {
  const choix = reglages()
  if (!(choix.effort >= 1 && choix.nombre >= 1)) return mettreAJourLienLangue()
  const adaptatif = choix.repartition === 'adaptatif'
  if (!filsChoisis) champFils.value = String(filsConseilles(choix.effort, choix.nombre))
  champFils.disabled = adaptatif
  const fils = Math.max(1, Number(champFils.value))
  const essais = essaisAttendus(choix.effort, choix.nombre)
  const prevue = executionChoisie(choix)
  const execution: Execution = prevue ?? 'jsSansJit'
  const filsActifs = Math.min(fils, Math.ceil(essais))
  const parFil = memoirePourN(choix.n) + MEMOIRE_MODULE
  // Taille exacte quand chaque écart de compteur tient sur un octet ; la variante ne s’affiche que si elle n’est pas rare.
  const courante = tailleCourante(choix.nombre, choix.n)
  const risque = probabiliteEcartLong(choix.effort, choix.nombre)
  const filsDeDepart = appareil.memoireAppareilGo
    ? filsAdaptatifs()({ essaisTermines: 0, dureePremierEssaiMs: null, dureeMoyenneEssaiMs: null, filsActifs: 1, n: choix.n, execution })
    : null
  const lignes: Array<[string, string]> = [
    [t.taillePreuve, risque >= 0.01 ? t.taillePreuveValeur(courante, courante + 1, nombres.format(risque * 100)) : t.taillePreuveValeur(courante, null, null)],
    [t.reussite, `${nombres.format(probabiliteEssai(choix.effort) * 100)} %`],
    [t.essaisAttendus, t.essaisAttendusValeur(nombres.format(essais))],
    [t.executionPrevue, prevue === null ? t.aucuneExecution : `${t.executions[prevue].replace(' *', '')}${prevue === 'wasmCompile' ? '' : t.plusLentQueCompile(nombres.format(ralentissement(prevue, 'wasmCompile')))}`],
    [t.dureeEssai, t.dureeEssaiValeur(duree(msParEssai(execution, choix.n)))],
    ...(adaptatif ? [[t.parallelisation, filsDeDepart === null ? t.parallelisationAdaptative : t.parallelisationMemoire(filsDeDepart)] as [string, string]] : []),
    [t.dureeEstimee, t.dureeAvecFils(duree(estimerDuree({ effort: choix.effort, nombre: choix.nombre, execution, fils, n: choix.n })), fils)],
    [t.memoireParFil, t.memoireParFilValeur(taille(parFil), taille(memoirePourN(choix.n)))],
    [t.memoireTotale, t.memoireTotaleValeur(taille(parFil * filsActifs), filsActifs)],
    [t.verificationEstimee, t.verificationEstimeeValeur(duree(choix.nombre * 0.25 * (execution.startsWith('wasm') ? 1 : ralentissement(execution))))],
  ]
  // Même calcul que la durée estimée (mêmes parts, effort et fils), avec l’essai mesuré au lieu de la référence.
  if (essaiMesure && essaiMesure.n === choix.n) {
    const ramene = essais * essaiMesure.ms / Math.max(1, Math.min(fils, essais))
    lignes.push([t.dureeDerniereMesure, t.dureeDerniereMesureValeur(duree(ramene), fils, duree(essaiMesure.ms))])
  }
  remplir(element('previsions'), lignes)
  mettreAJourLienLangue()
}
formulaire.addEventListener('input', prevoir)
prevoir()

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

const messageReglages = element('message-reglages')
function signaler(message: string, erreur: boolean): void {
  messageReglages.textContent = message
  messageReglages.classList.toggle('erreur', erreur)
}

element('exporter-reglages').addEventListener('click', () => {
  const choix = reglages()
  telecharger(nomFichierReglages(choix, new Date()), fichierReglages(choix))
})
const fichier = element<HTMLInputElement>('fichier-reglages')
element('importer-reglages').addEventListener('click', () => fichier.click())
fichier.addEventListener('change', async () => {
  const choisi = fichier.files?.[0]
  if (!choisi) return
  const lecture = lireFichierReglages(await choisi.text(), t.erreurs)
  fichier.value = ''
  if ('erreur' in lecture) return signaler(t.erreurImport(lecture.erreur), true)
  appliquer(lecture.reglages)
  prevoir()
  signaler(t.reglagesImportes(choisi.name), false)
})

const octetsWasm = fetch('../equix.wasm').then(async (reponse) => {
  if (!reponse.ok) throw new Error(`equix.wasm (${reponse.status})`)
  return new Uint8Array(await reponse.arrayBuffer())
})
/**
 * Le moteur JavaScript pèse ≈ 620 Ko : `resoudre` ne l’appelle que si
 * WebAssembly est indisponible ou échoue (le chargement est mémorisé).
 */
let moteurJs: Promise<CreateurEquixJs> | undefined
const chargerJs = (): Promise<CreateurEquixJs> => (moteurJs ??= import('../dist/equix-js.js').then((module) => module.creerExportsEquixJs))

let calcul: AbortController | undefined
annuler.addEventListener('click', () => calcul?.abort())

formulaire.addEventListener('submit', async (evenement) => {
  evenement.preventDefault()
  const choix = reglages()
  const adaptatif = choix.repartition === 'adaptatif'
  calcul = new AbortController()
  lancer.disabled = true
  annuler.hidden = false
  element('bloc-progression').hidden = false
  element('bloc-resultats').hidden = false
  const etat = element('etat')
  const barre = element<HTMLProgressElement>('barre')
  const mesures: Mesure[] = []
  let verification: Verification | undefined
  afficher(choix, mesures, verification)
  try {
    const octets = choix.moteur === 'js' ? undefined : await octetsWasm.catch(() => undefined)
    for (let repetition = 1; repetition <= choix.repetitions; repetition++) {
      // Une graine différente à chaque répétition : chaque preuve est indépendante.
      const graine = await construireGraine('pow-equix-wasm/demo', `${Date.now()}-${repetition}-${Math.random()}`)
      etat.textContent = t.preuveEnCours(repetition, choix.repetitions)
      barre.max = choix.nombre
      barre.value = 0
      let memoire = 0
      const paliers: number[] = []
      /** Suite des nombres de fils actifs pendant cette preuve : 1 → 2 → 4… */
      const evolution = (actifs: number): string => {
        if (paliers.at(-1) !== actifs) paliers.push(actifs)
        return paliers.join(' → ')
      }
      const resultat = await resoudre({
        octets, chargerJs, moteur: choix.moteur, compilation: choix.compilation, n: choix.n, graine, effort: choix.effort, nombre: choix.nombre,
        fils: adaptatif ? filsAdaptatifs() : choix.fils, signal: calcul.signal,
        onProgression: (progression) => {
          memoire = Math.max(memoire, progression.memoireOctets)
          barre.value = progression.parts
          remplir(element('direct'), [
            [t.moteur, t.moteurProgression(progression.moteur === 'wasm', progression.compilation)],
            ...(progression.repli ? [[t.repli, progression.repli.raison === 'indisponible' ? t.repliIndisponible : t.repliEchec(progression.repli.message ?? '')] as [string, string]] : []),
            [t.parametre, `n = ${progression.n}`],
            [t.filsActifs, progression.filsActifs ? t.filsActifsValeur(progression.filsActifs, adaptatif ? evolution(progression.filsActifs) : null) : t.filPrincipal],
            [t.partsTrouvees, `${progression.parts} / ${choix.nombre}`],
            [t.essais, String(progression.essais)],
            [t.tempsEcoule, duree(progression.dureeMs)],
            [t.tempsRestant, progression.restantEstimeMs === null ? '…' : duree(progression.restantEstimeMs)],
            [t.memoireReelle, taille(progression.memoireOctets)],
          ])
        },
      })
      const execution = executionEstimee({ moteur: resultat.moteur, compilation: resultat.compilation, n: resultat.n, dureeEssaiMs: resultat.phasesMoyennes?.totalMs ?? null })
      mesures.push({
        moteur: resultat.moteur, compilation: resultat.compilation, execution, n: resultat.n, duree: resultat.dureeMs, essais: resultat.essais,
        memoire: Math.max(memoire, resultat.memoireOctets), taille: resultat.parts.length, fils: resultat.fils, phases: resultat.phasesMoyennes,
      })
      // Dès la première preuve : pause pour mesurer la vérification, puis la suite.
      if (!verification) {
        etat.textContent = t.mesureVerification
        verification = mesurerVerification(resultat.moteur === 'wasm' ? await ModuleEquix.instancier(octets!) : ModuleEquix.depuisJs(await chargerJs()), graine, resultat.parts, choix)
      }
      afficher(choix, mesures, verification)
    }
    etat.textContent = t.termine
  } catch (erreur) {
    etat.textContent = calcul.signal.aborted ? t.annule : t.erreur(erreur instanceof Error ? erreur.message : String(erreur))
  } finally {
    lancer.disabled = false
    annuler.hidden = true
    lancer.focus()
  }
})

function mesurerVerification(module: ModuleEquix, graine: Uint8Array, parts: Uint8Array, choix: Reglages): Verification {
  // Le moteur JavaScript est bien plus lent : on borne la mesure à une seconde environ.
  const debut = performance.now()
  let faites = 0
  while (faites < choix.verifications && (faites < 3 || performance.now() - debut < 1000)) {
    if (!module.verifier(graine, parts, choix.effort, choix.nombre, choix.n)) throw new Error(t.verificationIncoherente)
    faites++
  }
  return { moteur: module.moteur, parVerification: (performance.now() - debut) / faites, memoire: module.memoireOctets }
}

/** Moyenne des phases de plusieurs preuves, pondérée par leurs essais. */
function phasesMoyennes(mesures: Mesure[]): PhasesEssai | null {
  const avecPhases = mesures.filter((mesure) => mesure.phases)
  const poids = avecPhases.reduce((somme, mesure) => somme + mesure.essais, 0)
  if (!poids) return null
  const moyenne = { preparationMs: 0, generationMs: 0, compilationMs: 0, remplissageMs: 0, rechercheMs: 0, totalMs: 0 }
  for (const mesure of avecPhases) {
    for (const cle of Object.keys(moyenne) as Array<keyof PhasesEssai>) moyenne[cle] += mesure.phases![cle] * mesure.essais / poids
  }
  return moyenne
}

let dernierExport = ''

function afficher(choix: Reglages, mesures: Mesure[], verification: Verification | undefined): void {
  const durees = mesures.map((mesure) => mesure.duree)
  const essais = mesures.reduce((somme, mesure) => somme + mesure.essais, 0)
  const tempsTotal = durees.reduce((somme, valeur) => somme + valeur, 0)
  const phases = phasesMoyennes(mesures)
  const derniere = mesures.at(-1)
  if (phases && derniere) essaiMesure = { ms: phases.totalMs, n: derniere.n }
  const memoireMax = mesures.length ? Math.max(...mesures.map((mesure) => mesure.memoire)) : 0
  const filsMax = mesures.length ? Math.max(...mesures.map((mesure) => mesure.fils)) : 0
  const detail = (): string => {
    const execution = derniere!.execution
    const compilation = phases!.generationMs + phases!.compilationMs
    return t.detailEssai(duree(phases!.totalMs), t.executions[execution], compilation > 0 ? duree(compilation) : null, duree(msParEssai(execution, derniere!.n)))
  }
  remplir(element('synthese'), derniere ? [
    [t.preuvesMesurees, t.preuvesMesureesValeur(mesures.length, choix.repetitions)],
    [t.dureeMediane, duree(centile(durees, 0.5))],
    [t.centile90, mesures.length >= 3 ? duree(centile(durees, 0.9)) : t.auMoinsTrois],
    [t.moyenne, duree(tempsTotal / mesures.length)],
    [t.minMax, `${duree(Math.min(...durees))} – ${duree(Math.max(...durees))}`],
    [t.essaisParPreuve, t.essaisParPreuveValeur(nombres.format(essais / mesures.length), nombres.format(essaisAttendus(choix.effort, choix.nombre)))],
    ...(phases ? [[t.dureeEssaiUnFil, detail()] as [string, string]] : []),
    [t.webWorkers, t.webWorkersValeur(filsMax)],
    [t.memoireModule, t.memoireModuleValeur(taille(memoireMax), filsMax > 0 ? taille(memoireMax / filsMax) : null)],
  ] : [[t.preuvesMesurees, t.preuvesMesureesValeur(0, choix.repetitions)]])
  element('lignes').replaceChildren(...mesures.map((mesure, index) => {
    const ligne = document.createElement('tr')
    for (const texte of [String(index + 1), t.executions[mesure.execution], String(mesure.n), duree(mesure.duree), String(mesure.essais), nombres.format(mesure.essais / (mesure.duree / 1000)), taille(mesure.memoire)]) {
      const cellule = document.createElement('td')
      cellule.textContent = texte
      ligne.append(cellule)
    }
    return ligne
  }))
  const noteJit = element('note-jit')
  noteJit.hidden = !mesures.some((mesure) => mesure.moteur === 'js')
  noteJit.textContent = t.estimationJit(duree(SEUIL_JIT_MS))
  remplir(element('verification'), verification ? [
    [t.moteur, verification.moteur === 'wasm' ? 'WebAssembly' : 'JavaScript'],
    [t.parVerification, duree(verification.parVerification)],
    [t.parPart, duree(verification.parVerification / choix.nombre)],
    [t.taillePreuve, derniere ? t.tailleMesuree(derniere.taille, tailleCourante(choix.nombre, choix.n)) : '…'],
    [t.memoireModule, taille(verification.memoire)],
  ] : [[textes.page.verification!, t.verificationAttendue]])
  dernierExport = JSON.stringify({
    format: FORMAT_MESURES,
    version: 1,
    appareil,
    reglages: choix,
    preuves: mesures.map((mesure) => ({
      moteur: mesure.moteur, compilation: mesure.compilation, execution: mesure.execution, n: mesure.n, fils: mesure.fils, tailleOctets: mesure.taille,
      dureeMs: Math.round(mesure.duree), essais: mesure.essais, memoireOctets: mesure.memoire,
      phasesMs: mesure.phases ? Object.fromEntries(Object.entries(mesure.phases).map(([cle, valeur]) => [cle.replace(/Ms$/, ''), Number(valeur.toFixed(2))])) : null,
    })),
    synthese: derniere ? {
      medianeMs: Math.round(centile(durees, 0.5)), p90Ms: Math.round(centile(durees, 0.9)), essaiMs: phases ? Number(phases.totalMs.toFixed(2)) : null,
      compilationHashxMs: phases ? Number((phases.generationMs + phases.compilationMs).toFixed(2)) : null, memoireMaxOctets: memoireMax,
    } : null,
    verification: verification ? { moteur: verification.moteur, parVerificationMs: Number(verification.parVerification.toFixed(4)), memoireOctets: verification.memoire } : null,
    date: new Date().toISOString(),
  }, null, 2)
  element<HTMLTextAreaElement>('export').value = dernierExport
  prevoir()
}

element('copier').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(element<HTMLTextAreaElement>('export').value)
    element('copier').textContent = t.copie
  } catch {
    element<HTMLTextAreaElement>('export').select()
  }
})
element('telecharger').addEventListener('click', () => {
  if (dernierExport) telecharger(nomFichierMesures(navigator.userAgent, reglages().n, new Date()), `${dernierExport}\n`)
})
