// Page de démo et de calibrage : mesure sur l’appareil le temps et la mémoire
// d’une preuve Equi-X, puis le coût de sa vérification.

import { ModuleEquix, TAILLE_PART, construireGraine, essaisAttendus, filsParDefaut, probabiliteEssai, resoudre } from '../src/index.ts'

interface Mesure { duree: number; essais: number; memoire: number }

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
  return `${nombres.format(ms / 1000)} s`
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

function reglages(): { effort: number; nombre: number; fils: number; repetitions: number; verifications: number } {
  const valeur = (nom: string): number => Number((formulaire.elements.namedItem(nom) as HTMLInputElement).value)
  return { effort: valeur('effort'), nombre: valeur('nombre'), fils: valeur('fils'), repetitions: valeur('repetitions'), verifications: valeur('verifications') }
}

const navigateur = navigator as Navigator & { deviceMemory?: number }
const appareil = {
  navigateur: navigator.userAgent,
  coeurs: navigator.hardwareConcurrency ?? null,
  memoireAppareilGo: navigateur.deviceMemory ?? null,
  webAssembly: typeof WebAssembly === 'object',
}
remplir(element('appareil'), [
  ['Cœurs annoncés', String(appareil.coeurs ?? 'inconnu')],
  ['Mémoire de l’appareil', appareil.memoireAppareilGo ? `≥ ${appareil.memoireAppareilGo} Go` : 'non communiquée'],
  ['WebAssembly', appareil.webAssembly ? 'disponible' : 'indisponible'],
  ['Navigateur', appareil.navigateur],
])
element('alerte-wasm').hidden = appareil.webAssembly
;(formulaire.elements.namedItem('fils') as HTMLInputElement).value = String(filsParDefaut())

let tempsParEssai: number | undefined

function estimer(): void {
  const { effort, nombre, fils } = reglages()
  if (!(effort >= 1 && nombre >= 1)) return
  const essais = essaisAttendus(effort, nombre)
  const texte = [`Chaque essai aboutit avec une probabilité de ${nombres.format(probabiliteEssai(effort) * 100)} % : ${nombres.format(essais)} essais en moyenne par preuve.`]
  // Les fils ne travaillent ensemble qu’autant qu’il reste d’essais à mener.
  if (tempsParEssai) texte.push(`D’après la dernière mesure, environ ${duree(essais * tempsParEssai / Math.min(Math.max(1, fils), essais))} avec ${Math.max(1, fils)} fil(s).`)
  element('estimation').textContent = texte.join(' ')
}
formulaire.addEventListener('input', estimer)
estimer()

const moduleEquix = fetch('./equix.wasm').then(async (reponse) => {
  if (!reponse.ok) throw new Error(`Module indisponible (${reponse.status})`)
  return new Uint8Array(await reponse.arrayBuffer())
})

let calcul: AbortController | undefined
annuler.addEventListener('click', () => calcul?.abort())

formulaire.addEventListener('submit', async (evenement) => {
  evenement.preventDefault()
  const choix = reglages()
  calcul = new AbortController()
  lancer.disabled = true
  annuler.hidden = false
  element('bloc-progression').hidden = false
  element('bloc-resultats').hidden = true
  const etat = element('etat')
  const barre = element<HTMLProgressElement>('barre')
  const mesures: Mesure[] = []
  try {
    const octets = await moduleEquix
    let derniere: { parts: Uint8Array; graine: Uint8Array } | undefined
    for (let repetition = 1; repetition <= choix.repetitions; repetition++) {
      // Une graine différente à chaque répétition : chaque preuve est indépendante.
      const graine = await construireGraine('pow-equix-wasm/demo', `${Date.now()}-${repetition}-${Math.random()}`)
      etat.textContent = `Preuve ${repetition} sur ${choix.repetitions}…`
      barre.max = choix.nombre
      barre.value = 0
      const debut = performance.now()
      let memoire = 0
      const resultat = await resoudre({
        octets, graine, effort: choix.effort, nombre: choix.nombre, fils: choix.fils, signal: calcul.signal,
        onProgression: ({ essais, parts, memoireOctets }) => {
          memoire = Math.max(memoire, memoireOctets)
          barre.value = parts
          remplir(element('direct'), [
            ['Parts trouvées', `${parts} / ${choix.nombre}`],
            ['Essais', String(essais)],
            ['Temps écoulé', duree(performance.now() - debut)],
            ['Mémoire WebAssembly', taille(memoireOctets)],
          ])
        },
      })
      mesures.push({ duree: performance.now() - debut, essais: resultat.essais, memoire: Math.max(memoire, resultat.memoireOctets) })
      derniere = { parts: resultat.parts, graine }
    }
    etat.textContent = 'Mesure de la vérification…'
    const verificateur = await ModuleEquix.instancier(octets)
    const memoireAvant = verificateur.memoireOctets
    const debutVerification = performance.now()
    for (let index = 0; index < choix.verifications; index++) {
      if (!verificateur.verifier(derniere!.graine, derniere!.parts, choix.effort, choix.nombre)) throw new Error('Une preuve calculée n’a pas été vérifiée : module ou chargeur incohérent.')
    }
    const parVerification = (performance.now() - debutVerification) / choix.verifications
    afficher(choix, mesures, { parVerification, memoireAvant, memoireApres: verificateur.memoireOctets, taillePreuve: derniere!.parts.length })
    etat.textContent = 'Terminé.'
  } catch (erreur) {
    etat.textContent = calcul.signal.aborted ? 'Calcul annulé.' : `Erreur : ${erreur instanceof Error ? erreur.message : String(erreur)}`
    if (mesures.length) afficher(choix, mesures)
  } finally {
    lancer.disabled = false
    annuler.hidden = true
    lancer.focus()
  }
})

function afficher(
  choix: ReturnType<typeof reglages>,
  mesures: Mesure[],
  verification?: { parVerification: number; memoireAvant: number; memoireApres: number; taillePreuve: number },
): void {
  const durees = mesures.map((mesure) => mesure.duree)
  const essais = mesures.reduce((somme, mesure) => somme + mesure.essais, 0)
  const tempsTotal = durees.reduce((somme, valeur) => somme + valeur, 0)
  // Parallélisme effectif : un fil ne compte que s’il reste un essai à mener. Avec plus
  // de fils que d’essais par preuve, les fils en trop sont arrêtés en plein essai.
  const parallelisme = Math.min(Math.max(1, choix.fils), essais / mesures.length)
  tempsParEssai = tempsTotal * parallelisme / essais
  const memoireMax = Math.max(...mesures.map((mesure) => mesure.memoire))
  remplir(element('synthese'), [
    ['Durée médiane', duree(centile(durees, 0.5))],
    ['90ᵉ centile', duree(centile(durees, 0.9))],
    ['Moyenne', duree(tempsTotal / mesures.length)],
    ['Min – max', `${duree(Math.min(...durees))} – ${duree(Math.max(...durees))}`],
    ['Essais par preuve', `${nombres.format(essais / mesures.length)} mesurés, ${nombres.format(essaisAttendus(choix.effort, choix.nombre))} attendus`],
    ['Durée d’un essai (un fil)', duree(tempsParEssai)],
    ['Mémoire WebAssembly', `${taille(memoireMax)} au total${choix.fils > 0 ? `, ${taille(memoireMax / choix.fils)} par fil` : ''}`],
  ])
  element('lignes').replaceChildren(...mesures.map((mesure, index) => {
    const ligne = document.createElement('tr')
    for (const texte of [String(index + 1), duree(mesure.duree), String(mesure.essais), nombres.format(mesure.essais / (mesure.duree / 1000)), taille(mesure.memoire)]) {
      const cellule = document.createElement('td')
      cellule.textContent = texte
      ligne.append(cellule)
    }
    return ligne
  }))
  remplir(element('verification'), verification ? [
    ['Par vérification', duree(verification.parVerification)],
    ['Par part', duree(verification.parVerification / choix.nombre)],
    ['Taille de la preuve', `${verification.taillePreuve} octets (${choix.nombre} × ${TAILLE_PART})`],
    ['Mémoire WebAssembly du module', `${taille(verification.memoireApres)} (${taille(verification.memoireAvant)} au chargement)`],
  ] : [['Vérification', 'non mesurée : calcul interrompu']])
  element<HTMLTextAreaElement>('export').value = JSON.stringify({
    appareil,
    reglages: choix,
    preuves: mesures.map((mesure) => ({ dureeMs: Math.round(mesure.duree), essais: mesure.essais, memoireOctets: mesure.memoire })),
    synthese: { medianeMs: Math.round(centile(durees, 0.5)), p90Ms: Math.round(centile(durees, 0.9)), tempsParEssaiMs: Number(tempsParEssai.toFixed(2)), memoireMaxOctets: memoireMax },
    verification: verification ? { parVerificationMs: Number(verification.parVerification.toFixed(4)), memoireOctets: verification.memoireApres } : null,
    date: new Date().toISOString(),
  }, null, 2)
  element('bloc-resultats').hidden = false
  estimer()
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
