// Sert site/ en local pour essayer la démo : bun run demo
import { resolve } from 'node:path'

const site = resolve(import.meta.dirname, '../site')
const port = Number(process.env.PORT ?? 4600)
Bun.serve({
  port,
  hostname: '127.0.0.1',
  async fetch(requete) {
    const chemin = new URL(requete.url).pathname
    const cible = resolve(site, `.${decodeURIComponent(chemin.endsWith('/') ? `${chemin}index.html` : chemin)}`)
    const fichier = Bun.file(cible)
    // Rien hors de site/, même avec des « .. » dans l’adresse.
    return cible.startsWith(`${site}/`) && (await fichier.exists()) ? new Response(fichier) : new Response('Introuvable', { status: 404 })
  },
})
console.log(`Démo : http://127.0.0.1:${port}/`)
