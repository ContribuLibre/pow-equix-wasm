// Web Worker du banc (démo seulement). Messages reçus :
//
//   { type: 'config', algorithme, parametres, graine, difficulte, octetsEquix? }
//   { type: 'plage', debut, fin }      essaie les nonces [debut, fin) (SHA-256, Argon2id)
//   { type: 'calibrer', dureeMs }      essaie des nonces pendant ≈ dureeMs : durée d’un essai
//   { type: 'palier' }                 un seul essai : la mémoire d’un fil est allouée (garde-fou)
//   { type: 'verifier', dureeMs }      vérifie une part valide en boucle : débit de vérification
//
// Réponses : { type: 'plage', debut, fin, trouves, essais, dureeMs },
// { type: 'calibrage', essais, dureeMs }, { type: 'palier' }, { type: 'verifications', nombre, dureeMs },
// { type: 'erreur', message }.

import { ModuleEquix, encoderPreuve } from '../../src/index.ts'
import { type Essayeur, essayeur } from './moteurs.ts'
import type { Algorithme, ParametresArgon2id, ParametresEquix } from './scenarios.ts'

interface Config { algorithme: Algorithme; parametres: ParametresArgon2id | ParametresEquix | Record<string, never>; graine: Uint8Array; difficulte: number; octetsEquix?: ArrayBuffer }

const portee = self as unknown as { onmessage: ((evenement: MessageEvent) => void) | null; postMessage(message: unknown): void }
let config: Config | undefined
let essayer: Essayeur | undefined
let equix: ModuleEquix | undefined
let file: Promise<void> = Promise.resolve()

async function moduleEquix(): Promise<ModuleEquix> {
  equix ??= await ModuleEquix.instancier(new Uint8Array(config!.octetsEquix!))
  return equix
}

/** Un essai quelconque, pour le calibrage : Equi-X compilé comme dans `resoudre` (sauf `compilation: 'jamais'`). */
async function unEssai(nonce: number): Promise<void> {
  if (config!.algorithme === 'equix') {
    const { n, compilation } = config!.parametres as ParametresEquix
    const module = await moduleEquix()
    if (compilation === 'jamais') module.essayer(config!.graine, nonce, 1, n)
    else await module.essayerCompile(config!.graine, nonce, 1, n)
  } else await essayer!(nonce)
}

async function traiter(message: { type: string; [cle: string]: unknown }): Promise<void> {
  if (message.type === 'config') {
    config = message as unknown as Config
    essayer = config.algorithme === 'equix' ? undefined : essayeur(config.algorithme, config.parametres as ParametresArgon2id, config.graine)
    return
  }
  if (!config) throw new Error('Web Worker du banc sans configuration.')
  if (message.type === 'plage') {
    const debut = message.debut as number
    const fin = message.fin as number
    const trouves: number[] = []
    const depart = performance.now()
    for (let nonce = debut; nonce < fin; nonce++) if ((await essayer!(nonce)) >= config.difficulte) trouves.push(nonce)
    portee.postMessage({ type: 'plage', debut, fin, trouves, essais: fin - debut, dureeMs: performance.now() - depart })
  } else if (message.type === 'calibrer') {
    const duree = message.dureeMs as number
    await unEssai(0x8000_0000) // mise en température, non comptée
    const depart = performance.now()
    let essais = 0
    while (essais < 3 || performance.now() - depart < duree) await unEssai(essais++)
    portee.postMessage({ type: 'calibrage', essais, dureeMs: performance.now() - depart })
  } else if (message.type === 'palier') {
    await unEssai(0)
    portee.postMessage({ type: 'palier' })
  } else if (message.type === 'verifier') {
    const duree = message.dureeMs as number
    let verifier: () => Promise<boolean> | boolean
    if (config.algorithme === 'equix') {
      // Une part valide d’effort 1 (vérification complète, sans rejet précoce par la règle d’effort).
      const { n } = config.parametres as ParametresEquix
      const module = await moduleEquix()
      let compteur = 0
      let solution: Uint8Array | null = null
      while (!solution) solution = await module.essayerCompile(config.graine, compteur++, 1, n)
      const preuve = encoderPreuve([{ compteur: compteur - 1, solution }])
      verifier = () => module.verifier(config!.graine, preuve, 1, 1, n)
    } else {
      // Le nonce 0 est valide à la difficulté 0 : chaque vérification recalcule une empreinte complète.
      verifier = async () => (await essayer!(0)) >= 0
    }
    await verifier()
    const depart = performance.now()
    let nombre = 0
    while (nombre < 3 || performance.now() - depart < duree) {
      if (!(await verifier())) throw new Error('Vérification refusée dans le banc.')
      nombre++
    }
    portee.postMessage({ type: 'verifications', nombre, dureeMs: performance.now() - depart })
  }
}

portee.onmessage = (evenement: MessageEvent) => {
  const message = evenement.data as { type: string }
  file = file.then(() => traiter(message)).catch((erreur: unknown) => {
    portee.postMessage({ type: 'erreur', message: erreur instanceof Error ? erreur.message : String(erreur) })
  })
}
