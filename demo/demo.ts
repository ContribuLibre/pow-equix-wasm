// Page de démo et de calibrage : mesure sur l’appareil le temps et la mémoire
// d’une preuve Equi-X, puis le coût de sa vérification. Tout ce qui se déduit des
// réglages s’affiche d’emblée ; les mesures se complètent à chaque preuve.

import {
  type Compilation, type CreateurEquixJs, type Execution, type Moteur, ModuleEquix, construireGraine, essaisAttendus, estimerDuree, executionPrevue,
  filsConseilles, memoirePourN, msParEssai, probabiliteEssai, ralentissement, resoudre, tailleMaxPreuve, taillePreuve, webAssemblyDisponible,
} from '../src/index.ts'

interface Mesure { moteur: Moteur; compilation: boolean; n: number; duree: number; essais: number; memoire: number; taille: number }
interface Verification { moteur: Moteur; parVerification: number; memoire: number }
type Reglages = { effort: number; nombre: number; n: number; compilation: Compilation; fils: number; moteur: Moteur | 'auto'; repetitions: number; verifications: number }

/** Mémoire propre à une instance du module (pile, tas, tampon), en plus de la zone de travail du solveur : mesurée ≈ 1,3 Mio. */
const MEMOIRE_MODULE = 1.3 * 1024 * 1024

const NOMS_EXECUTION: Record<Execution, string> = {
  wasmCompile: 'WebAssembly, programmes HashX compilés',
  wasm: 'WebAssembly, programmes HashX interprétés',
  js: 'JavaScript',
  jsSansJit: 'JavaScript (probablement sans JIT)',
}

const element = <T extends HTMLElement>(id: string): T => {
  const trouve = document.getElementById(id)
  if (!trouve) throw new Error(`Élément absent : ${id}`)
  return trouve as T
}

const formulaire = element<HTMLFormElement>('reglages')
const lancer = element<HTMLButtonElement>('lancer')
const annuler = element<HTMLButtonElement>('annuler')
const nombres = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })

function duree(ms: number): string {
  if (ms < 1) return `${nombres.format(ms * 1000)} µs`
  if (ms < 1000) return `${nombres.format(ms)} ms`
  if (ms < 120_000) return `${nombres.format(ms / 1000)} s`
  return `${nombres.format(ms / 60_000)} min`
}

function taille(octets: number): string {
  return octets >= 1024 * 1024 ? `${nombres.format(octets / 1024 / 1024)} Mio` : `${nombres.format(octets / 1024)} Kio`
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

function reglages(): Reglages {
  const valeur = (nom: string): number => Number((formulaire.elements.namedItem(nom) as HTMLInputElement).value)
  const choix = (nom: string): string => (formulaire.elements.namedItem(nom) as HTMLSelectElement).value
  return {
    effort: valeur('effort'), nombre: valeur('nombre'), n: Number(choix('n')), compilation: choix('compilation') as Compilation, fils: valeur('fils'),
    moteur: choix('moteur') as Reglages['moteur'], repetitions: valeur('repetitions'), verifications: valeur('verifications'),
  }
}

const navigateur = navigator as Navigator & { deviceMemory?: number }
const appareil = {
  navigateur: navigator.userAgent,
  coeurs: navigator.hardwareConcurrency ?? null,
  memoireAppareilGo: navigateur.deviceMemory ?? null,
  webAssembly: webAssemblyDisponible(),
}
remplir(element('appareil'), [
  ['Cœurs annoncés', String(appareil.coeurs ?? 'inconnu')],
  ['Mémoire de l’appareil', appareil.memoireAppareilGo ? `≥ ${appareil.memoireAppareilGo} Go` : 'non communiquée'],
  ['WebAssembly', appareil.webAssembly ? 'disponible' : 'indisponible'],
  ['Navigateur', appareil.navigateur],
])
element('alerte-wasm').hidden = appareil.webAssembly

const champFils = formulaire.elements.namedItem('fils') as HTMLInputElement
/** Tant qu’il n’est pas modifié à la main, le champ suit le choix par défaut du paquet. */
let filsChoisis = false
champFils.addEventListener('input', () => { filsChoisis = true })

/**
 * Taille probable de la preuve : compteurs répartis régulièrement sur les essais
 * attendus (chaque écart en LEB128 : un octet sous 128, deux sous 16 384…).
 */
function taillePrevue(choix: Reglages, essais: number): number {
  return taillePreuve(Array.from({ length: choix.nombre }, (_, index) => Math.max(index, Math.round((index + 1) * essais / choix.nombre) - 1)), choix.n)
}

/** Exécution que le calcul emploiera, avec les deux moteurs fournis. */
function executionChoisie(choix: Reglages): Execution | null {
  return executionPrevue({ octets: new Uint8Array(1), js: () => { throw new Error('non chargé') }, moteur: choix.moteur, compilation: choix.compilation })
}

let tempsParEssaiMesure: number | undefined

function prevoir(): void {
  const choix = reglages()
  if (!(choix.effort >= 1 && choix.nombre >= 1)) return
  if (!filsChoisis) champFils.value = String(filsConseilles(choix.effort, choix.nombre))
  const fils = Math.max(1, Number(champFils.value))
  const essais = essaisAttendus(choix.effort, choix.nombre)
  const prevue = executionChoisie(choix)
  const execution: Execution = prevue ?? 'jsSansJit'
  const filsActifs = Math.min(fils, Math.ceil(essais))
  const parFil = memoirePourN(choix.n) + MEMOIRE_MODULE
  const lignes: Array<[string, string]> = [
    ['Taille de la preuve', `≈ ${taillePrevue(choix, essais)} octets (au plus ${tailleMaxPreuve(choix.n, choix.nombre)})`],
    ['Réussite d’un essai', `${nombres.format(probabiliteEssai(choix.effort) * 100)} %`],
    ['Essais attendus', `${nombres.format(essais)} en moyenne par preuve`],
    ['Exécution prévue', prevue === null ? 'aucune : WebAssembly indisponible' : `${NOMS_EXECUTION[prevue]}${prevue === 'wasmCompile' ? '' : `, ${nombres.format(ralentissement(prevue, 'wasmCompile'))} × plus lent que compilé`}`],
    ['Durée d’un essai', `≈ ${duree(msParEssai(execution, choix.n))} sur un cœur`],
    ['Durée estimée', `${duree(estimerDuree({ effort: choix.effort, nombre: choix.nombre, execution, fils, n: choix.n }))} avec ${fils} fil(s)`],
    ['Mémoire par fil', `≈ ${taille(parFil)} (${taille(memoirePourN(choix.n))} de travail + module)`],
    ['Mémoire totale', `≈ ${taille(parFil * filsActifs)} pour ${filsActifs} fil(s) actif(s)`],
    ['Vérification estimée', `≈ ${duree(choix.nombre * 0.25 * (execution.startsWith('wasm') ? 1 : ralentissement(execution)))} par preuve, quel que soit n`],
  ]
  if (tempsParEssaiMesure) lignes.push(['Durée d’après la dernière mesure', duree(essais * tempsParEssaiMesure / Math.min(fils, essais))])
  remplir(element('previsions'), lignes)
}
formulaire.addEventListener('input', prevoir)
prevoir()

const octetsWasm = fetch('./equix.wasm').then(async (reponse) => {
  if (!reponse.ok) throw new Error(`Module indisponible (${reponse.status})`)
  return new Uint8Array(await reponse.arrayBuffer())
})
/** Le moteur JavaScript pèse ~500 Ko : il n’est chargé que s’il sert. */
let moteurJs: Promise<CreateurEquixJs> | undefined
const chargerJs = (): Promise<CreateurEquixJs> => (moteurJs ??= import('../dist/equix-js.js').then((module) => module.creerExportsEquixJs))

let calcul: AbortController | undefined
annuler.addEventListener('click', () => calcul?.abort())

formulaire.addEventListener('submit', async (evenement) => {
  evenement.preventDefault()
  const choix = reglages()
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
    const execution = executionChoisie(choix)
    const octets = execution?.startsWith('wasm') || choix.moteur === 'auto' ? await octetsWasm.catch(() => undefined) : undefined
    const js = execution === 'js' || execution === 'jsSansJit' ? await chargerJs() : undefined
    for (let repetition = 1; repetition <= choix.repetitions; repetition++) {
      // Une graine différente à chaque répétition : chaque preuve est indépendante.
      const graine = await construireGraine('pow-equix-wasm/demo', `${Date.now()}-${repetition}-${Math.random()}`)
      etat.textContent = `Preuve ${repetition} sur ${choix.repetitions}…`
      barre.max = choix.nombre
      barre.value = 0
      let memoire = 0
      const resultat = await resoudre({
        octets, js, moteur: choix.moteur, compilation: choix.compilation, n: choix.n, graine, effort: choix.effort, nombre: choix.nombre, fils: choix.fils, signal: calcul.signal,
        onProgression: (progression) => {
          memoire = Math.max(memoire, progression.memoireOctets)
          barre.value = progression.parts
          remplir(element('direct'), [
            ['Moteur', progression.moteur === 'wasm' ? `WebAssembly, programmes ${progression.compilation ? 'compilés' : 'interprétés'}` : 'JavaScript'],
            ['Paramètre', `n = ${progression.n}`],
            ['Parts trouvées', `${progression.parts} / ${choix.nombre}`],
            ['Essais', String(progression.essais)],
            ['Temps écoulé', duree(progression.dureeMs)],
            ['Temps restant estimé', progression.restantEstimeMs === null ? '…' : duree(progression.restantEstimeMs)],
            ['Mémoire réelle des modules', taille(progression.memoireOctets)],
          ])
        },
      })
      mesures.push({ moteur: resultat.moteur, compilation: resultat.compilation, n: resultat.n, duree: resultat.dureeMs, essais: resultat.essais, memoire: Math.max(memoire, resultat.memoireOctets), taille: resultat.parts.length })
      // Dès la première preuve : pause pour mesurer la vérification, puis la suite.
      if (!verification) {
        etat.textContent = 'Mesure de la vérification…'
        verification = mesurerVerification(resultat.moteur === 'wasm' ? await ModuleEquix.instancier(octets!) : ModuleEquix.depuisJs(js!), graine, resultat.parts, choix)
      }
      afficher(choix, mesures, verification)
    }
    etat.textContent = 'Terminé.'
  } catch (erreur) {
    etat.textContent = calcul.signal.aborted ? 'Calcul annulé.' : `Erreur : ${erreur instanceof Error ? erreur.message : String(erreur)}`
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
    if (!module.verifier(graine, parts, choix.effort, choix.nombre, choix.n)) throw new Error('Une preuve calculée n’a pas été vérifiée : module ou chargeur incohérent.')
    faites++
  }
  return { moteur: module.moteur, parVerification: (performance.now() - debut) / faites, memoire: module.memoireOctets }
}

/** Exécution effectivement mesurée, pour la comparer à sa référence. */
function executionMesuree(mesure: Mesure): Execution {
  if (mesure.moteur === 'wasm') return mesure.compilation ? 'wasmCompile' : 'wasm'
  return appareil.webAssembly ? 'js' : 'jsSansJit'
}

function afficher(choix: Reglages, mesures: Mesure[], verification: Verification | undefined): void {
  const durees = mesures.map((mesure) => mesure.duree)
  const essais = mesures.reduce((somme, mesure) => somme + mesure.essais, 0)
  const tempsTotal = durees.reduce((somme, valeur) => somme + valeur, 0)
  if (mesures.length) {
    // Parallélisme effectif : un fil ne compte que s’il reste un essai à mener.
    const parallelisme = Math.min(Math.max(1, choix.fils), essais / mesures.length)
    tempsParEssaiMesure = tempsTotal * parallelisme / essais
  }
  const memoireMax = mesures.length ? Math.max(...mesures.map((mesure) => mesure.memoire)) : 0
  remplir(element('synthese'), mesures.length ? [
    ['Preuves mesurées', `${mesures.length} sur ${choix.repetitions}`],
    ['Durée médiane', duree(centile(durees, 0.5))],
    ['90ᵉ centile', mesures.length >= 3 ? duree(centile(durees, 0.9)) : 'au moins 3 preuves nécessaires'],
    ['Moyenne', duree(tempsTotal / mesures.length)],
    ['Min – max', `${duree(Math.min(...durees))} – ${duree(Math.max(...durees))}`],
    ['Essais par preuve', `${nombres.format(essais / mesures.length)} mesurés, ${nombres.format(essaisAttendus(choix.effort, choix.nombre))} attendus`],
    ['Durée d’un essai (un fil)', `${duree(tempsParEssaiMesure!)} (référence ${NOMS_EXECUTION[executionMesuree(mesures[0]!)]} : ${duree(msParEssai(executionMesuree(mesures[0]!), mesures[0]!.n))})`],
    ['Mémoire du module', `${taille(memoireMax)} au total${choix.fils > 0 ? `, ${taille(memoireMax / Math.min(choix.fils, Math.ceil(essais / mesures.length)))} par fil actif` : ''}`],
  ] : [['Preuves mesurées', `0 sur ${choix.repetitions}`]])
  element('lignes').replaceChildren(...mesures.map((mesure, index) => {
    const ligne = document.createElement('tr')
    for (const texte of [String(index + 1), mesure.moteur === 'wasm' ? (mesure.compilation ? 'WebAssembly compilé' : 'WebAssembly interprété') : 'JavaScript', String(mesure.n), duree(mesure.duree), String(mesure.essais), nombres.format(mesure.essais / (mesure.duree / 1000)), taille(mesure.memoire)]) {
      const cellule = document.createElement('td')
      cellule.textContent = texte
      ligne.append(cellule)
    }
    return ligne
  }))
  remplir(element('verification'), verification ? [
    ['Moteur', verification.moteur === 'wasm' ? 'WebAssembly' : 'JavaScript'],
    ['Par vérification', duree(verification.parVerification)],
    ['Par part', duree(verification.parVerification / choix.nombre)],
    ['Taille de la preuve', mesures.length ? `${mesures.at(-1)!.taille} octets mesurés (≈ ${taillePrevue(choix, essaisAttendus(choix.effort, choix.nombre))} prévus)` : '…'],
    ['Mémoire du module', taille(verification.memoire)],
  ] : [['Vérification', 'mesurée dès la fin de la première preuve']])
  element<HTMLTextAreaElement>('export').value = JSON.stringify({
    appareil,
    reglages: choix,
    preuves: mesures.map((mesure) => ({ moteur: mesure.moteur, compilation: mesure.compilation, n: mesure.n, tailleOctets: mesure.taille, dureeMs: Math.round(mesure.duree), essais: mesure.essais, memoireOctets: mesure.memoire })),
    synthese: mesures.length ? { medianeMs: Math.round(centile(durees, 0.5)), p90Ms: Math.round(centile(durees, 0.9)), tempsParEssaiMs: Number(tempsParEssaiMesure!.toFixed(2)), memoireMaxOctets: memoireMax } : null,
    verification: verification ? { moteur: verification.moteur, parVerificationMs: Number(verification.parVerification.toFixed(4)), memoireOctets: verification.memoire } : null,
    date: new Date().toISOString(),
  }, null, 2)
  prevoir()
}

element('copier').addEventListener('click', async () => {
  const texte = element<HTMLTextAreaElement>('export').value
  try {
    await navigator.clipboard.writeText(texte)
    element('copier').textContent = 'Copié ✓'
  } catch {
    element<HTMLTextAreaElement>('export').select()
  }
})
