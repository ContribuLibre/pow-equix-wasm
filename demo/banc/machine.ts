// Fiche machine produite par scripts/config-machine/ (Linux, macOS, Windows,
// Android/Termux) : même schéma partout, pour comparer les appareils.

export const FORMAT_MACHINE = 'pow-equix-wasm/config-machine'

export interface ConfigMachine {
  format: typeof FORMAT_MACHINE
  version: 1
  source: 'linux' | 'macos' | 'windows' | 'android-termux'
  date: string
  machine: { fabricant: string; modele: string }
  processeur: {
    modele: string
    /** Fréquence maximale annoncée par le système, en MHz (sans turbo si `turbo` vaut false), ou null. */
    frequenceMaxMHz: number | null
    /** Turbo actif, désactivé, ou inconnu. */
    turbo: boolean | null
    coeursPhysiques: number | null
    coeursLogiques: number | null
    architecture: string
  }
  memoire: { totaleOctets: number | null }
  gpu: string[]
  systeme: { nom: string; noyau: string }
}

const texte = (valeur: unknown): valeur is string => typeof valeur === 'string'
const nombreOuNull = (valeur: unknown): boolean => valeur === null || (typeof valeur === 'number' && Number.isFinite(valeur) && valeur >= 0)

/** Valide une fiche collée ou importée ; message en français sinon. */
export function validerConfigMachine(texteJson: string): { machine: ConfigMachine } | { erreur: string } {
  let valeur: unknown
  try {
    valeur = JSON.parse(texteJson)
  } catch {
    return { erreur: 'ce n’est pas du JSON valide' }
  }
  const f = valeur as Record<string, any>
  if (typeof f !== 'object' || f === null || f.format !== FORMAT_MACHINE || f.version !== 1) return { erreur: `format ${FORMAT_MACHINE} version 1 attendu` }
  if (!['linux', 'macos', 'windows', 'android-termux'].includes(f.source)) return { erreur: '« source » inconnue' }
  const p = f.processeur ?? {}
  const valide = texte(f.date) && texte(f.machine?.fabricant) && texte(f.machine?.modele) && texte(p.modele) && nombreOuNull(p.frequenceMaxMHz)
    && (p.turbo === null || p.turbo === undefined || typeof p.turbo === 'boolean') && nombreOuNull(p.coeursPhysiques) && nombreOuNull(p.coeursLogiques)
    && texte(p.architecture) && nombreOuNull(f.memoire?.totaleOctets) && Array.isArray(f.gpu) && f.gpu.every(texte) && texte(f.systeme?.nom) && texte(f.systeme?.noyau)
  if (!valide) return { erreur: 'champs manquants ou mal formés (machine, processeur, memoire, gpu, systeme)' }
  return { machine: { ...(f as ConfigMachine), processeur: { ...p, turbo: p.turbo ?? null } } }
}

/** Fabricant et modèle, sans répéter le fabricant quand le modèle le contient déjà. */
export function nomMachine(machine: ConfigMachine): string {
  const { fabricant, modele } = machine.machine
  if (!fabricant) return modele
  return modele.toLowerCase().startsWith(fabricant.toLowerCase()) ? modele : `${fabricant} ${modele}`.trim()
}

/** Résumé d’une ligne : « modèle {processeur, RAM, GPU} », comme les lignes du tableau du README. */
export function resumeMachine(machine: ConfigMachine): string {
  const ram = machine.memoire.totaleOctets ? `${Math.round(machine.memoire.totaleOctets / 1024 ** 3)} Gio` : null
  const frequence = machine.processeur.frequenceMaxMHz ? `${(machine.processeur.frequenceMaxMHz / 1000).toFixed(1).replace('.', ',')} GHz${machine.processeur.turbo === false ? ' sans turbo' : ''}` : null
  const coeurs = machine.processeur.coeursLogiques ? `${machine.processeur.coeursPhysiques ?? '?'}/${machine.processeur.coeursLogiques} cœurs` : null
  const processeur = [machine.processeur.modele, [frequence, coeurs].filter(Boolean).join(', ')].filter(Boolean).join(' ')
  const nom = nomMachine(machine)
  return `${nom || machine.systeme.nom} {${[processeur, ram, machine.gpu.join(' + ')].filter(Boolean).join(', ')}}`
}
