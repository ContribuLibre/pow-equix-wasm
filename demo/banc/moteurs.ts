// Moteurs de hashcash du banc : SHA-256 et Argon2id. Un défi est une graine ;
// un essai, un nonce u32 : `empreinte(graine ‖ nonce petit-boutiste)`, réussi si
// l’empreinte commence par au moins `difficulte` bits nuls (lue en gros-boutiste).
// Argon2id : mot de passe = graine ‖ nonce, sel fixe, empreinte de 32 octets.
// Equi-X passe par la bibliothèque elle-même.

import { argon2id } from 'hash-wasm'
import { hacheurHashcash } from './sha256.ts'
import type { ParametresArgon2id } from './scenarios.ts'

/** Sel fixe d’Argon2id : la graine, propre à chaque défi, est dans le mot de passe. */
export const SEL_ARGON2 = new TextEncoder().encode('pow-equix/banc16')

/** Bits nuls en tête d’une empreinte en octets. */
export function zerosEnTete(octets: Uint8Array): number {
  let zeros = 0
  for (const octet of octets) {
    if (octet === 0) {
      zeros += 8
      continue
    }
    return zeros + Math.clz32(octet) - 24
  }
  return zeros
}

function avecNonce(graine: Uint8Array, nonce: number): Uint8Array {
  const message = new Uint8Array(graine.length + 4)
  message.set(graine)
  new DataView(message.buffer).setUint32(graine.length, nonce >>> 0, true)
  return message
}

export async function empreinteArgon2id(parametres: ParametresArgon2id, graine: Uint8Array, nonce: number): Promise<Uint8Array> {
  return argon2id({
    password: avecNonce(graine, nonce), salt: SEL_ARGON2, iterations: parametres.iterations, parallelism: parametres.parallelisme,
    memorySize: parametres.memoireKio, hashLength: 32, outputType: 'binary',
  })
}

/** Essayeur d’un défi : nombre de bits nuls en tête pour un nonce. */
export type Essayeur = (nonce: number) => number | Promise<number>

export function essayeur(algorithme: 'sha256' | 'argon2id', parametres: ParametresArgon2id | Record<string, never>, graine: Uint8Array): Essayeur {
  if (algorithme === 'sha256') {
    const hacheur = hacheurHashcash(graine)
    return (nonce) => hacheur.zerosEnTete(nonce)
  }
  const argon = parametres as ParametresArgon2id
  return async (nonce) => zerosEnTete(await empreinteArgon2id(argon, graine, nonce))
}

/** Vérifie les nonces d’une preuve : tous distincts, chacun à la difficulté voulue. */
export async function verifierNonces(algorithme: 'sha256' | 'argon2id', parametres: ParametresArgon2id | Record<string, never>, graine: Uint8Array, nonces: readonly number[], difficulte: number): Promise<boolean> {
  if (new Set(nonces).size !== nonces.length) return false
  const essayer = essayeur(algorithme, parametres, graine)
  for (const nonce of nonces) if ((await essayer(nonce)) < difficulte) return false
  return true
}

/** Taille d’une preuve hashcash encodée comme celles d’Equi-X : écarts de nonces triés en LEB128, sans solution. */
export function tailleNonces(nonces: readonly number[]): number {
  const tries = [...nonces].sort((a, b) => a - b)
  let octets = 0
  tries.forEach((nonce, index) => {
    let ecart = index === 0 ? nonce : nonce - tries[index - 1]! - 1
    octets++
    while (ecart >= 0x80) {
      ecart = Math.floor(ecart / 128)
      octets++
    }
  })
  return octets
}
