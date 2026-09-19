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
beaucoup plus vite que la personne honnête. Il faut aussi pouvoir la vérifier
avec très peu d'efforts.

Le coût d’**un essai** est propre à chaque algorithme ; la difficulté règle
ensuite le **nombre d’essais** à trouver.


| | | SHA-256 (hashcash) | Argon2id | **Equi-X** |
|---|---|---|---|---|
| | Mémoire nécessaire au calcul sans parallélisation | < 1 Kio | 64 Mio | réglable de 2 Mio à 64 Mio |
| | Vérifier une preuve : temps | 1 empreinte, ≈ 1 µs | **1 essai complet, ≈ 0,1 à 1 s** | **≈ 0,2 ms par part** |
| | Vérifier une preuve : mémoire | négligeable | **64 Mio par vérification** | négligeable |
| Combien de preuves pour que la durée du défi varie au plus, du simple au double, sur 80% des cas | | x | y | z |
| | Taille des preuves | x*h=?? | y*h=?? | z*h=?? |
| | **Temps pour vérifier** les preuves du défi | ?? | ?? | ?? |
| | **Mémoire pour vérifier** les preuves du défi | négligeable | **64 Mio par vérification** | négligeable |
| Combien de défis visant ≈ 1 s résolu en 100 s | | {réglage pour sha256} | {réglage pour Argon2id} | {réglage pour EquiHash n=80 ou 72 ou 60, ce qui devrait minimise le plus l'écart entre toutes les config suivante} |
| | sur un PC de 2020 {PROC, GPU, RAM} | ?? | ?? | ?? |
| | sur un MacPro de ?? {modèle, PROC, GPU, RAM} | ?? | ?? | ?? |
| | sur un Mobile de ?? {modèle, PROC, GPU, RAM} | ?? | ?? | ?? |
| | sur un Mobile de ?? {modèle, PROC, GPU, RAM} | ?? | ?? | ?? |
| | avec 10_000€ de materiel optimisé SHA256 {ASIC, PROC, GPU, RAM} | ?? | ?? | ?? |
| | avec 10_000€ de materiel optimisé Equi-X {Supercalculateur/grosse machine, PROC, GPU, RAM} | ?? | ?? | ?? |
| | avec 1_000_000€ de materiel optimisé SHA256 {ASIC, PROC, GPU, RAM} | ?? | ?? | ?? |
| | avec 1_000_000€ de materiel optimisé Equi-X {Supercalculateur/grosse machine, PROC, GPU, RAM} | ?? | ?? | ?? |
| Écart en **sénario d'usage**, du pire au meilleur  | | × 10³ à × 10⁷ | × 2 à × 5 | **≈ × 1,6** |
| Écart en **sénario d'attaque**, du pire au meilleur  | | × 10³ à × 10⁷ | × 2 à × 5 | **≈ × 1,6** |
| Résistance au **sénario d'attaque DoS** (vérification par seconde {sur le macPro testé})  | | × 10³ à × 10⁷ | × 2 à × 5 | **≈ × 1,6** |

¹ les chiffres suivi de "¹" sont de estimation extrapolée des caractéristiques materielles. Ceux sans "¹" on été mesuré grace à la page de démo.

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

`resoudre` confie les compteurs à des Web Workers créés depuis un Blob (aucun
fichier supplémentaire à publier) : le fil principal les distribue un par un,
chaque résultat valant demande du suivant, si bien que des fils peuvent
s’ajouter en cours de calcul sans trou ni doublon. Par défaut, un fil par cœur
annoncé, huit au plus, et jamais plus que d’essais attendus (`filsConseilles`).
Si les Web Workers sont refusés, le calcul continue sur le fil courant.
`fils: 0` force ce mode. La progression donne le moteur, le mode (compilé ou
interprété), n, les Web Workers actifs (`filsActifs`), les essais, les parts
trouvées, le temps écoulé, une estimation du temps restant mesurée sur
l’appareil, la mémoire réelle des modules et les durées moyennes des phases
d’un essai (`phasesMoyennes`, aussi dans le résultat). L’annulation, la progression et
les Web Workers fonctionnent dans les deux modes ; si la compilation d’un
programme échoue, l’interprète termine l’essai et prend le relais
(`resultat.compilation` vaut alors `false`).

#### Nombre de fils adaptatif (recommandé pour le web grand public)

Sur un téléphone, trop de Web Workers × la mémoire de chacun peut faire tuer
l’onglet, sans erreur que la page puisse rattraper, et
`navigator.deviceMemory` n’existe que dans Chromium. `fils` accepte donc aussi
une **politique** : une fonction appelée au départ puis après chaque essai
terminé, avec `{ essaisTermines, dureePremierEssaiMs, dureeMoyenneEssaiMs,
filsActifs, n, execution }`, qui renvoie le nombre de fils voulu. Seule une
hausse est appliquée (aucun fil n’est arrêté en plein essai), jamais au-delà
des essais restants attendus ; si la création d’un fil supplémentaire échoue
(exception, mémoire, Web Worker en erreur avant tout résultat), le calcul
continue avec les fils existants, le compteur confié est redistribué, et plus
aucun fil n’est créé.

```ts
import { filsAdaptatifs, resoudre } from 'pow-equix-wasm'

const { parts, fils } = await resoudre({
  octets, graine, effort: 1, nombre: 4,
  fils: filsAdaptatifs(),  // 1 fil, puis jusqu’à 8 si l’appareil semble costaud
  chargerJs: () => import('pow-equix-wasm/js'),
  onProgression: ({ filsActifs }) => { /* 1 → 2 → 4… */ },
})
// `fils` : le plus grand nombre de Web Workers en service à la fois.
```

`filsAdaptatifs(options?)` décide ainsi (seuils dans `SEUILS_FILS_ADAPTATIFS`,
chacun surchargeable par les options, comme `memoireAppareilGo`, `coeurs` et
`ecranPx` pour simuler un profil) :

| Situation | Fils |
|---|---|
| `navigator.deviceMemory` connu | d’emblée `floor(Go × 1024 × partMemoire / Mio par fil)` (`partMemoire` = 1/32), au moins 1, au plus le nombre de cœurs (`hardwareConcurrency`), qui peut dépasser 8 |
| sinon, avant le premier essai | 1 |
| r > 2,5 (lent) ou écran < 1 280 px physiques | 1 |
| r < 1,3 (rapide) et écran ≥ 1 920 px physiques | jusqu’à 8 |
| entre les deux | 2 si r > 2, sinon 4 (écran inconnu : compté comme moyen) |

r est la durée moyenne de calcul d’un essai divisée par la durée de référence
pour ce n et cette exécution (`msParEssai`). Chaque Web Worker mesure lui-même
cette durée, du début de l’essai à la fin de la recherche (compilation du
programme HashX comprise), sans l’instanciation du module ni l’attente des
messages ; le premier essai de chaque fil, ralenti par la mise en température
du JIT, est écarté de la moyenne dès qu’un essai suivant est connu. Sur une
machine déjà chargée, r augmente et la politique monte moins haut : c’est voulu ; l’écran est son plus grand côté
× `devicePixelRatio`. Sans mémoire connue, toujours au plus 8 (`filsMax`) et le
nombre de cœurs ; avec la mémoire et les cœurs connus, le plafond est
`min(cœurs, plafond mémoire)`, au-delà de 8 s’il le faut. Le défaut
reste le nombre fixe de `filsConseilles`, pour la compatibilité.
`travailleurEquix` est la fabrique de Web Worker employée par défaut, à
réutiliser pour les envelopper (`creerTravailleur`).

#### Phases d’un essai et exécution effective

Chaque essai mesure ses phases là où il s’exécute (Web Worker ou fil courant),
sans l’instanciation du module ni l’attente des messages :

| Champ de `PhasesEssai` | Phase |
|---|---|
| `preparationMs` | programme HashX du défi et préparation de la mémoire (Rust) |
| `generationMs` | génération du module WebAssembly qui évalue le programme (0 si interprété) |
| `compilationMs` | compilation et instanciation de ce module (0 si interprété) |
| `remplissageMs` | table des valeurs HashX, compilée ou interprétée |
| `rechercheMs` | recherche des collisions et règle d’effort |
| `totalMs` | essai complet |

`progression.phasesMoyennes` et `resultat.phasesMoyennes` en donnent la moyenne
sur un fil ; `ModuleEquix.phases`, celles du dernier essai.
`executionEstimee({ moteur, compilation, n, dureeEssaiMs })` en déduit
l’exécution effective (`wasmCompile`, `wasm`, `js`, `jsSansJit`) ; en
JavaScript, la présence du JIT n’est pas observable : elle est **estimée**
d’après la durée d’un essai, sous `SEUIL_JIT_MS` (≈ 17 s à n = 60, moyenne
géométrique des références avec et sans JIT, × `FACTEUR_DUREE_N` selon n).

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
≈ 620 Ko bruts, ≈ 150 Ko minifié (37 Ko compressé) : il ne doit être
téléchargé que s’il sert. Façon recommandée : le confier à `resoudre` par
`chargerJs`, un chargeur que le paquet n’appelle que si WebAssembly est
indisponible **ou échoue** (compilation ou instanciation refusées, par exemple
par une politique sans `'wasm-unsafe-eval'`, mémoire insuffisante, Web Worker
en échec avant tout résultat). Le calcul reprend alors avec le moteur
JavaScript ; une annulation, elle, ne déclenche jamais le repli.

```ts
import { estimerDuree, ralentissement, resoudre, webAssemblyDisponible } from 'pow-equix-wasm'

if (!webAssemblyDisponible()) {
  // Sans WebAssembly, le JIT est en général coupé aussi : hypothèse prudente.
  const attente = estimerDuree({ effort: 1, nombre: 4, execution: 'jsSansJit' })
  if (attente > 5_000) avertir(`Active WebAssembly pour valider environ ${Math.round(ralentissement('jsSansJit'))} fois plus vite.`)
}
const resultat = await resoudre({
  octets, graine, effort: 1, nombre: 4, onProgression,
  chargerJs: () => import('pow-equix-wasm/js'),  // téléchargé seulement en cas de besoin
})
// resultat.moteur vaut 'js' en mode dégradé, et resultat.repli en dit la raison :
// { raison: 'indisponible' } ou { raison: 'echec', message } (aussi dans la progression).
```

Le bundle principal (`dist/index.js`) n’importe jamais statiquement le moteur
JavaScript ni le module en base64 (un test le vérifie) : c’est le `import()`
dynamique de `chargerJs` qui en fait un morceau à part pour le bundler. Qui
l’importe déjà lui-même peut passer la fabrique par `js: creerExportsEquixJs`.
Côté client, `ModuleEquix.charger({ octets, chargerJs })` donne de même un
module pour vérifier, WebAssembly d’abord.

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

## Banc comparatif (démo)

Le tableau de [Pourquoi Equi-X](#pourquoi-equi-x) se remplit avec un banc
standardisé, qui fait partie de la démo seulement (rien n’en entre dans
`dist/` ni dans les dépendances du paquet) : <https://contribulibre.github.io/pow-equix-wasm/fr/banc/>
(`/en/banc/` en anglais), lien « Banc comparatif » depuis la démo.

- **Moteurs** : SHA-256 en hashcash (bits nuls en tête de
  `SHA-256(graine ‖ nonce)`) par une boucle JavaScript spécialisée
  (`demo/banc/sha256.ts` : état intermédiaire du préfixe, seul le bloc du nonce
  recalculé ; ≈ 1 µs par empreinte contre ≈ 3,5 µs avec hash-wasm appelé par
  empreinte et ≈ 5 µs avec WebCrypto, asynchrone, mesuré sous Bun) ;
  Argon2id par hash-wasm (en `devDependencies`, version figée ; m, t, p
  réglables, un essai = une empreinte de `graine ‖ nonce`, réussi selon les
  bits nuls en tête) ; Equi-X par la bibliothèque elle-même. Tous en plusieurs
  parts, sur 1 à N Web Workers, annulables, avec progression.
- **Fichier de scénarios** (`pow-equix-wasm/banc-scenarios`, modifiable dans la
  page, importable et exportable tel quel) : durée cible d’un défi
  (`dureeCibleMs`, médiane visée), durée de la mesure du débit maximal
  (`dureeDebitMs`), machine de référence du calibrage, et scénarios
  `{ id, libelle, algorithme, parametres, parts, difficulte, fils,
  sansParallelisation, repetitions }`. Son empreinte (SHA-256) identifie les
  résultats. Valeurs par défaut arbitrées : défi visé ≈ 1 s (médiane, tous
  les cœurs, sur le PC de référence), 80 % des défis dans un rapport ≤ 2 ;
  SHA-256 13 parts de 19 bits ; Argon2id 16 Mio 12 parts de 2 bits et 64 Mio
  5 parts de 1 bit (t = 1, p = 1 : sa mémoire se règle, comme celle
  d’Equi-X) ; Equi-X n = 60 13 parts d’effort 33, n = 72 7 parts d’effort 7,
  n = 80 3 parts d’effort 2 (≈ 1,3 s, gardé au-dessus de la cible, avec un
  plancher de difficulté). La durée de mesure du débit reste provisoire.
- **Mode « calibrer »** (PC de référence seulement, tous les cœurs) : pour
  chaque scénario, la difficulté (issue de la simulation) est ajustée sur des
  défis réels jusqu’à ce que la médiane approche 1 s, sans descendre sous son
  plancher ; le nombre de parts ne change que si p90/p10 dépasse 2 sur 30
  défis de contrôle. Le résultat est figé dans le fichier de scénarios (avec la
  machine, la date, la médiane et p90/p10 obtenus), que les autres machines
  importent tel quel. SHA-256 et Argon2id ne se règlent que par bits entiers :
  leur médiane reste à un facteur √2 près de la cible.
- **Fils** : tous les cœurs par défaut (`hardwareConcurrency`, au-delà de 8
  si la machine en a), un seul pour les lignes `sansParallelisation` (latence
  comme débit). Pour Argon2id et Equi-X, deux protections contre un onglet tué
  par manque de mémoire :
  - si `navigator.deviceMemory` est connu, au plus 1/32 de cette mémoire ;
  - toujours, un **garde-fou par paliers** : le banc monte à 1, 2, 4, 8…
    fils jusqu’aux cœurs, en notant dans `localStorage`, pour chaque réglage
    mémoire (`argon2id:m=…`, `equix:n=…`), « tentative à N fils » avant de
    lancer un palier ou un scénario, et « N fils réussis » après. Un onglet
    tué ne peut rien signaler : au chargement suivant, une tentative restée
    ouverte est prise pour un plantage, et ce réglage est limité, sur cet
    appareil, au dernier palier réussi en dessous. La limite ne se lève que
    par le bouton prévu. L’export consigne les paliers, la limite et sa raison
    (`gardeFils`, `plafond`), et l’agrégation les signale.
- **Par scénario** : au moins 100 répétitions (un mode rapide, 10, marque les
  résultats comme non représentatifs). Chaque répétition est un défi seul
  sur tous les fils permis, ce que vit l’utilisateur (**latence**) : durée,
  essais, mémoire (mesurée pour Equi-X, estimée pour Argon2id et SHA-256),
  taille de la preuve, puis vérification (temps, mémoire, validité).
  **Statistiques** : médiane, moyenne, p5, p10, p90, p95, min, max, rapport
  p90/p10 (critère de régularité : ≤ 2, soit 80 % des défis « du simple au
  double ») et p95/p5 pour information. Puis le **débit maximal** de l’appareil : autant de défis en
  parallèle que de fils permis, un fil chacun (sans les essais perdus d’un
  défi court réparti sur plusieurs fils), enchaînés pendant `dureeDebitMs`,
  ramenés à « défis résolus en 100 s » (mesure directe si `dureeDebitMs`
  vaut 100 000).
- **Reprise** : chaque défi terminé est enregistré dans `localStorage` (par
  appareil, fichier de scénarios et mode), comme le fichier de scénarios et la
  fiche saisie ; après un plantage, relancer reprend où le banc s’était arrêté.
  Au plus 3 tentatives par scénario (un plantage ou une erreur en consomme
  une, pas une annulation), puis le scénario est marqué incomplet et le banc
  passe au suivant. Export partiel à tout moment ; bouton pour effacer les
  résultats stockés.
- **Débit de vérification** : parts valides vérifiées par seconde, par
  configuration, sur 1 fil et sur tous les cœurs (résistance au déni de service).
- **Fiche de l’appareil** : navigateur, cœurs, `deviceMemory`, écran détectés,
  champs libres (modèle, processeur, GPU, RAM, remarques), et **fiche machine
  par commande** : `scripts/config-machine/` (aussi montrés dans la page, avec
  un bouton copier) écrit `config-machine.json` dans le dossier courant et
  l’affiche, sans rien envoyer sur le réseau — modèle de la machine,
  processeur, fréquence maximale et état du turbo, cœurs physiques et
  logiques, mémoire vive, GPU, système. `linux.sh` (bash ou zsh : `/proc`,
  `/sys`, `lscpu`, `lspci` s’il est là), `macos.sh` (`sysctl`,
  `system_profiler`, `sw_vers`), `windows.ps1` (PowerShell 5 ou 7,
  `Get-CimInstance`), `android-termux.sh` (Termux : `getprop`, `/proc`). La
  fiche s’importe (fichier ou collage) dans la page du banc et part avec
  l’export ; sans terminal, la saisie du modèle suffit.
- **Estimation** de la durée totale avant de lancer, d’après des références,
  puis d’après une mesure de vitesse de quelques secondes sur l’appareil.
- **Export** JSON complet, schéma `pow-equix-wasm/banc` version 3 (fiche
  machine et garde-fou ; la version 2 reste lisible), décrit par les types de
  `demo/banc/schema.ts`. `bun scripts/agreger-banc.ts fichiers.json…
  [--attaque materiels.json] [--json]` en réunit plusieurs et produit un
  tableau des appareils (processeur, fréquence, cœurs, RAM, GPU, système,
  limites de fils), des appareils nommés comme les lignes du tableau
  (« modèle {processeur, RAM, GPU} »), et les lignes du tableau : débit maximal par appareil (et latence à
  part), écart d’usage (meilleur appareil ÷ plus faible), écarts d’attaque
  pour chaque matériel du fichier `--attaque` (format
  `pow-equix-wasm/banc-attaque`, débits extrapolés à 10 000 € et 1 000 000 €),
  rapportés au pire appareil et à l’appareil médian, et résistance au déni de
  service (vérifications par seconde, tous les cœurs).
- **Banc natif** (sans navigateur, pour les extrapolations) :
  `cargo run --release -p pow-equix --features compilateur --example mesure --
  20 --n 60,72,80 --execution compile,interprete --fils 1,8 --json` : essais
  par seconde par fil et au total, décomposés, et vérification par part, une
  ligne JSON (`pow-equix-wasm/banc-natif`) par mesure.

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
- `demo/` : page de démo et de calibrage, une seule page pour deux langues
  (`modele.html` rempli à la construction avec `textes.ts`, `/fr/` et `/en/`,
  accueil qui redirige selon `navigator.languages`) ; réglages et mesures
  téléchargeables en JSON, réglages réimportables ; `scripts/mesurer.ts` : mesures
  sous Bun et dans Chromium.

## Licence

LGPL-3.0 (voir `LICENSE` et `COPYING`). Le module intègre une copie de la crate
`hashx` du projet [Arti](https://gitlab.torproject.org/tpo/core/arti) de Tor
(`crates/hashx`), elle-même sous LGPL-3.0, et son solveur reprend celui de la
crate `equix`, d’après les algorithmes de tevador.
