# PoW Equi-X en WebAssembly

[![Licence LGPL-3.0](https://img.shields.io/badge/licence-LGPL--3.0-blue)](LICENSE)
[![Vérification](https://github.com/ContribuLibre/pow-equix-wasm/actions/workflows/verification.yml/badge.svg)](https://github.com/ContribuLibre/pow-equix-wasm/actions/workflows/verification.yml)
[![git tag](https://img.shields.io/github/v/tag/ContribuLibre/pow-equix-wasm?label=git%20tag&labelColor=41454c&color=fe7d37)](https://github.com/ContribuLibre/pow-equix-wasm/releases)
[![npm](https://img.shields.io/npm/v/pow-equix-wasm?label=npm)](https://www.npmjs.com/package/pow-equix-wasm)

Preuve de travail **Equi-X**, celle que Tor utilise contre les dénis de service :
un seul module de 45 Kio résout la preuve dans le navigateur, sur plusieurs
cœurs, et la vérifie côté serveur en quelques centaines de microsecondes. Là où
WebAssembly est désactivé, le même module traduit en JavaScript pur prend le
relais, et le mode dégradé est signalé.

- **Démo en ligne et calibrage :** <https://contribulibre.github.io/pow-equix-wasm/>
- **Code source :** <https://github.com/ContribuLibre/pow-equix-wasm>
- **Paquet npm :** [`pow-equix-wasm`](https://www.npmjs.com/package/pow-equix-wasm)

> *English summary: Equi-X proof of work (from Tor's Arti project) as a single
> WebAssembly module, with a pure-JavaScript fallback (wasm2js) where
> WebAssembly is disabled. It solves in the browser across Web Workers
> (cancellable, with progress and remaining-time estimate) and verifies
> server-side in ~0.25 ms per part. Reproducible build. LGPL-3.0.*

## Pourquoi Equi-X

Une preuve de travail n’a de sens que si l’attaquant ne peut pas la calculer
beaucoup plus vite que la personne honnête, et si le serveur la vérifie pour
presque rien. Ordres de grandeur pour une preuve réglée sur **une minute dans un
navigateur, sur un cœur** :

| | SHA-256 (hashcash) | Argon2id (64 Mio par essai) | **Equi-X** |
|---|---|---|---|
| Un essai, navigateur | ≈ 0,1 à 10 µs | ≈ 0,3 à 1 s | **≈ 0,4 s** (mesuré) |
| Mémoire pour résoudre | < 1 Kio | 64 Mio par essai en cours | **≈ 2 Mio** par essai en cours (mesuré) |
| La même preuve sur matériel optimisé | carte graphique : ≈ 10 ms ; puce de minage : ≈ 1 µs | ≈ 10 à 30 s : la mémoire freine cartes graphiques et puces | **≈ 3 s** en code natif compilé (mesuré) ; programmes aléatoires conçus pour ne pas avantager les cartes graphiques |
| Avantage du matériel optimisé | × 10³ à × 10⁷ | × 2 à × 5 | **≈ × 20** |
| Vérifier une preuve | 1 empreinte : ≈ 1 µs, négligeable | 1 essai complet : ≈ 0,1 à 1 s **et** 64 Mio par vérification | **≈ 0,25 ms par part** en WebAssembly, ≈ 0,2 ms en natif (mesuré) ; pas de mémoire à réserver |

- **SHA-256** : les cartes graphiques et, pire, les puces de minage Bitcoin la
  calculent des milliers à des millions de fois plus vite qu’un navigateur. Des
  outils existent pour résoudre ces défis en masse.
- **Argon2id** : la mémoire exigée égalise bien le matériel, mais vérifier coûte
  autant qu’un essai : chaque fausse preuve envoyée au serveur lui coûte des
  dizaines de mégaoctets et des centaines de millisecondes.
- **Equi-X** combine les deux qualités : un nouveau programme HashX tiré au sort
  à chaque essai et environ 2 Mio de mémoire, mais une vérification qui ne
  refait qu’une poignée d’évaluations.

Les chiffres « mesurés » viennent de ce dépôt (portable x86-64 récent) ; les
autres sont des ordres de grandeur publics, à affiner avec la page de démo.

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

### Dans le navigateur

```ts
import { construireGraine, hexadecimal, resoudre } from 'pow-equix-wasm'
// Le module est un fichier du paquet, que le bundler publie (ici Vite).
import urlEquix from 'pow-equix-wasm/equix.wasm?url'

const octets = new Uint8Array(await (await fetch(urlEquix)).arrayBuffer())
const graine = await construireGraine('mon-service/1', JSON.stringify(requete))
const annulation = new AbortController()
const { parts } = await resoudre({
  octets, graine, effort: 1, nombre: 4,
  signal: annulation.signal,
  onProgression: ({ moteur, essais, parts, dureeMs, restantEstimeMs, memoireOctets }) => { /* … */ },
})
envoyer({ ...requete, preuve: hexadecimal(parts) })
```

`resoudre` répartit les compteurs entre des Web Workers créés depuis un Blob
(aucun fichier supplémentaire à publier) : par défaut un par cœur annoncé, huit
au plus, et jamais plus que d’essais attendus (`filsConseilles`). Si les Web
Workers sont refusés, le calcul continue sur le fil courant. `fils: 0` force ce
mode. La progression donne le moteur, les essais, les parts trouvées, le temps
écoulé, une estimation du temps restant mesurée sur l’appareil et la mémoire.

### Sans WebAssembly : repli en JavaScript et mode dégradé

`pow-equix-wasm/js` fournit le même module traduit en JavaScript pur par wasm2js
(binaryen) : mêmes preuves, octet pour octet, mais bien plus lent. Il ne pèse
qu’environ 120 Ko une fois minifié, et n’a à être chargé que s’il sert :

```ts
import { estimerDuree, ralentissement, resoudre, webAssemblyDisponible } from 'pow-equix-wasm'

const wasm = webAssemblyDisponible()
const js = wasm ? undefined : (await import('pow-equix-wasm/js')).creerExportsEquixJs
if (!wasm) {
  // Sans WebAssembly, le JIT est en général coupé aussi : hypothèse prudente.
  const attente = estimerDuree({ effort: 1, nombre: 4, execution: 'jsSansJit' })
  if (attente > 5_000) avertir(`Active WebAssembly pour valider environ ${Math.round(ralentissement('jsSansJit'))} fois plus vite.`)
}
const resultat = await resoudre({ octets, js, graine, effort: 1, nombre: 4, onProgression })
// resultat.moteur vaut 'js' en mode dégradé.
```

`moteur: 'wasm' | 'js' | 'auto'` impose ou laisse choisir le moteur ;
`moteurRetenu` dit à l’avance lequel servira. `ModuleEquix.instancier(octets)`
et `ModuleEquix.depuisJs(creerExportsEquixJs)` donnent chacun un module qui
résout et vérifie.

| Un cœur, portable x86-64 | Un essai | Ralentissement |
|---|---|---|
| WebAssembly (Chromium, Bun, Node) | ≈ 410 ms | × 1 |
| JavaScript avec JIT | ≈ 3,8 s (Chromium), 1,5 s (Node) | × 4 à × 9 |
| JavaScript sans JIT (Node `--jitless`) | ≈ 79 s | ≈ × 190 |

Désactiver WebAssembly s’accompagne presque toujours d’un JavaScript sans JIT
(Tor Browser en mode renforcé, mode Isolement d’iOS) : prévoir un avertissement
et une difficulté réaliste pour ces personnes.

### Côté serveur

```ts
import { readFile } from 'node:fs/promises'
import { ModuleEquix, construireGraine, depuisHexadecimal } from 'pow-equix-wasm'

const module = await ModuleEquix.instancier(await readFile(new URL(import.meta.resolve('pow-equix-wasm/equix.wasm'))))
const graine = await construireGraine('mon-service/1', JSON.stringify(requeteSansPreuve))
const valide = module.verifier(graine, depuisHexadecimal(preuve) ?? new Uint8Array(), 1, 4)
```

Une page qui ne peut rien télécharger (ouverte en `file://`, script unique)
intègre le module en base64 avec `octetsEquix()` de `pow-equix-wasm/octets`.

Ce qui reste à la charge de l’appelant, et que le paquet ne fait pas :
refuser les preuves rejouées, vérifier la fraîcheur de la requête (horodatage
dans le contenu haché) et limiter le débit des vérifications.

## Construction reproductible

Rien de construit n’est versionné : `dist/` et `site/` sont produits par la CI.

- Rust figé par `rust-toolchain.toml`, dépendances verrouillées par `Cargo.lock`
  (`cargo build --locked`), chemins locaux effacés du binaire
  (`--remap-path-prefix`), pas de compilation incrémentale ; binaryen, donc
  wasm2js, figé dans `package.json`.
- `bun run verify:reproductible` reconstruit le module et sa traduction
  JavaScript depuis une copie des sources placée ailleurs, et exige des
  fichiers identiques à l’octet près.
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

- **Démo** : chaque push sur `main` la publie sur GitHub Pages.
- **npm** : pousser un tag `vX.Y.Z` égal à la version de `package.json`. Le
  workflow vérifie tout, publie sans aucun secret (publication de confiance npm
  par OIDC, avec provenance signée), puis crée la release GitHub avec
  `equix.wasm` et son empreinte.

## Organisation

- `crates/pow-equix` : défi, résolution et vérification en Rust ; réutilisable en
  natif (option `compilateur` pour générer du code machine HashX, par exemple
  dans une application Tauri).
- `crates/pow-equix-wasm` : interface C minimale vers WebAssembly, sans
  wasm-bindgen.
- `src/index.ts` : chargeur, deux moteurs, Web Workers, annulation,
  progression, estimations, vérification.
- `demo/` : page de démo et de calibrage.

## Licence

LGPL-3.0 (voir `LICENSE` et `COPYING`). Le module intègre les crates `equix` et
`hashx` du projet [Arti](https://gitlab.torproject.org/tpo/core/arti) de Tor,
elles-mêmes sous LGPL-3.0, d’après les algorithmes de tevador.
