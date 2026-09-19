// Banc de mesure commun à Bun et au navigateur : temps d’un essai, interprété
// et compilé, décomposé, pour chaque n ; vérification ; mémoire réelle du module.
// Employé par scripts/mesurer.ts (Bun, et Chromium sans interface).

import { ModuleEquix, encoderPreuve, genererModuleHashx } from '../../src/index.ts'
import { TAILLE_DESCRIPTION } from '../../src/compilation.ts'

export interface LigneMesure {
  n: number
  mode: 'interprete' | 'compile'
  tranche?: number
  essais: number
  msParEssai: number
  /** Détail du mode compilé, en ms par essai. */
  preparationMs?: number
  generationMs?: number
  compilationMs?: number
  remplissageMs?: number
  rechercheMs?: number
  octetsModule?: number
  solutionsParDefi?: number
  verificationMsParPart?: number
  memoireModuleOctets: number
}

interface ExportsBruts {
  memory: WebAssembly.Memory
  tampon_adresse(): number
  tampon_taille(): number
  zone_programme(): number
  preparer(longueur: number, compteur: number, n: number): number
  remplir(): void
  chercher(effort: number): number
}

const graine = new TextEncoder().encode('pow-equix-wasm/mesure\0graine')

/** Essais compilés, décomposés étape par étape, avec les exports bruts du module. */
async function mesurerCompile(octets: Uint8Array, n: number, essais: number, tranche: number): Promise<LigneMesure> {
  const { instance } = await WebAssembly.instantiate(octets.slice(), {})
  const exports = instance.exports as unknown as ExportsBruts
  const tampon = (): Uint8Array => new Uint8Array(exports.memory.buffer, exports.tampon_adresse(), exports.tampon_taille())
  const cumul = { preparation: 0, generation: 0, compilation: 0, remplissage: 0, recherche: 0 }
  let octetsModule = 0
  const debut = performance.now()
  for (let compteur = 0; compteur < essais; compteur++) {
    tampon().set(graine)
    const t0 = performance.now()
    if (exports.preparer(graine.length, compteur, n) !== 1) continue
    const zone = exports.zone_programme()
    const description = tampon().slice(zone, zone + TAILLE_DESCRIPTION)
    const t1 = performance.now()
    const module = genererModuleHashx(description)
    octetsModule = module.length
    const t2 = performance.now()
    const { instance: programme } = await WebAssembly.instantiate(module, { e: { m: exports.memory } })
    const t3 = performance.now()
    const remplir = programme.exports.remplir as (debut: number, fin: number) => void
    const elements = new DataView(description.buffer).getUint32(4, true)
    for (let element = 0; element < elements; element += tranche) remplir(element, Math.min(elements, element + tranche))
    const t4 = performance.now()
    exports.chercher(1)
    const t5 = performance.now()
    cumul.preparation += t1 - t0
    cumul.generation += t2 - t1
    cumul.compilation += t3 - t2
    cumul.remplissage += t4 - t3
    cumul.recherche += t5 - t4
  }
  const total = performance.now() - debut
  return {
    n, mode: 'compile', tranche, essais, msParEssai: total / essais,
    preparationMs: cumul.preparation / essais, generationMs: cumul.generation / essais, compilationMs: cumul.compilation / essais,
    remplissageMs: cumul.remplissage / essais, rechercheMs: cumul.recherche / essais, octetsModule,
    memoireModuleOctets: exports.memory.buffer.byteLength,
  }
}

/** Essais par l’interface publique (`essayer` ou `essayerCompile`), et vérification. */
async function mesurerPublic(octets: Uint8Array, n: number, essais: number, compile: boolean): Promise<LigneMesure> {
  const module = await ModuleEquix.instancier(octets.slice())
  let solutions = 0
  const trouvees: Array<[number, Uint8Array]> = []
  const debut = performance.now()
  for (let compteur = 0; compteur < essais; compteur++) {
    const solution = compile ? await module.essayerCompile(graine, compteur, 1, n) : module.essayer(graine, compteur, 1, n)
    if (solution) {
      solutions++
      trouvees.push([compteur, solution])
    }
  }
  const msParEssai = (performance.now() - debut) / essais
  // Vérification d’une preuve d’une part, répétée.
  let verificationMsParPart: number | undefined
  const premiere = trouvees[0]
  if (premiere) {
    const part = encoderPreuve([{ compteur: premiere[0], solution: premiere[1] }])
    const repetitions = 200
    const t0 = performance.now()
    for (let fois = 0; fois < repetitions; fois++) if (!module.verifier(graine, part, 1, 1, n)) throw new Error('Vérification refusée')
    verificationMsParPart = (performance.now() - t0) / repetitions
  }
  return { n, mode: compile ? 'compile' : 'interprete', essais, msParEssai, solutionsParDefi: solutions / essais, verificationMsParPart, memoireModuleOctets: module.memoireOctets }
}

export interface PlanMesure {
  n: number[]
  essaisCompile: number
  essaisInterprete: number
  /** Tailles de tranche comparées pour n = 60. */
  tranches: number[]
}

export async function mesurer(octets: Uint8Array, plan: PlanMesure, rapporter: (ligne: LigneMesure) => void): Promise<void> {
  for (const tranche of plan.tranches) rapporter(await mesurerCompile(octets, 60, plan.essaisCompile, tranche))
  for (const n of plan.n) {
    // Une échelle d’essais décroissante avec n garde chaque mesure sous la minute.
    const reduction = 2 ** ((n - 60) / 4)
    rapporter(await mesurerCompile(octets, n, Math.max(3, Math.round(plan.essaisCompile / reduction)), plan.tranches[0] ?? 2048))
    rapporter(await mesurerPublic(octets, n, Math.max(3, Math.round(plan.essaisCompile / reduction)), true))
    rapporter(await mesurerPublic(octets, n, Math.max(2, Math.round(plan.essaisInterprete / reduction)), false))
  }
}
