# PoW Equi-X en WebAssembly

[![Licence LGPL-3.0](https://img.shields.io/badge/licence-LGPL--3.0-blue)](LICENSE)
[![Vérification](https://github.com/ContribuLibre/pow-equix-wasm/actions/workflows/verification.yml/badge.svg)](https://github.com/ContribuLibre/pow-equix-wasm/actions/workflows/verification.yml)
[![git tag](https://img.shields.io/github/v/tag/ContribuLibre/pow-equix-wasm?label=git%20tag&labelColor=41454c&color=fe7d37)](https://github.com/ContribuLibre/pow-equix-wasm/releases)
[![npm](https://img.shields.io/npm/v/pow-equix-wasm?label=npm)](https://www.npmjs.com/package/pow-equix-wasm)

Preuve de travail **Equi-X**, celle que Tor utilise contre les dénis de service :
un seul module de 60 Kio résout la preuve dans le navigateur, sur plusieurs
cœurs, et la vérifie côté serveur en quelques centaines de microsecondes. Chaque
programme HashX est compilé à la volée en WebAssembly, ce qui ramène l’écart
avec du code natif d’environ × 20 à environ × 1,6. La mémoire se règle, de
1,8 Mio (Equi-X) à 63 Mio par fil. Là où WebAssembly est désactivé, le même
module traduit en JavaScript pur prend le relais, et le mode dégradé est signalé.

- **Démo en ligne et calibrage :** <https://contribulibre.github.io/pow-equix-wasm/>
- **Code source :** <https://github.com/ContribuLibre/pow-equix-wasm>
- **Paquet npm :** [`pow-equix-wasm`](https://www.npmjs.com/package/pow-equix-wasm)

> *English summary: Equi-X proof of work (from Tor's Arti project) as a single
> WebAssembly module, with a pure-JavaScript fallback (wasm2js) where
> WebAssembly is disabled. Each HashX program is compiled to a tiny WebAssembly
> module on the fly (≈ 35 ms per attempt in Chromium vs ≈ 21 ms for native
> compiled code). Memory is tunable: Equihash(n, 3) over HashX, n = 60 (exactly
> Equi-X, the default) to n = 80 (63 MiB per thread). It solves in the browser
> across Web Workers (cancellable, with progress and remaining-time estimate)
> and verifies server-side in ~0.2 ms per part whatever n. Reproducible build.
> LGPL-3.0.*

## Pourquoi Equi-X

Une preuve de travail n’a de sens que si l’attaquant ne peut pas la calculer
beaucoup plus vite que la personne honnête, et si le serveur la vérifie pour
presque rien.

Le coût d’**un essai** est propre à chaque algorithme ; la difficulté règle
ensuite le **nombre d’essais** à trouver. Ordres de grandeur pour une preuve
réglée sur **une minute dans un navigateur, sur un cœur** :

| | SHA-256 (hashcash) | Argon2id (64 Mio par essai) | **Equi-X** (n = 60) |
|---|---|---|---|
| Un essai dans le navigateur | ≈ 0,1 à 10 µs | ≈ 0,3 à 1 s | **≈ 35 ms** (mesuré, programmes compilés) |
| Essais à réaliser pour 1 min | ≈ 10⁷ à 10⁹ | ≈ 60 à 200 | **≈ 1 700** |
| Mémoire pendant le calcul | < 1 Kio | 64 Mio par essai en cours | **≈ 3 Mio** par essai en cours (mesuré), réglable jusqu’à 64 Mio |
| La même preuve sur matériel optimisé | carte graphique : ≈ 10 ms ; puce de minage : ≈ 1 µs | ≈ 10 à 30 s : la mémoire freine cartes graphiques et puces | **≈ 37 s** en code natif compilé (mesuré) |
| Avantage du matériel optimisé | × 10³ à × 10⁷ | × 2 à × 5 | **≈ × 1,6** (× 20 quand le navigateur interprète HashX) |
| Vérifier une preuve : temps | 1 empreinte, ≈ 1 µs | **1 essai complet, ≈ 0,1 à 1 s** | **≈ 0,2 ms par part**, en WebAssembly comme en natif, quel que soit n (mesuré) |
| Vérifier une preuve : mémoire | négligeable | **64 Mio par vérification** | négligeable |

Les chiffres « mesurés » viennent de ce dépôt (voir [Mesures](#mesures)) ; les
autres sont des ordres de grandeur publics, à affiner avec la page de démo.

- **SHA-256 est écarté** : cartes graphiques et puces de minage Bitcoin la
  calculent des milliers à des millions de fois plus vite qu’un navigateur, et
  des outils existent pour résoudre ces défis en masse.
- **Argon2id est écarté à cause de sa vérification**, qui coûte autant qu’un
  essai. Chaque preuve reçue, même fausse, oblige le serveur à refaire un calcul
  complet : un attaquant qui envoie **100 fausses preuves par seconde**, sans
  rien calculer lui-même, occupe 30 à 100 cœurs et 6,4 Gio de mémoire du
  serveur. La preuve de travail, censée protéger le serveur, devient alors le
  moyen le plus simple de le saturer (déni de service).
- **Equi-X** garde l’égalisation du matériel sans ce défaut : un nouveau
  programme HashX tiré au sort à chaque essai et environ 2 Mio de mémoire pour
  résoudre, mais une vérification qui ne refait qu’une poignée d’évaluations.
  Les mêmes 100 fausses preuves par seconde coûtent environ 2 % d’un cœur.

### Compiler HashX dans le navigateur

L’avantage d’un attaquant natif sur Equi-X venait surtout de la compilation :
en natif, chaque programme HashX (512 instructions tirées au sort par défi) est
compilé en code machine, alors que le module WebAssembly l’interprétait :
≈ 21 ms par essai contre ≈ 430 ms. Désormais, pour chaque défi, le chargeur
JavaScript génère un petit module WebAssembly (≈ 9 Ko) qui évalue le programme
sur les 2¹⁶ indices et écrit la table des valeurs directement dans la mémoire
du solveur, qu’il importe ; le solveur Rust cherche ensuite les collisions.

- La liste d’instructions vient d’une copie de la crate `hashx` qui expose le
  programme généré (`crates/hashx`) : c’est le programme de hashx, vérifié
  entrée par entrée contre la crate publiée.
- WebAssembly n’a pas de multiplication 64 × 64 → 128 bits : la moitié haute
  est reconstituée à partir de quatre produits 32 × 32 (et corrigée pour la
  version signée). Le branchement unique de HashX devient une boucle par cible.
- Coût mesuré dans Chromium par essai : génération 1,5 ms, compilation et
  instanciation 0,9 ms, remplissage de la table 24 ms (contre ≈ 420 ms
  interprété), recherche 8 ms. La compilation est donc rentable dès le premier
  essai, et activée par défaut (`compilation: 'auto'`).
- Aucun `eval` : la politique `script-src 'self' 'wasm-unsafe-eval'` suffit.
- Le moteur JavaScript (sans WebAssembly) reste interprété : y compiler
  demanderait `eval`, que ces navigateurs refusent justement.

Résultat : ≈ 35 ms par essai dans Chromium (≈ 50 ms sous Bun) contre ≈ 21 ms
en natif compilé, soit un écart d’environ **× 1,6** au lieu de × 20.

### Et plus de mémoire ?

Le paramètre `n` choisit un membre de la famille Equihash(n, k = 3) sur HashX
dont Equi-X est le cas n = 60. Chaque pas de 4 double la liste de valeurs à
calculer et à trier, donc la mémoire et le temps d’un essai ; la vérification,
elle, reste de huit évaluations HashX, ≈ 0,2 ms par part quel que soit n.

| n | Mémoire de travail par fil | Un essai, Chromium (compilé) | Un essai, natif compilé | Écart |
|---|---|---|---|---|
| 60 (Equi-X) | 1,8 Mio | 34 ms | 21 ms | × 1,6 |
| 64 | 3,8 Mio | 66 à 74 ms | 48 ms | × 1,4 à 1,5 |
| 68 | 7,6 Mio | 155 ms | 88 ms | × 1,8 |
| 72 | 15 Mio | 271 à 288 ms | 177 ms | × 1,5 à 1,6 |
| 76 | 30 Mio | 557 à 569 ms | 356 ms | × 1,6 |
| 80 | 63 Mio | 1,24 à 1,30 s | 0,72 s | × 1,7 à 1,8 |

Ce que montrent ces mesures :

- **La mémoire ne réduit pas l’écart avec un attaquant natif** : il reste
  entre × 1,4 et × 1,8 à tous les n, parce que natif et navigateur font le même
  travail, deux fois plus grand à chaque pas. Il augmente même un peu vers
  n = 80 : la recherche, limitée par les accès mémoire, y est deux fois plus
  lente en WebAssembly (511 ms contre 249 ms). C’est la compilation, pas la
  mémoire, qui a réduit l’écart de × 20 à × 1,6.
- **La mémoire renchérit le parallélisme massif** (cartes graphiques, puces
  dédiées) : chaque essai en cours immobilise n Mio et une bande passante
  mémoire proportionnelle. L’expérience d’Equihash montre toutefois que cela
  ne suffit pas à l’empêcher : des puces spécialisées existent pour Equihash à
  144 Mio.
- **Elle coûte cher aux appareils modestes** : à n = 80, un téléphone qui
  calcule sur huit cœurs mobilise ≈ 0,5 Gio, et un essai y dure plusieurs
  secondes. Pour une même durée totale, il faut diviser l’effort d’autant.

n = 60 reste donc le réglage par défaut ; un n plus grand se justifie pour un
public d’ordinateurs de bureau, contre un attaquant qui paralléliserait sur du
matériel pauvre en mémoire. `nPourMemoire(mio)` donne le plus grand n qui tient
dans un budget par fil.

## Protocole

Le défi d’un essai est `graine ‖ compteur` (compteur u32 petit-boutiste). La
graine appartient à l’appelant : en général un domaine propre à son protocole,
un octet nul, puis l’empreinte SHA-256 de la requête à protéger
(`construireGraine`). Une preuve calculée pour une requête ne vaut donc rien pour
une autre.

- Un défi a en moyenne deux solutions, quel que soit n. Une solution est
  retenue si `blake2b-256(graine HashX ‖ solution)`, lu en u32 gros-boutiste,
  multiplié par l’**effort**, ne dépasse pas 2³² − 1 : c’est la règle d’effort
  de Tor (`hs_pow`). Pour n = 60, la graine HashX est le défi lui-même.
- Une preuve réunit **`nombre` parts** aux compteurs strictement croissants,
  sous la forme compacte décrite plus bas : ≈ 17 octets par part pour n = 60,
  22 pour n = 80. Plusieurs petites preuves plutôt qu’une grande rendent
  l’attente régulière (écart type relatif en `1/√nombre`).
- Probabilité qu’un essai aboutisse : environ `1 − e^(−2/effort)`, soit 86 %
  pour l’effort 1, 62 % pour 2, 12 % pour 16 (`probabiliteEssai`).
- Le vérificateur doit employer les mêmes effort, nombre **et n** que le
  solveur : une preuve n’est valable que pour son n.

### Règles d’Equihash(n, 3) sur HashX

Avec `c = n / 4` et `N = 2^(c+1)` indices (n ∈ {60, 64, 68, 72, 76, 80}) :

- **Programme** : HashX (hashx 0.9.1) tiré de la graine HashX, qui vaut le défi
  pour n = 60 (exactement Equi-X), et `défi ‖ "pow-equix/equihash-k3-n" ‖ n`
  (23 octets ASCII puis n sur un octet) au-delà, pour que chaque n tire ses
  propres programmes. Si la graine ne donne aucun programme valide (quelques
  graines sur plusieurs milliers), le défi n’a pas de solution.
- **Valeur** d’un indice `i < N` : `V(i) = HashX(i)`, sur le premier mot de
  64 bits de la sortie pour n ≤ 64 ; pour n > 64, `mot0 + 2⁶⁴ × (mot1 mod 2^(n−64))`
  (deux premiers mots petit-boutistes de la sortie étendue de HashX).
- **Solution** : 8 indices `i₀ … i₇`, tous inférieurs à N, tels que, modulo 2ⁿ,
  - chaque paire `V(i₂ⱼ) + V(i₂ⱼ₊₁)` s’annule sur ses c bits de poids faible,
  - chaque quadruplet `V(i₀) + … + V(i₃)` et `V(i₄) + … + V(i₇)` sur 2c bits,
  - la somme des huit sur les n bits.
- **Ordre canonique** : à chaque nœud de l’arbre (paires, quadruplets, racine),
  la moitié gauche, lue de son dernier élément vers le premier, ne dépasse pas
  la moitié droite lue de la même façon (ordre lexicographique, égalité
  permise) : c’est la règle d’Equi-X, qui rend chaque solution unique.
- **Solution rangée** : les 8 indices sur b = n/4 + 1 bits chacun, bout à bout
  dans un flux de bits petit-boutiste (indice 0 dans les bits de poids faible
  du premier octet), soit exactement b octets. Pour n = 60 (b = 16), c’est
  octet pour octet la forme d’Equi-X (8 × u16 petit-boutistes) ; 21 octets pour
  n = 80. La règle d’effort porte sur cette forme rangée.
- **Solveur** : celui d’Equi-X, généralisé (`crates/pow-equix/src/solveur.rs`) :
  2^(c−7) seaux de 336 places par couche (256 éléments en moyenne), table
  temporaire de 128 seaux de 12 places, mêmes règles d’abandon quand un seau
  déborde et même ordre de parcours, au plus 8 solutions par défi. Pour n = 60,
  il donne exactement les solutions de la crate `equix` d’Arti, dans le même
  ordre : vérifié sur 2 000 défis, et les deux vérifications s’accordent sur
  toutes les altérations essayées (tests Rust).

### Forme d’une preuve

```text
preuve = pour chaque part : écart (LEB128 non signé, 1 à 5 octets) ‖ solution rangée (n/4 + 1 octets)
```

- Le premier écart est le compteur lui-même, les suivants `compteur −
  précédent − 1` : la stricte croissance des compteurs est implicite, et les
  compteurs d’une preuve (en général sous 128) ne coûtent qu’un octet chacun.
- **Une seule forme d’octets par preuve.** Le décodeur refuse tout LEB128 non
  canonique (octet final nul dans un encodage de plus d’un octet, plus de
  5 octets, valeur au-delà de 2³² − 1), un compteur cumulé au-delà de
  2³² − 1, un nombre de parts différent de `nombre` et tout octet en trop ou
  manquant. Sans cette règle, un attaquant pourrait réencoder une preuve
  acceptée (zéros de tête dans un écart…) et la faire passer pour nouvelle
  auprès d’une détection de rejeu fondée sur l’empreinte de la preuve.
- Taille maximale : `nombre × (5 + n/4 + 1)` octets (`tailleMaxPreuve(n,
  nombre)`) ; un serveur refuse une entrée plus longue avant tout calcul.
- Tailles mesurées pour 4 parts, compteurs sous 128 : 68 octets pour n = 60
  (effort 1 comme effort 16), 72 pour n = 64, 80 pour n = 72, 88 pour n = 80,
  contre 80 et 144 octets avec les parts à compteur u32 d’avant.
- **Ce qui est standard, et ce qui ne l’est pas.** À n = 60, la solution est
  exactement la forme standard d’Equi-X : 16 octets, 8 × u16 petit-boutistes,
  telle que la produisent et la lisent Tor et la crate `equix`. L’enveloppe
  (écarts de compteur en LEB128, plusieurs parts) et les n supérieurs à 60
  sont propres à ce paquet : ni Tor ni une autre implémentation ne lisent
  cette enveloppe. Il n’y a qu’un format ; si un format aligné sur un autre
  protocole devait s’ajouter, ce serait comme une option explicite du
  protocole, convenue entre solveur et vérificateur, jamais devinée à la
  lecture des octets : sinon une même preuve aurait deux encodages, et la
  détection de rejeu se contournerait.
- **Rupture avec la 0.2** : ses preuves (parts de 20 octets, `compteur u32 ‖
  solution`) ne sont plus acceptées, et `VERSION_FORMAT` vaut 2, si bien qu’un
  chargeur 0.2 refuse ce module. La solution d’Equi-X, elle, est inchangée :
  à n = 60, seuls le compteur et l’enveloppe changent.

Pourquoi deux solutions par défi à tout n : chaque étage réunit N² / 2 paires
dont la somme s’annule sur c bits avec une probabilité 2^−c, soit ≈ N paires
gardées par étage ; le dernier étage exige 2c bits, soit N² / 2 × 2^−2c = 2
solutions attendues. Mesuré en natif : 2,07 solutions par défi pour n = 60
(400 défis), 1,99 pour 64, 2,07 pour 68, 1,98 pour 72 (400 défis chacun),
1,98 pour 76 (120 défis), 1,92 pour 80 (60 défis). Les probabilités par essai
de `probabiliteEssai` valent donc pour tout n.

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
  n: 60,                // mémoire : 60 (Equi-X, par défaut) à 80 ; le serveur vérifie avec le même n
  compilation: 'auto',  // par défaut : programmes HashX compilés en WebAssembly ; 'jamais' : interprète
  signal: annulation.signal,
  onProgression: ({ moteur, compilation, n, essais, parts, dureeMs, restantEstimeMs, memoireOctets }) => { /* … */ },
})
envoyer({ ...requete, preuve: hexadecimal(parts) })
```

`resoudre` répartit les compteurs entre des Web Workers créés depuis un Blob
(aucun fichier supplémentaire à publier) : par défaut un par cœur annoncé, huit
au plus, et jamais plus que d’essais attendus (`filsConseilles`). Si les Web
Workers sont refusés, le calcul continue sur le fil courant. `fils: 0` force ce
mode. La progression donne le moteur, le mode (compilé ou interprété), n, les
essais, les parts trouvées, le temps écoulé, une estimation du temps restant
mesurée sur l’appareil et la mémoire réelle des modules. L’annulation, la
progression et les Web Workers fonctionnent dans les deux modes ; si la
compilation d’un programme échoue, l’interprète termine l’essai et prend le
relais (`resultat.compilation` vaut alors `false`).

Politique de sécurité du contenu : `script-src 'self' 'wasm-unsafe-eval'`
suffit (aucun `eval`) ; les Web Workers viennent d’un Blob, donc `worker-src blob:`
(ou `script-src … blob:`) est nécessaire pour calculer sur plusieurs cœurs.

#### Choisir la mémoire

| Fonction | Rôle |
|---|---|
| `N_EQUIX`, `N_VALIDES` | 60, et les n acceptés : 60, 64, 68, 72, 76, 80 |
| `memoirePourN(n)` | mémoire de travail du solveur par fil, en octets (le module ajoute ≈ 1,3 Mio) |
| `nPourMemoire(mio)` | plus grand n dont la mémoire de travail tient dans `mio` Mio (60 au minimum) |
| `tailleSolution(n)` | octets d’une solution rangée : n/4 + 1 (16 pour n = 60, 21 pour n = 80) |
| `tailleMaxPreuve(n, nombre)` | taille maximale d’une preuve, `nombre × (5 + n/4 + 1)` : refuser plus long avant tout calcul |
| `taillePreuve(compteurs, n)` | taille exacte de la preuve pour ces compteurs |
| `encoderPreuve(parts)` | assemble `{ compteur, solution }[]` en preuve (le module décode et vérifie) |
| `ModuleEquix.compteurs(preuve, nombre, n)` | compteurs d’une preuve, décodée sans être vérifiée, ou `null` si sa forme n’est pas la forme unique |
| `msParEssai(execution, n)` | durée de référence d’un essai (`wasmCompile`, `wasm`, `js`, `jsSansJit`) |
| `estimerDuree({ effort, nombre, execution, fils, n })` | durée probable d’une preuve, avant de calculer |
| `executionPrevue(options)` | exécution que `resoudre` emploiera avec ces options |

```ts
import { estimerDuree, executionPrevue, nPourMemoire, resoudre } from 'pow-equix-wasm'

const n = nPourMemoire(16)  // 72 : 15 Mio de travail par fil
const execution = executionPrevue({ octets }) ?? 'jsSansJit'
// Un essai coûte ≈ 8 fois plus qu’à n = 60 : réduire l’effort d’autant pour la même attente.
const attente = estimerDuree({ effort: 1, nombre: 4, execution, n })
const { parts } = await resoudre({ octets, graine, effort: 1, nombre: 4, n })
```

### Sans WebAssembly : repli en JavaScript et mode dégradé

`pow-equix-wasm/js` fournit le même module traduit en JavaScript pur par wasm2js
(binaryen) : mêmes preuves, octet pour octet, pour tous les n, mais bien plus
lent (il interprète toujours HashX : compiler demanderait `eval`). Il pèse
environ 150 Ko une fois minifié (37 Ko compressé), et n’a à être chargé que
s’il sert :

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
résout (`essayer`, interprété, et `essayerCompile`, compilé quand c’est
possible) et vérifie (`verifier(graine, parts, effort, nombre, n = 60)`).

| Un cœur, portable x86-64, n = 60 | Un essai | Ralentissement |
|---|---|---|
| WebAssembly, programmes HashX compilés (par défaut) | ≈ 35 ms (Chromium), 50 ms (Bun) | × 1 |
| WebAssembly, programmes HashX interprétés | ≈ 430 ms (Chromium, Bun) | ≈ × 12 |
| JavaScript avec JIT | ≈ 3,8 s (Chromium), 1,5 s (Node, Bun) | × 40 à × 110 |
| JavaScript sans JIT (Node `--jitless`) | ≈ 76 s | ≈ × 2 000 |

Désactiver WebAssembly s’accompagne presque toujours d’un JavaScript sans JIT
(Tor Browser en mode renforcé, mode Isolement d’iOS) : prévoir un avertissement
et une difficulté réaliste pour ces personnes.

### Côté serveur

```ts
import { readFile } from 'node:fs/promises'
import { ModuleEquix, construireGraine, depuisHexadecimal, tailleMaxPreuve } from 'pow-equix-wasm'

const module = await ModuleEquix.instancier(await readFile(new URL(import.meta.resolve('pow-equix-wasm/equix.wasm'))))
const graine = await construireGraine('mon-service/1', JSON.stringify(requeteSansPreuve))
const octets = depuisHexadecimal(preuve) ?? new Uint8Array()
// Refuser une entrée trop longue avant tout calcul, puis vérifier avec les mêmes effort, nombre et n que le solveur.
const valide = octets.length <= tailleMaxPreuve(60, 4) && module.verifier(graine, octets, 1, 4, 60)
// Détection de rejeu : l’empreinte de `octets` suffit, une preuve n’ayant qu’une forme d’octets.
```

La vérification coûte ≈ 0,2 ms par part quel que soit n : le programme HashX
du défi, puis huit évaluations interprétées et les contrôles de l’arbre.

Une page qui ne peut rien télécharger (ouverte en `file://`, script unique)
intègre le module en base64 avec `octetsEquix()` de `pow-equix-wasm/octets`.

Ce qui reste à la charge de l’appelant, et que le paquet ne fait pas :
refuser les preuves rejouées (l’empreinte des octets de la preuve y suffit,
chaque preuve n’ayant qu’une forme ; ou ses compteurs, `module.compteurs`), vérifier la fraîcheur de la requête (horodatage
dans le contenu haché) et limiter le débit des vérifications.

## Mesures

Portable AMD Ryzen 7 4700U (x86-64), session de bureau active, un cœur par
essai ; Chromium 153 sans interface, Bun 1.4.0, Rust 1.93.1 en natif
(`--release`). Quelques essais par ligne aux grands n : compter ± 10 %.
`bun run mesure`, `bun run mesure:navigateur` et
`cargo run --release -p pow-equix [--features compilateur] --example mesure`
les reproduisent.

| n | Mémoire de travail | Mémoire réelle du module | Preuve de 4 parts | Essai WebAssembly interprété (Chromium / Bun) | Essai WebAssembly compilé (Chromium / Bun) | Natif compilé | Natif interprété | Chromium compilé / natif compilé | Vérification d’une part |
|---|---|---|---|---|---|---|---|---|---|
| 60 | 1,8 Mio | 3,1 Mio | 68 o | 442 / 427 ms | 34 / 49 ms | 21 ms | 490 ms | × 1,6 | 0,18 ms |
| 64 | 3,8 Mio | 4,9 Mio | 72 o | 847 / 752 ms | 66 à 74 / 86 ms | 48 ms | 990 ms | × 1,4 à 1,5 | 0,16 ms |
| 68 | 7,6 Mio | 8,9 Mio | 76 o | 1,9 / 1,8 s | 155 / 158 ms | 88 ms | 1,9 s | × 1,8 | 0,16 ms |
| 72 | 15 Mio | 16,5 Mio | 80 o | 3,4 / 3,6 s | 271 à 288 / 287 ms | 177 ms | 3,9 s | × 1,5 à 1,6 | 0,18 ms |
| 76 | 30 Mio | 31,6 Mio | 84 o | 6,8 / 6,7 s | 557 à 569 / 595 ms | 356 ms | 8,0 s | × 1,6 | 0,16 ms |
| 80 | 63 Mio | 64,5 Mio | 88 o | 14,7 / 13,9 s | 1,24 à 1,30 / 1,23 s | 721 ms | 16,4 s | × 1,7 à 1,8 | 0,16 ms |

- Avant la compilation, l’écart entre le navigateur et un attaquant natif
  était de ≈ × 20 (430 ms contre 21 ms à n = 60) ; il est maintenant de
  × 1,4 à × 1,8 à tous les n.
- Détail d’un essai compilé à n = 60 dans Chromium : préparation (programme
  HashX, en Rust) 0,3 ms, génération du module 1,5 ms, compilation et
  instanciation 0,9 ms, remplissage de la table 24 ms, recherche 8 ms. En
  natif : table 15 ms, recherche 6 ms. À n = 80 : remplissage 766 ms et
  recherche 511 ms dans Chromium, contre 472 ms et 249 ms en natif.
- Appeler le module compilé par tranches (2 048 éléments par appel) plutôt
  qu’en une fois ne change rien sous V8, et gagne ≈ 20 % sous Bun
  (JavaScriptCore) : c’est le réglage retenu (`TRANCHE_REMPLISSAGE`).
- La mémoire réelle du module est celle de sa mémoire linéaire après un essai :
  mémoire de travail du solveur plus ≈ 1,3 Mio (pile, tas, tampon).

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
bun run check              # tests Rust et TS, construction, démo, reproductibilité
bun run demo               # construit puis sert la démo sur http://127.0.0.1:4600/
bun run mesure             # temps d’un essai par n, interprété et compilé, sous Bun
bun run mesure:navigateur  # la même chose dans Chromium sans interface
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

- `crates/pow-equix` : défi, solveur et vérificateur Equihash(n, 3) sur HashX
  en Rust ; réutilisable en natif (option `compilateur` pour générer du code
  machine HashX, par exemple dans une application Tauri).
- `crates/hashx` : copie de la crate `hashx` 0.9.1 d’Arti (paquet `pow-hashx`),
  identique à l’original sauf `src/expose.rs`, qui expose le programme
  généré, et deux ajustements de visibilité (voir son `Cargo.toml`).
- `crates/pow-equix-wasm` : interface C minimale vers WebAssembly, sans
  wasm-bindgen.
- `src/index.ts` : chargeur, deux moteurs, Web Workers, annulation,
  progression, estimations, vérification ; `src/compilation.ts` : génération
  des modules WebAssembly qui évaluent les programmes HashX.
- `demo/` : page de démo et de calibrage ; `scripts/mesurer.ts` : mesures
  sous Bun et dans Chromium.

## Licence

LGPL-3.0 (voir `LICENSE` et `COPYING`). Le module intègre une copie de la crate
`hashx` du projet [Arti](https://gitlab.torproject.org/tpo/core/arti) de Tor
(`crates/hashx`), elle-même sous LGPL-3.0, et son solveur reprend celui de la
crate `equix`, d’après les algorithmes de tevador.
