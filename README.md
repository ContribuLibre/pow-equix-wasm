# pow-equix-wasm

Preuve de travail **Equi-X** (celle que Tor utilise contre les dénis de service)
compilée en WebAssembly : **un seul module de 45 Kio** résout la preuve dans le
navigateur, sur plusieurs cœurs, et la vérifie côté serveur en quelques centaines
de microsecondes.

- **Démo et calibrage** : <https://contribulibre.github.io/pow-equix-wasm/>
- **Paquet npm** : [`pow-equix-wasm`](https://www.npmjs.com/package/pow-equix-wasm)

> *English summary: Equi-X proof of work (from Tor's Arti project) as a single
> WebAssembly module. It solves in the browser across Web Workers (cancellable,
> with progress) and verifies server-side in ~0.2 ms per part. The build is
> reproducible byte for byte. LGPL-3.0.*

## Pourquoi Equi-X plutôt que SHA-256

Une preuve SHA-256 (façon hashcash) se calcule des milliers de fois plus vite sur
une carte graphique ou une puce de minage que dans un navigateur. Equi-X tire au
sort un nouveau programme HashX à chaque essai et demande environ 1,8 Mio de
mémoire par essai : l’avantage d’un attaquant équipé tombe à un facteur de
l’ordre de 20 face à un navigateur. La vérification, elle, reste très bon marché.

## Protocole

Le défi d’un essai est `graine ‖ compteur` (compteur u32 petit-boutiste). La
graine appartient à l’appelant : en général un domaine propre à son protocole,
un octet nul, puis l’empreinte SHA-256 de la requête à protéger
(`construireGraine`). Une preuve calculée pour une requête ne vaut donc rien pour
une autre.

- Equi-X trouve en moyenne deux solutions par défi. Une solution est retenue si
  `blake2b-256(défi ‖ solution)`, lu en u32 gros-boutiste, multiplié par
  l’**effort**, ne dépasse pas 2³² − 1 : c’est la règle d’effort de Tor (`hs_pow`).
- Une preuve réunit **`nombre` parts** de 20 octets (`compteur ‖ solution`), aux
  compteurs strictement croissants. Plusieurs petites preuves plutôt qu’une
  grande rendent l’attente régulière (écart type relatif en `1/√nombre`).
- Probabilité qu’un essai aboutisse : environ `1 − e^(−2/effort)`, soit 86 %
  pour l’effort 1, 62 % pour 2, 12 % pour 16 (`probabiliteEssai`).

## Utilisation

```ts
import { ModuleEquix, construireGraine, hexadecimal, resoudre } from 'pow-equix-wasm'

// Navigateur : le module est un fichier du paquet, que le bundler publie (ici Vite).
import urlEquix from 'pow-equix-wasm/equix.wasm?url'
const octets = new Uint8Array(await (await fetch(urlEquix)).arrayBuffer())

const graine = await construireGraine('mon-service/1', JSON.stringify(requete))
const annulation = new AbortController()
const { parts, essais } = await resoudre({
  octets, graine, effort: 1, nombre: 4,
  signal: annulation.signal,
  onProgression: ({ essais, parts, memoireOctets }) => { /* … */ },
})
envoyer({ ...requete, preuve: hexadecimal(parts) })
```

Côté serveur (Bun, Node, Deno), la même bibliothèque vérifie :

```ts
import { readFile } from 'node:fs/promises'
import { ModuleEquix, construireGraine, depuisHexadecimal } from 'pow-equix-wasm'

const module = await ModuleEquix.instancier(await readFile(new URL(import.meta.resolve('pow-equix-wasm/equix.wasm'))))
const graine = await construireGraine('mon-service/1', JSON.stringify(requeteSansPreuve))
const valide = module.verifier(graine, depuisHexadecimal(preuve) ?? new Uint8Array(), 1, 4)
```

Une page qui ne peut rien télécharger (ouverte en `file://`, script unique) peut
intégrer le module en base64 :

```ts
import { octetsEquix } from 'pow-equix-wasm/octets'
const octets = octetsEquix()
```

Ce qui reste à la charge de l’appelant, et que le paquet ne fait pas :
refuser les preuves rejouées, vérifier la fraîcheur de la requête (horodatage
dans le contenu haché) et limiter le débit des vérifications.

### Web Workers

`resoudre` répartit les compteurs entre des Web Workers créés depuis un Blob
(aucun fichier supplémentaire à publier) : par défaut un par cœur annoncé, huit
au plus, et jamais plus que d’essais attendus. Si les Web Workers sont refusés
(politique de sécurité, `file://` dans certains navigateurs), le calcul continue
sur le fil courant, essai par essai. `fils: 0` force ce mode.

## Mesures

Linux x86_64, un fil, module WebAssembly :

| | Chromium | Bun 1.4 |
|---|---|---|
| un essai | ≈ 410 ms | ≈ 400 ms |
| vérification d’une part | ≈ 230 µs | ≈ 250 µs |
| mémoire par fil | ≈ 1,8 Mio de zone de travail (2,9 Mio pour l’instance) | |

Les temps varient fortement d’un appareil à l’autre : c’est tout l’objet de la
page de démo, qui mesure sur l’appareil utilisé le temps d’une preuve (médiane,
90ᵉ centile), la mémoire par fil et le coût de la vérification, et exporte le
tout en JSON pour comparer plusieurs appareils.

## Construction reproductible

Le module est construit, jamais versionné : `dist/` et `site/` sont produits
par la CI.

- Rust figé par `rust-toolchain.toml`, dépendances verrouillées par `Cargo.lock`
  (`cargo build --locked`), chemins locaux effacés du binaire
  (`--remap-path-prefix`), pas de compilation incrémentale.
- `bun run verify:reproductible` reconstruit depuis une copie des sources placée
  ailleurs et exige un module identique à l’octet près.
- Chaque release GitHub donne le SHA-256 du module publié ; pour le vérifier :
  `bun run build && bun run verify:reproductible --attendu <sha256>`.

```sh
bun install
bun run check   # tests Rust et TS, construction, démo, reproductibilité
bun run demo    # construit puis sert la démo sur http://127.0.0.1:4600/
```

Il faut Rust (via rustup, qui installe seul la version figée et la cible
`wasm32-unknown-unknown`) et Bun.

## Publication

- **Démo** : chaque push sur `main` la publie sur GitHub Pages (réglage du dépôt :
  *Settings → Pages → Source : GitHub Actions*).
- **npm** : pousser un tag `vX.Y.Z` égal à la version de `package.json`. Le
  workflow vérifie tout, publie sans aucun secret (publication de confiance
  npm par OIDC, avec provenance signée), puis crée la release GitHub avec
  `equix.wasm` et son empreinte.

## Organisation

- `crates/pow-equix` : défi, résolution et vérification en Rust ; réutilisable en
  natif (option `compilateur` pour générer du code machine HashX, par exemple
  dans une application Tauri).
- `crates/pow-equix-wasm` : interface C minimale vers WebAssembly, sans
  wasm-bindgen.
- `src/index.ts` : chargeur, Web Workers, annulation, progression, vérification.
- `demo/` : page de démo et de calibrage.

## Licence

LGPL-3.0 (voir `LICENSE` et `COPYING`). Le module intègre les crates `equix` et
`hashx` du projet [Arti](https://gitlab.torproject.org/tpo/core/arti) de Tor,
elles-mêmes sous LGPL-3.0, d’après les algorithmes de tevador.
