// Page de mesure servie par scripts/mesurer.ts à Chromium sans interface :
// les lignes sont renvoyées au serveur au fil de l’eau.
import { mesurer } from './banc.ts'

const parametres = new URLSearchParams(location.search)
const liste = (nom: string, defaut: string): number[] => (parametres.get(nom) ?? defaut).split(',').map(Number)
const envoyer = (corps: unknown): Promise<Response> => fetch('/resultat', { method: 'POST', body: JSON.stringify(corps) })
try {
  const octets = new Uint8Array(await (await fetch('/equix.wasm')).arrayBuffer())
  await envoyer({ navigateur: navigator.userAgent })
  await mesurer(octets, {
    n: liste('n', '60,64,68,72,76,80'),
    essaisCompile: Number(parametres.get('essaisCompile') ?? 40),
    essaisInterprete: Number(parametres.get('essaisInterprete') ?? 8),
    tranches: liste('tranches', '2048,65536,512'),
  }, (ligne) => void envoyer({ ligne }))
  await envoyer({ fin: true })
} catch (erreur) {
  await envoyer({ erreur: String(erreur) })
}
