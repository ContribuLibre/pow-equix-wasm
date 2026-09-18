/**
 * pow-equix-wasm : preuve de travail Equi-X pour le web.
 *
 * Un seul module WebAssembly résout (navigateur, Web Workers) et vérifie
 * (serveur Bun, Node ou Deno). Ce fichier ne dépend ni du DOM ni d’un
 * bundler : chaque environnement fournit les octets du module comme il peut
 * (`fetch` de `pow-equix-wasm/equix.wasm`, lecture de fichier, ou
 * `pow-equix-wasm/octets` qui les intègre en base64).
 *
 * Protocole : le défi d’un essai est `graine ‖ compteur` (u32 petit-boutiste).
 * Une preuve réunit `nombre` parts de 20 octets, `compteur ‖ solution Equi-X`,
 * aux compteurs strictement croissants ; chaque solution doit passer la règle
 * d’effort de Tor (`hs_pow`). Voir README.md.
 */

export const VERSION_FORMAT = 1
export const GRAINE_MAX = 256
export const TAILLE_SOLUTION = 16
export const TAILLE_PART = 4 + TAILLE_SOLUTION
export const PARTS_MAX = 64
/** Au-delà, l’effort n’a plus de sens : une chance sur 2³² par solution. */
export const EFFORT_MAX = 2 ** 32 - 1

interface ExportsEquix {
  memory: WebAssembly.Memory
  tampon_adresse(): number
  tampon_taille(): number
  graine_max(): number
  version_format(): number
  verifier(longueurGraine: number, effort: number, nombre: number): number
  essayer(longueurGraine: number, effort: number, compteur: number): number
}

function exportsValides(exports: WebAssembly.Exports): exports is WebAssembly.Exports & ExportsEquix {
  return exports.memory instanceof WebAssembly.Memory
    && ['tampon_adresse', 'tampon_taille', 'graine_max', 'version_format', 'verifier', 'essayer'].every((nom) => typeof exports[nom] === 'function')
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

/** Un module Equi-X instancié. Une instance n’est pas réentrante : un appel à la fois. */
export class ModuleEquix {
  private constructor(private readonly exports: ExportsEquix) {}

  static async instancier(source: BufferSource | WebAssembly.Module): Promise<ModuleEquix> {
    const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source)
    const instance = await WebAssembly.instantiate(module, {})
    if (!exportsValides(instance.exports)) throw new Error('Module Equi-X invalide.')
    if (instance.exports.version_format() !== VERSION_FORMAT) throw new Error('Module Equi-X d’une autre version du format.')
    if (instance.exports.graine_max() !== GRAINE_MAX) throw new Error('Module Equi-X incompatible avec ce chargeur.')
    return new ModuleEquix(instance.exports)
  }

  /** Mémoire linéaire actuellement réservée par le module, en octets. */
  get memoireOctets(): number {
    return this.exports.memory.buffer.byteLength
  }

  private tampon(): Uint8Array {
    // La mémoire peut grandir entre deux appels : la vue est recréée à chaque fois.
    return new Uint8Array(this.exports.memory.buffer, this.exports.tampon_adresse(), this.exports.tampon_taille())
  }

  /** Vérifie une preuve complète ; quelques centaines de microsecondes par part. */
  verifier(graine: Uint8Array, parts: Uint8Array, effort: number, nombre: number): boolean {
    if (!graineValide(graine) || !nombreValide(nombre) || !effortValide(effort) || parts.length !== nombre * TAILLE_PART) return false
    const tampon = this.tampon()
    tampon.set(graine, 0)
    tampon.set(parts, GRAINE_MAX)
    return this.exports.verifier(graine.length, effort >>> 0, nombre) === 1
  }

  /** Un essai de résolution : la solution retenue pour ce compteur, ou null. */
  essayer(graine: Uint8Array, compteur: number, effort: number): Uint8Array | null {
    if (!graineValide(graine) || !effortValide(effort)) throw new Error('Graine ou effort invalide.')
    this.tampon().set(graine, 0)
    if (this.exports.essayer(graine.length, effort >>> 0, compteur >>> 0) !== 1) return null
    return this.tampon().slice(GRAINE_MAX, GRAINE_MAX + TAILLE_SOLUTION)
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
 * pour l’effort 1, 0,623 pour 2, 0,119 pour 16.
 */
export function probabiliteEssai(effort: number): number {
  return 0.99 * (1 - Math.exp(-2 / Math.max(1, effort)))
}

/** Nombre moyen d’essais pour une preuve de `nombre` parts. */
export function essaisAttendus(effort: number, nombre: number): number {
  return nombre / probabiliteEssai(effort)
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
  /** Essais cumulés, tous fils confondus. */
  essais: number
  /** Parts trouvées, au plus `nombre`. */
  parts: number
  /** Mémoire WebAssembly cumulée des fils en cours, en octets. */
  memoireOctets: number
}

export interface OptionsResolution {
  /** Octets du module, transmis tels quels aux Web Workers. */
  octets: Uint8Array
  graine: Uint8Array
  effort: number
  nombre: number
  onProgression?: (progression: Progression) => void
  signal?: AbortSignal
  /**
   * Nombre de Web Workers ; par défaut un par cœur annoncé, huit au plus, et
   * jamais plus que d’essais attendus : un fil sans essai à mener ne ferait que
   * disputer le processeur aux autres. 0 force le calcul sur le fil courant.
   */
  fils?: number
  /** Fabrique de Web Worker, remplaçable (tests, politique de sécurité particulière). */
  creerTravailleur?: () => Worker
}

export interface Resolution {
  parts: Uint8Array
  essais: number
  /** Nombre de fils effectivement utilisés ; 0 pour le fil courant. */
  fils: number
  /** Mémoire WebAssembly maximale cumulée de tous les fils, en octets. */
  memoireOctets: number
}

/**
 * Corps du Web Worker. Il est sérialisé tel quel en Blob : il ne doit référencer
 * aucun identifiant extérieur, pour survivre à la minification et fonctionner
 * aussi depuis une page ouverte en file://.
 */
function corpsTravailleur(): void {
  const portee = self as unknown as { onmessage: ((evenement: MessageEvent) => void) | null; postMessage(message: unknown): void }
  portee.onmessage = async (evenement: MessageEvent) => {
    const { octets, graine, effort, debut, pas, graineMax } = evenement.data as { octets: ArrayBuffer; graine: Uint8Array; effort: number; debut: number; pas: number; graineMax: number }
    try {
      const { instance } = await WebAssembly.instantiate(octets, {})
      const exports = instance.exports as unknown as { memory: WebAssembly.Memory; tampon_adresse(): number; essayer(longueur: number, effort: number, compteur: number): number }
      for (let compteur = debut; compteur <= 0xffff_ffff; compteur += pas) {
        new Uint8Array(exports.memory.buffer, exports.tampon_adresse(), graine.length).set(graine)
        const trouve = exports.essayer(graine.length, effort, compteur) === 1
        const solution = trouve ? new Uint8Array(exports.memory.buffer, exports.tampon_adresse() + graineMax, 16).slice() : null
        portee.postMessage({ type: 'essai', compteur, solution, memoire: exports.memory.buffer.byteLength })
      }
      portee.postMessage({ type: 'erreur', message: 'Compteurs épuisés.' })
    } catch (erreur) {
      portee.postMessage({ type: 'erreur', message: erreur instanceof Error ? erreur.message : String(erreur) })
    }
  }
}

let urlTravailleur: string | undefined

function travailleurParDefaut(): Worker {
  urlTravailleur ??= URL.createObjectURL(new Blob([`(${corpsTravailleur.toString()})()`], { type: 'text/javascript' }))
  return new Worker(urlTravailleur)
}

function erreurAnnulation(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Calcul annulé.', 'AbortError')
}

/** Nombre de fils par défaut : un par cœur annoncé, huit au plus. */
export function filsParDefaut(): number {
  const coeurs = typeof navigator !== 'undefined' && Number.isInteger(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 1
  return Math.max(1, Math.min(8, coeurs))
}

function assembler(trouvees: Map<number, Uint8Array>, nombre: number): Uint8Array {
  const parts = new Uint8Array(nombre * TAILLE_PART)
  const vue = new DataView(parts.buffer)
  const compteurs = [...trouvees.keys()].sort((gauche, droite) => gauche - droite).slice(0, nombre)
  compteurs.forEach((compteur, index) => {
    vue.setUint32(index * TAILLE_PART, compteur, true)
    parts.set(trouvees.get(compteur)!, index * TAILLE_PART + 4)
  })
  return parts
}

class ErreurTravailleur extends Error {}

/**
 * Résout une preuve dans des Web Workers, un compteur sur `fils` chacun. Sans
 * Web Worker disponible ou autorisé, le calcul se fait sur le fil courant,
 * essai par essai, en rendant la main entre deux essais.
 */
export async function resoudre(options: OptionsResolution): Promise<Resolution> {
  const { graine, effort, nombre, signal } = options
  if (!graineValide(graine) || !effortValide(effort) || !nombreValide(nombre)) throw new Error('Paramètres de preuve invalides.')
  signal?.throwIfAborted()
  const fils = options.fils === undefined ? Math.min(filsParDefaut(), Math.ceil(essaisAttendus(effort, nombre))) : Math.max(0, Math.floor(options.fils))
  const disponible = typeof Worker === 'function' && typeof Blob === 'function' && typeof URL.createObjectURL === 'function'
  const creer = options.creerTravailleur ?? (disponible ? travailleurParDefaut : undefined)
  if (fils > 0 && creer) {
    try {
      return await resoudreEnParallele(options, creer, fils)
    } catch (erreur) {
      if (signal?.aborted || !(erreur instanceof ErreurTravailleur)) throw erreur
      // Un navigateur peut refuser les Web Workers (file://, politique de sécurité) : repli local.
    }
  }
  return resoudreSurCeFil(options)
}

async function resoudreSurCeFil(options: OptionsResolution): Promise<Resolution> {
  const { graine, effort, nombre, signal, onProgression } = options
  const module = await ModuleEquix.instancier(options.octets)
  const trouvees = new Map<number, Uint8Array>()
  let essais = 0
  for (let compteur = 0; trouvees.size < nombre; compteur++) {
    signal?.throwIfAborted()
    const solution = module.essayer(graine, compteur, effort)
    essais++
    if (solution) trouvees.set(compteur, solution)
    onProgression?.({ essais, parts: trouvees.size, memoireOctets: module.memoireOctets })
    if (trouvees.size < nombre) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  signal?.throwIfAborted()
  return { parts: assembler(trouvees, nombre), essais, fils: 0, memoireOctets: module.memoireOctets }
}

function resoudreEnParallele(options: OptionsResolution, creer: () => Worker, fils: number): Promise<Resolution> {
  const { graine, effort, nombre, signal, onProgression } = options
  return new Promise<Resolution>((resolve, reject) => {
    const travailleurs: Worker[] = []
    const memoires = new Map<number, number>()
    const trouvees = new Map<number, Uint8Array>()
    let essais = 0
    let memoireMax = 0
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
        const travailleur = creer()
        travailleurs.push(travailleur)
        travailleur.onerror = (evenement) => {
          evenement.preventDefault?.()
          echouer(evenement.message || 'Web Worker Equi-X indisponible.')
        }
        travailleur.onmessage = (evenement: MessageEvent) => {
          if (fini) return
          const message = evenement.data as { type: string; compteur?: number; solution?: Uint8Array | null; memoire?: number; message?: string }
          if (message.type === 'erreur') return echouer(message.message ?? 'Erreur du Web Worker Equi-X.')
          essais++
          if (message.memoire) memoires.set(index, message.memoire)
          const memoire = [...memoires.values()].reduce((somme, valeur) => somme + valeur, 0)
          memoireMax = Math.max(memoireMax, memoire)
          if (message.solution && message.compteur !== undefined) trouvees.set(message.compteur, message.solution)
          onProgression?.({ essais, parts: Math.min(trouvees.size, nombre), memoireOctets: memoire })
          if (trouvees.size >= nombre) {
            terminer()
            resolve({ parts: assembler(trouvees, nombre), essais, fils, memoireOctets: memoireMax })
          }
        }
        travailleur.postMessage({ octets: options.octets.slice().buffer, graine, effort, debut: index, pas: fils, graineMax: GRAINE_MAX })
      }
    } catch (erreur) {
      echouer(erreur instanceof Error ? erreur.message : String(erreur))
    }
  })
}
