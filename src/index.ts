/**
 * pow-equix-wasm : preuve de travail Equi-X pour le web.
 *
 * Un seul module résout (navigateur, Web Workers) et vérifie (serveur Bun,
 * Node ou Deno). Il existe en deux moteurs aux résultats identiques :
 *
 * - `wasm` : `equix.wasm`, à fournir en octets (`fetch` de
 *   `pow-equix-wasm/equix.wasm`, lecture de fichier, ou `pow-equix-wasm/octets`
 *   qui l’intègre en base64) ;
 * - `js` : le même module traduit en JavaScript pur par wasm2js
 *   (`pow-equix-wasm/js`), pour les navigateurs où WebAssembly est désactivé.
 *   Environ 4 à 9 fois plus lent avec JIT, et près de 200 fois sans JIT.
 *
 * Ce fichier ne dépend ni du DOM ni d’un bundler.
 *
 * En moteur WebAssembly, chaque programme HashX est de plus compilé en un petit
 * module WebAssembly (`compilation.ts`), bien plus rapide que l’interprète.
 *
 * Protocole : le défi d’un essai est `graine ‖ compteur` (u32 petit-boutiste).
 * Une preuve réunit `nombre` parts, `compteur ‖ solution`, aux compteurs
 * strictement croissants ; chaque solution doit passer la règle d’effort de Tor
 * (`hs_pow`). Le paramètre `n` règle la mémoire : Equihash(n, 3) sur HashX,
 * n = 60 étant exactement Equi-X (parts de 20 octets, format de la 0.2). Voir README.md.
 */

import { TAILLE_DESCRIPTION, genererModuleHashx } from './compilation.js'

export { genererModuleHashx } from './compilation.js'

/** Version du format : 2 depuis l’ajout de n (les preuves n = 60 de la version 1 restent valides). */
export const VERSION_FORMAT = 2
export const GRAINE_MAX = 256
/** Taille d’une solution et d’une part pour n = 60 (Equi-X) ; voir `tailleSolution` et `taillePart`. */
export const TAILLE_SOLUTION = 16
export const TAILLE_PART = 4 + TAILLE_SOLUTION
export const PARTS_MAX = 64
/** Au-delà, l’effort n’a plus de sens : une chance sur 2³² par solution. */
export const EFFORT_MAX = 2 ** 32 - 1
/** n d’Equi-X, par défaut : ≈ 1,8 Mio de mémoire de travail par fil. */
export const N_EQUIX = 60
/** Valeurs de n acceptées : chaque pas de 4 double la mémoire et le temps d’un essai. */
export const N_VALIDES = [60, 64, 68, 72, 76, 80] as const

export type Moteur = 'wasm' | 'js'
/** `auto` : programmes HashX compilés en WebAssembly quand c’est possible ; `jamais` : interprète seul. */
export type Compilation = 'auto' | 'jamais'

export function nValide(n: number): boolean {
  return (N_VALIDES as readonly number[]).includes(n)
}

/** Octets d’une solution : 8 indices sur 16 bits pour n = 60, sur 32 bits au-delà. */
export function tailleSolution(n: number = N_EQUIX): number {
  return n === N_EQUIX ? 16 : 32
}

/** Octets d’une part : compteur puis solution. */
export function taillePart(n: number = N_EQUIX): number {
  return 4 + tailleSolution(n)
}

/**
 * Mémoire de travail du solveur pour n, en octets, par fil : trois couches de
 * 2^(n/4−7) seaux de 336 places (voir crates/pow-equix/src/solveur.rs).
 * 1,8 Mio pour n = 60, puis environ le double à chaque pas, 63 Mio pour n = 80.
 * Le module lui-même ajoute environ 1 Mio par fil.
 */
export function memoirePourN(n: number = N_EQUIX): number {
  if (!nValide(n)) throw new Error(`n invalide : ${n} (attendu : ${N_VALIDES.join(', ')}).`)
  const bitsSeau = n / 4 - 7
  const seaux = 2 ** bitsSeau
  const cases = seaux * 336
  let octets = cases * 22
  if (n > 60) octets += cases // bits hauts des indices
  if (n - bitsSeau > 64) octets += cases // bits hauts des clés (n = 80)
  return octets + 3 * seaux * 2 + 128 * 12 * 2 + 128
}

/** Plus grand n dont la mémoire de travail tient dans `mio` Mio par fil (60 au minimum). */
export function nPourMemoire(mio: number): number {
  let retenu: number = N_EQUIX
  for (const n of N_VALIDES) if (memoirePourN(n) <= mio * 1024 * 1024) retenu = n
  return retenu
}

/** Exports du module, qu’il vienne de equix.wasm ou de sa traduction JavaScript. */
export interface ExportsEquix {
  memory: { buffer: ArrayBuffer }
  tampon_adresse(): number
  tampon_taille(): number
  graine_max(): number
  zone_programme(): number
  version_format(): number
  verifier(longueurGraine: number, effort: number, nombre: number, n: number): number
  essayer(longueurGraine: number, effort: number, compteur: number, n: number): number
  preparer(longueurGraine: number, compteur: number, n: number): number
  remplir(): void
  chercher(effort: number): number
}

/** Fabrique du moteur JavaScript : `creerExportsEquixJs` de `pow-equix-wasm/js`. */
export type CreateurEquixJs = () => ExportsEquix

/**
 * Reconnaît un ArrayBuffer d’un autre contexte JavaScript aussi (iframe, jsdom,
 * worker) : `instanceof` ne compare qu’avec le constructeur du contexte courant.
 */
function estArrayBuffer(valeur: unknown): valeur is ArrayBuffer {
  return Object.prototype.toString.call(valeur) === '[object ArrayBuffer]'
}

function exportsValides(exports: unknown): exports is ExportsEquix {
  const candidat = exports as Record<string, unknown> | null
  return typeof candidat === 'object' && candidat !== null
    && estArrayBuffer((candidat.memory as { buffer?: unknown } | undefined)?.buffer)
    && ['tampon_adresse', 'tampon_taille', 'graine_max', 'zone_programme', 'version_format', 'verifier', 'essayer', 'preparer', 'remplir', 'chercher'].every((nom) => typeof candidat[nom] === 'function')
}

function controler(exports: unknown): ExportsEquix {
  if (!exportsValides(exports)) throw new Error('Module Equi-X invalide.')
  if (exports.version_format() !== VERSION_FORMAT) throw new Error('Module Equi-X d’une autre version du format.')
  if (exports.graine_max() !== GRAINE_MAX) throw new Error('Module Equi-X incompatible avec ce chargeur.')
  return exports
}

export function effortValide(effort: number): boolean {
  return Number.isInteger(effort) && effort >= 1 && effort <= EFFORT_MAX
}

export function nombreValide(nombre: number): boolean {
  return Number.isInteger(nombre) && nombre >= 1 && nombre <= PARTS_MAX
}

function graineValide(graine: Uint8Array): boolean {
  return graine.length >= 1 && graine.length <= GRAINE_MAX
}

/**
 * WebAssembly est-il utilisable ici ? Faux quand le navigateur l’a désactivé
 * (Tor Browser en mode renforcé, mode Isolement d’iOS, politique d’entreprise…),
 * ce qui s’accompagne en général d’un JavaScript sans JIT, donc très lent.
 */
export function webAssemblyDisponible(): boolean {
  try {
    // Le plus petit module valide : en-tête et version, sans section.
    return typeof WebAssembly === 'object' && new WebAssembly.Module(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])) instanceof WebAssembly.Module
  } catch {
    return false
  }
}

/**
 * Éléments remplis par appel au module compilé. Des appels courts laissent au
 * moteur WebAssembly le temps de remplacer le code de base par sa version
 * optimisée entre deux appels (V8 ne le fait qu’à l’entrée d’une fonction).
 */
export const TRANCHE_REMPLISSAGE = 2048

/** Un module Equi-X instancié. Une instance n’est pas réentrante : un appel à la fois. */
export class ModuleEquix {
  /** Faux dès qu’une compilation a échoué ici : l’interprète prend le relais. */
  private compilationPossible: boolean

  private constructor(private readonly exports: ExportsEquix, readonly moteur: Moteur) {
    this.compilationPossible = moteur === 'wasm' && typeof WebAssembly === 'object' && exports.memory instanceof WebAssembly.Memory
  }

  /** Moteur WebAssembly, depuis les octets de equix.wasm. */
  static async instancier(source: BufferSource | WebAssembly.Module): Promise<ModuleEquix> {
    const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source)
    const instance = await WebAssembly.instantiate(module, {})
    return new ModuleEquix(controler(instance.exports), 'wasm')
  }

  /** Moteur JavaScript, depuis `creerExportsEquixJs` de `pow-equix-wasm/js`. */
  static depuisJs(creer: CreateurEquixJs): ModuleEquix {
    return new ModuleEquix(controler(creer()), 'js')
  }

  /** Mémoire linéaire actuellement réservée par le module, en octets. */
  get memoireOctets(): number {
    return this.exports.memory.buffer.byteLength
  }

  /**
   * Ce module peut-il compiler les programmes HashX en WebAssembly ? Vrai en
   * moteur WebAssembly, tant qu’aucune compilation n’a échoué.
   */
  get compilation(): boolean {
    return this.compilationPossible
  }

  private tampon(): Uint8Array {
    // La mémoire peut grandir entre deux appels : la vue est recréée à chaque fois.
    return new Uint8Array(this.exports.memory.buffer, this.exports.tampon_adresse(), this.exports.tampon_taille())
  }

  /**
   * Vérifie une preuve complète : quelques centaines de microsecondes par part
   * en WebAssembly, quel que soit n (programme HashX et huit évaluations).
   */
  verifier(graine: Uint8Array, parts: Uint8Array, effort: number, nombre: number, n: number = N_EQUIX): boolean {
    if (!graineValide(graine) || !nombreValide(nombre) || !effortValide(effort) || !nValide(n) || parts.length !== nombre * taillePart(n)) return false
    const tampon = this.tampon()
    tampon.set(graine, 0)
    tampon.set(parts, GRAINE_MAX)
    return this.exports.verifier(graine.length, effort >>> 0, nombre, n) === 1
  }

  private solution(n: number): Uint8Array {
    return this.tampon().slice(GRAINE_MAX, GRAINE_MAX + tailleSolution(n))
  }

  private controlerEssai(graine: Uint8Array, effort: number, n: number): void {
    if (!graineValide(graine) || !effortValide(effort) || !nValide(n)) throw new Error('Graine, effort ou n invalide.')
  }

  /** Un essai de résolution, HashX interprété : la solution retenue pour ce compteur, ou null. */
  essayer(graine: Uint8Array, compteur: number, effort: number, n: number = N_EQUIX): Uint8Array | null {
    this.controlerEssai(graine, effort, n)
    this.tampon().set(graine, 0)
    if (this.exports.essayer(graine.length, effort >>> 0, compteur >>> 0, n) !== 1) return null
    return this.solution(n)
  }

  /**
   * Un essai de résolution, programme HashX compilé en WebAssembly quand c’est
   * possible (sinon interprété) : même résultat que `essayer`, bien plus vite.
   */
  async essayerCompile(graine: Uint8Array, compteur: number, effort: number, n: number = N_EQUIX): Promise<Uint8Array | null> {
    if (!this.compilationPossible) return this.essayer(graine, compteur, effort, n)
    this.controlerEssai(graine, effort, n)
    this.tampon().set(graine, 0)
    if (this.exports.preparer(graine.length, compteur >>> 0, n) !== 1) return null
    const zone = this.exports.zone_programme()
    const description = this.tampon().slice(zone, zone + TAILLE_DESCRIPTION)
    try {
      const { instance } = await WebAssembly.instantiate(genererModuleHashx(description), { e: { m: this.exports.memory as WebAssembly.Memory } })
      const remplir = instance.exports.remplir as (debut: number, fin: number) => void
      const elements = new DataView(description.buffer).getUint32(4, true)
      for (let debut = 0; debut < elements; debut += TRANCHE_REMPLISSAGE) remplir(debut, Math.min(elements, debut + TRANCHE_REMPLISSAGE))
    } catch {
      // Compilation refusée ou impossible ici : l’interprète termine l’essai, et les suivants.
      this.compilationPossible = false
      this.exports.remplir()
    }
    return this.exports.chercher(effort >>> 0) === 1 ? this.solution(n) : null
  }
}

/**
 * Graine conseillée : le domaine (UTF-8), un octet nul, puis l’empreinte SHA-256
 * du contenu à protéger. Le domaine sépare les protocoles : une preuve calculée
 * pour l’un ne vaut rien pour l’autre.
 */
export async function construireGraine(domaine: string, contenu: string | Uint8Array): Promise<Uint8Array> {
  const encodeur = new TextEncoder()
  const prefixe = encodeur.encode(domaine)
  // Copie dans un ArrayBuffer ordinaire : WebCrypto refuse un SharedArrayBuffer.
  const octets = typeof contenu === 'string' ? encodeur.encode(contenu) : new Uint8Array(contenu)
  const empreinte = new Uint8Array(await crypto.subtle.digest('SHA-256', octets))
  const graine = new Uint8Array(prefixe.length + 1 + empreinte.length)
  graine.set(prefixe, 0)
  graine.set(empreinte, prefixe.length + 1)
  if (!graineValide(graine)) throw new Error(`Domaine trop long : la graine ne doit pas dépasser ${GRAINE_MAX} octets.`)
  return graine
}

/**
 * Probabilité qu’un essai aboutisse. Equi-X donne en moyenne deux solutions par
 * défi, chacune retenue avec une chance sur `effort` : 1 − e^(−2/effort),
 * légèrement réduit par les défis sans programme HashX valide. Mesuré : 0,858
 * pour l’effort 1, 0,623 pour 2, 0,119 pour 16. Elle ne dépend pas de n : chaque
 * n garde deux solutions par défi en moyenne (voir README).
 */
export function probabiliteEssai(effort: number): number {
  return 0.99 * (1 - Math.exp(-2 / Math.max(1, effort)))
}

/** Nombre moyen d’essais pour une preuve de `nombre` parts. */
export function essaisAttendus(effort: number, nombre: number): number {
  return nombre / probabiliteEssai(effort)
}

/**
 * Durée d’un essai pour n = 60 sur un cœur, mesurée sur un portable x86-64
 * récent. Ordres de grandeur pour décider avant de calculer ; pendant le
 * calcul, la progression donne une estimation mesurée sur l’appareil lui-même.
 */
export const REFERENCE_MS_PAR_ESSAI = {
  /** WebAssembly, programmes HashX compilés en WebAssembly (par défaut) : 35 ms dans Chromium, 50 ms sous Bun. */
  wasmCompile: 35,
  /** WebAssembly, programmes HashX interprétés : Chromium comme Bun ou Node. */
  wasm: 430,
  /** JavaScript traduit, avec JIT : 3,8 s dans Chromium (1,5 s sous Node ou Bun). */
  js: 3_800,
  /** JavaScript traduit, sans JIT (Node --jitless) : le cas courant quand WebAssembly est désactivé. */
  jsSansJit: 76_000,
} as const

export type Execution = keyof typeof REFERENCE_MS_PAR_ESSAI

/**
 * Durée d’un essai selon n, rapportée à n = 60 (mesurée en WebAssembly) : un
 * pas de 4 double la liste à calculer et à trier, un peu plus que le double à
 * cause des accès mémoire.
 */
export const FACTEUR_DUREE_N: Readonly<Record<(typeof N_VALIDES)[number], number>> = { 60: 1, 64: 2, 68: 4.4, 72: 8, 76: 16, 80: 36 }

/** Durée de référence d’un essai pour cette exécution et ce n. */
export function msParEssai(execution: Execution, n: number = N_EQUIX): number {
  if (!nValide(n)) throw new Error(`n invalide : ${n}.`)
  return REFERENCE_MS_PAR_ESSAI[execution] * FACTEUR_DUREE_N[n as (typeof N_VALIDES)[number]]
}

/** Nombre de fils par défaut : un par cœur annoncé, huit au plus. */
export function filsParDefaut(): number {
  const coeurs = typeof navigator !== 'undefined' && Number.isInteger(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 1
  return Math.max(1, Math.min(8, coeurs))
}

/** Fils utilisés par défaut : pas plus que d’essais attendus, un fil de trop ne ferait que disputer le processeur. */
export function filsConseilles(effort: number, nombre: number): number {
  return Math.min(filsParDefaut(), Math.ceil(essaisAttendus(effort, nombre)))
}

/**
 * Durée probable d’une preuve, en millisecondes, d’après les mesures de référence :
 * de quoi prévenir d’une longue attente avant même de commencer.
 */
export function estimerDuree(options: { effort: number; nombre: number; execution: Execution; fils?: number; n?: number }): number {
  const essais = essaisAttendus(options.effort, options.nombre)
  const fils = Math.max(1, Math.min(options.fils ?? filsConseilles(options.effort, options.nombre), essais))
  return essais * msParEssai(options.execution, options.n) / fils
}

/**
 * Combien de fois cette exécution est plus lente qu’une autre (par défaut, le
 * moteur WebAssembly qui interprète HashX, comme en 0.2).
 */
export function ralentissement(execution: Execution, reference: Execution = 'wasm'): number {
  return REFERENCE_MS_PAR_ESSAI[execution] / REFERENCE_MS_PAR_ESSAI[reference]
}

export function hexadecimal(octets: Uint8Array): string {
  return Array.from(octets, (octet) => octet.toString(16).padStart(2, '0')).join('')
}

export function depuisHexadecimal(texte: string): Uint8Array | null {
  if (texte.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(texte)) return null
  const octets = new Uint8Array(texte.length / 2)
  for (let index = 0; index < octets.length; index++) octets[index] = Number.parseInt(texte.slice(index * 2, index * 2 + 2), 16)
  return octets
}

export interface Progression {
  /** Moteur en cours d’usage. */
  moteur: Moteur
  /** Programmes HashX compilés en WebAssembly (sinon interprétés). */
  compilation: boolean
  /** Paramètre de mémoire de la preuve. */
  n: number
  /** Essais cumulés, tous fils confondus. */
  essais: number
  /** Parts trouvées, au plus `nombre`. */
  parts: number
  /** Temps écoulé depuis le début du calcul, en millisecondes. */
  dureeMs: number
  /** Temps restant estimé d’après le rythme mesuré, ou null tant qu’aucun essai n’est fini. */
  restantEstimeMs: number | null
  /** Mémoire réelle des modules cumulée sur les fils en cours, en octets. */
  memoireOctets: number
}

export interface OptionsResolution {
  graine: Uint8Array
  effort: number
  nombre: number
  /**
   * Paramètre de mémoire, 60 par défaut (Equi-X, ≈ 1,8 Mio par fil) : voir
   * `N_VALIDES`, `memoirePourN` et `nPourMemoire`. Le vérificateur doit employer le même.
   */
  n?: number
  /** Octets de equix.wasm, pour le moteur WebAssembly. */
  octets?: Uint8Array
  /** `creerExportsEquixJs` de `pow-equix-wasm/js`, pour le moteur JavaScript. */
  js?: CreateurEquixJs
  /**
   * `auto` (par défaut) : WebAssembly s’il est disponible et fourni, sinon
   * JavaScript s’il est fourni. `wasm` ou `js` imposent le moteur.
   */
  moteur?: Moteur | 'auto'
  /**
   * `auto` (par défaut) : en moteur WebAssembly, chaque programme HashX est
   * compilé en WebAssembly, plusieurs fois plus vite que l’interprète ; en cas
   * d’échec, l’interprète prend le relais. `jamais` : interprète seul.
   */
  compilation?: Compilation
  onProgression?: (progression: Progression) => void
  signal?: AbortSignal
  /**
   * Nombre de Web Workers ; par défaut `filsConseilles` : un par cœur annoncé,
   * huit au plus, jamais plus que d’essais attendus. 0 : fil courant.
   */
  fils?: number
  /** Fabrique de Web Worker, remplaçable (tests, politique de sécurité particulière). */
  creerTravailleur?: (moteur: Moteur, js?: CreateurEquixJs) => Worker
}

export interface Resolution {
  parts: Uint8Array
  essais: number
  /** Moteur utilisé : `js` signale un mode dégradé. */
  moteur: Moteur
  /** Programmes HashX compilés en WebAssembly pendant tout le calcul. */
  compilation: boolean
  n: number
  /** Nombre de fils effectivement utilisés ; 0 pour le fil courant. */
  fils: number
  dureeMs: number
  /** Mémoire maximale des modules cumulée sur tous les fils, en octets. */
  memoireOctets: number
}

/** Moteur que `resoudre` retiendra avec ces options, ou null s’il n’en a aucun. */
export function moteurRetenu(options: Pick<OptionsResolution, 'octets' | 'js' | 'moteur'>): Moteur | null {
  const choix = options.moteur ?? 'auto'
  const wasm = Boolean(options.octets) && webAssemblyDisponible()
  if (choix === 'wasm') return wasm ? 'wasm' : null
  if (choix === 'js') return options.js ? 'js' : null
  return wasm ? 'wasm' : options.js ? 'js' : null
}

/** Exécution prévue avec ces options : de quoi estimer la durée avant de calculer. */
export function executionPrevue(options: Pick<OptionsResolution, 'octets' | 'js' | 'moteur' | 'compilation'>): Execution | null {
  const moteur = moteurRetenu(options)
  if (moteur === 'wasm') return options.compilation === 'jamais' ? 'wasm' : 'wasmCompile'
  // Sans WebAssembly, le JIT est en général coupé aussi : c’est l’hypothèse prudente.
  return moteur === 'js' ? (webAssemblyDisponible() ? 'js' : 'jsSansJit') : null
}

/**
 * Corps du Web Worker. Il est sérialisé tel quel en Blob : il ne doit référencer
 * aucun identifiant extérieur, pour survivre à la minification et fonctionner
 * aussi depuis une page ouverte en file://. Le Blob commence par la source de
 * `genererModuleHashx` (compilation des programmes HashX) et, en moteur
 * JavaScript, par celle de `creerExportsEquixJs`, rangées dans `self`.
 */
function corpsTravailleur(): void {
  interface ExportsTravailleur {
    memory: { buffer: ArrayBuffer }
    tampon_adresse(): number
    tampon_taille(): number
    zone_programme(): number
    essayer(longueur: number, effort: number, compteur: number, n: number): number
    preparer(longueur: number, compteur: number, n: number): number
    remplir(): void
    chercher(effort: number): number
  }
  const portee = self as unknown as {
    onmessage: ((evenement: MessageEvent) => void) | null
    postMessage(message: unknown): void
    creerExportsEquixJs?: () => ExportsTravailleur
    genererModuleHashx?: (description: Uint8Array) => Uint8Array<ArrayBuffer>
  }
  portee.onmessage = async (evenement: MessageEvent) => {
    const { octets, graine, effort, debut, pas, graineMax, n, compiler, tailleDescription, tranche } = evenement.data as {
      octets?: ArrayBuffer; graine: Uint8Array; effort: number; debut: number; pas: number; graineMax: number; n: number; compiler: boolean; tailleDescription: number; tranche: number
    }
    try {
      let exports: ExportsTravailleur
      if (octets) exports = (await WebAssembly.instantiate(octets, {})).instance.exports as unknown as ExportsTravailleur
      else if (portee.creerExportsEquixJs) exports = portee.creerExportsEquixJs()
      else throw new Error('Aucun moteur Equi-X dans ce Web Worker.')
      const tampon = (): Uint8Array => new Uint8Array(exports.memory.buffer, exports.tampon_adresse(), exports.tampon_taille())
      const tailleSolution = n === 60 ? 16 : 32
      let compilation = compiler && Boolean(octets) && typeof portee.genererModuleHashx === 'function' && exports.memory instanceof WebAssembly.Memory
      for (let compteur = debut; compteur <= 0xffff_ffff; compteur += pas) {
        tampon().set(graine)
        let trouve: boolean
        if (!compilation) trouve = exports.essayer(graine.length, effort, compteur, n) === 1
        else if (exports.preparer(graine.length, compteur, n) !== 1) trouve = false
        else {
          const zone = exports.zone_programme()
          const description = tampon().slice(zone, zone + tailleDescription)
          try {
            const { instance } = await WebAssembly.instantiate(portee.genererModuleHashx!(description), { e: { m: exports.memory as WebAssembly.Memory } })
            const remplir = instance.exports.remplir as (debut: number, fin: number) => void
            const elements = new DataView(description.buffer).getUint32(4, true)
            for (let element = 0; element < elements; element += tranche) remplir(element, Math.min(elements, element + tranche))
          } catch {
            compilation = false
            exports.remplir()
          }
          trouve = exports.chercher(effort) === 1
        }
        const solution = trouve ? tampon().slice(graineMax, graineMax + tailleSolution) : null
        portee.postMessage({ type: 'essai', compteur, solution, memoire: exports.memory.buffer.byteLength, compilation })
      }
      portee.postMessage({ type: 'erreur', message: 'Compteurs épuisés.' })
    } catch (erreur) {
      portee.postMessage({ type: 'erreur', message: erreur instanceof Error ? erreur.message : String(erreur) })
    }
  }
}

const urlsTravailleur = new Map<Moteur, string>()

function travailleurParDefaut(moteur: Moteur, js?: CreateurEquixJs): Worker {
  let url = urlsTravailleur.get(moteur)
  if (!url) {
    const moteurJs = moteur === 'js' && js ? `self.creerExportsEquixJs = ${js.toString()};\n` : ''
    const compilateur = moteur === 'wasm' ? `self.genererModuleHashx = ${genererModuleHashx.toString()};\n` : ''
    url = URL.createObjectURL(new Blob([`${moteurJs}${compilateur}(${corpsTravailleur.toString()})()`], { type: 'text/javascript' }))
    urlsTravailleur.set(moteur, url)
  }
  return new Worker(url)
}

function erreurAnnulation(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Calcul annulé.', 'AbortError')
}

function assembler(trouvees: Map<number, Uint8Array>, nombre: number, n: number): Uint8Array {
  const taille = taillePart(n)
  const parts = new Uint8Array(nombre * taille)
  const vue = new DataView(parts.buffer)
  const compteurs = [...trouvees.keys()].sort((gauche, droite) => gauche - droite).slice(0, nombre)
  compteurs.forEach((compteur, index) => {
    vue.setUint32(index * taille, compteur, true)
    parts.set(trouvees.get(compteur)!, index * taille + 4)
  })
  return parts
}

/** Temps restant estimé d’après le rythme mesuré, ou null avant le premier essai. */
function restantEstime(essais: number, parts: number, nombre: number, effort: number, dureeMs: number): number | null {
  if (essais === 0 || parts >= nombre) return essais === 0 ? null : 0
  return (nombre - parts) / probabiliteEssai(effort) * (dureeMs / essais)
}

class ErreurTravailleur extends Error {}

/**
 * Résout une preuve dans des Web Workers, un compteur sur `fils` chacun. Sans
 * Web Worker disponible ou autorisé, le calcul se fait sur le fil courant,
 * essai par essai, en rendant la main entre deux essais.
 */
export async function resoudre(options: OptionsResolution): Promise<Resolution> {
  const { graine, effort, nombre, signal } = options
  const n = options.n ?? N_EQUIX
  if (!graineValide(graine) || !effortValide(effort) || !nombreValide(nombre) || !nValide(n)) throw new Error('Paramètres de preuve invalides.')
  if (options.compilation !== undefined && options.compilation !== 'auto' && options.compilation !== 'jamais') throw new Error('Option de compilation invalide.')
  const moteur = moteurRetenu(options)
  if (!moteur) {
    throw new Error(options.moteur === 'wasm' || (!options.js && options.octets)
      ? 'WebAssembly est indisponible ici et aucun moteur JavaScript n’a été fourni.'
      : 'Aucun moteur Equi-X fourni : il faut les octets de equix.wasm ou creerExportsEquixJs.')
  }
  signal?.throwIfAborted()
  const fils = options.fils === undefined ? filsConseilles(effort, nombre) : Math.max(0, Math.floor(options.fils))
  const disponible = typeof Worker === 'function' && typeof Blob === 'function' && typeof URL.createObjectURL === 'function'
  const creer = options.creerTravailleur ?? (disponible ? travailleurParDefaut : undefined)
  const compiler = moteur === 'wasm' && options.compilation !== 'jamais'
  if (fils > 0 && creer) {
    try {
      return await resoudreEnParallele(options, moteur, creer, fils, n, compiler)
    } catch (erreur) {
      if (signal?.aborted || !(erreur instanceof ErreurTravailleur)) throw erreur
      // Un navigateur peut refuser les Web Workers (file://, politique de sécurité) : repli local.
    }
  }
  return resoudreSurCeFil(options, moteur, n, compiler)
}

async function resoudreSurCeFil(options: OptionsResolution, moteur: Moteur, n: number, compiler: boolean): Promise<Resolution> {
  const { graine, effort, nombre, signal, onProgression } = options
  const module = moteur === 'wasm' ? await ModuleEquix.instancier(options.octets!) : ModuleEquix.depuisJs(options.js!)
  const trouvees = new Map<number, Uint8Array>()
  const debut = performance.now()
  let essais = 0
  let toujoursCompile = compiler && module.compilation
  for (let compteur = 0; trouvees.size < nombre; compteur++) {
    signal?.throwIfAborted()
    const solution = compiler ? await module.essayerCompile(graine, compteur, effort, n) : module.essayer(graine, compteur, effort, n)
    const compilation = compiler && module.compilation
    toujoursCompile &&= compilation
    essais++
    if (solution) trouvees.set(compteur, solution)
    const dureeMs = performance.now() - debut
    onProgression?.({ moteur, compilation, n, essais, parts: trouvees.size, dureeMs, restantEstimeMs: restantEstime(essais, trouvees.size, nombre, effort, dureeMs), memoireOctets: module.memoireOctets })
    if (trouvees.size < nombre) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  signal?.throwIfAborted()
  return { parts: assembler(trouvees, nombre, n), essais, moteur, compilation: toujoursCompile, n, fils: 0, dureeMs: performance.now() - debut, memoireOctets: module.memoireOctets }
}

function resoudreEnParallele(options: OptionsResolution, moteur: Moteur, creer: NonNullable<OptionsResolution['creerTravailleur']>, fils: number, n: number, compiler: boolean): Promise<Resolution> {
  const { graine, effort, nombre, signal, onProgression } = options
  return new Promise<Resolution>((resolve, reject) => {
    const travailleurs: Worker[] = []
    const memoires = new Map<number, number>()
    const trouvees = new Map<number, Uint8Array>()
    const debut = performance.now()
    let essais = 0
    let memoireMax = 0
    let toujoursCompile = compiler
    let fini = false
    const terminer = (): void => {
      fini = true
      for (const travailleur of travailleurs) travailleur.terminate()
      signal?.removeEventListener('abort', annuler)
    }
    const annuler = (): void => {
      if (fini) return
      terminer()
      reject(erreurAnnulation(signal!))
    }
    const echouer = (message: string): void => {
      if (fini) return
      terminer()
      reject(new ErreurTravailleur(message))
    }
    signal?.addEventListener('abort', annuler, { once: true })
    try {
      for (let index = 0; index < fils; index++) {
        const travailleur = creer(moteur, options.js)
        travailleurs.push(travailleur)
        travailleur.onerror = (evenement) => {
          evenement.preventDefault?.()
          echouer(evenement.message || 'Web Worker Equi-X indisponible.')
        }
        travailleur.onmessage = (evenement: MessageEvent) => {
          if (fini) return
          const message = evenement.data as { type: string; compteur?: number; solution?: Uint8Array | null; memoire?: number; compilation?: boolean; message?: string }
          if (message.type === 'erreur') return echouer(message.message ?? 'Erreur du Web Worker Equi-X.')
          essais++
          const compilation = message.compilation === true
          toujoursCompile &&= compilation
          if (message.memoire) memoires.set(index, message.memoire)
          const memoire = [...memoires.values()].reduce((somme, valeur) => somme + valeur, 0)
          memoireMax = Math.max(memoireMax, memoire)
          if (message.solution && message.compteur !== undefined) trouvees.set(message.compteur, message.solution)
          const parts = Math.min(trouvees.size, nombre)
          const dureeMs = performance.now() - debut
          onProgression?.({ moteur, compilation, n, essais, parts, dureeMs, restantEstimeMs: restantEstime(essais, parts, nombre, effort, dureeMs), memoireOctets: memoire })
          if (trouvees.size >= nombre) {
            terminer()
            resolve({ parts: assembler(trouvees, nombre, n), essais, moteur, compilation: toujoursCompile, n, fils, dureeMs, memoireOctets: memoireMax })
          }
        }
        const octets = moteur === 'wasm' ? options.octets!.slice().buffer : undefined
        travailleur.postMessage({ octets, graine, effort, debut: index, pas: fils, graineMax: GRAINE_MAX, n, compiler, tailleDescription: TAILLE_DESCRIPTION, tranche: TRANCHE_REMPLISSAGE })
      }
    } catch (erreur) {
      echouer(erreur instanceof Error ? erreur.message : String(erreur))
    }
  })
}
