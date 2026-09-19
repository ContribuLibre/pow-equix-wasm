// Textes de la démo, en français et en anglais. La page est la même pour les
// deux langues : scripts/construire-demo.ts remplit le modèle HTML avec
// `page` (clés {{…}}), et demo.ts emploie `dynamique` pour ce qu’il écrit.

export type Langue = 'fr' | 'en'
export const LANGUES: readonly Langue[] = ['fr', 'en']

export interface Textes {
  /** Textes fixes de la page, insérés à la construction (HTML permis). */
  page: Record<string, string>
  /** Format des nombres. */
  locale: string
  unites: { octets: string; kio: string; mio: string; go: string }
  dynamique: {
    coeurs: string
    memoireAppareil: string
    memoireAppareilValeur: (go: number) => string
    nonCommuniquee: string
    inconnu: string
    webAssembly: string
    disponible: string
    indisponible: string
    navigateur: string
    // Prévisions
    taillePreuve: string
    taillePreuveValeur: (octets: number, plus: number | null, pourcentage: string | null) => string
    reussite: string
    essaisAttendus: string
    essaisAttendusValeur: (essais: string) => string
    executionPrevue: string
    aucuneExecution: string
    plusLentQueCompile: (facteur: string) => string
    dureeEssai: string
    dureeEssaiValeur: (duree: string) => string
    parallelisation: string
    parallelisationAdaptative: string
    parallelisationMemoire: (fils: number) => string
    parallelisationFixe: (fils: number) => string
    dureeEstimee: string
    dureeAvecFils: (duree: string, fils: number) => string
    memoireParFil: string
    memoireParFilValeur: (total: string, travail: string) => string
    memoireTotale: string
    memoireTotaleValeur: (total: string, fils: number) => string
    verificationEstimee: string
    verificationEstimeeValeur: (duree: string) => string
    dureeDerniereMesure: string
    dureeDerniereMesureValeur: (duree: string, fils: number, essai: string) => string
    // Progression
    moteur: string
    moteurProgression: (wasm: boolean, compile: boolean) => string
    repli: string
    repliIndisponible: string
    repliEchec: (message: string) => string
    parametre: string
    filsActifs: string
    filsActifsValeur: (fils: number, evolution: string | null) => string
    filPrincipal: string
    partsTrouvees: string
    essais: string
    tempsEcoule: string
    tempsRestant: string
    memoireReelle: string
    preuveEnCours: (rang: number, total: number) => string
    mesureVerification: string
    termine: string
    annule: string
    erreur: (message: string) => string
    // Mesures
    preuvesMesurees: string
    preuvesMesureesValeur: (faites: number, total: number) => string
    dureeMediane: string
    centile90: string
    auMoinsTrois: string
    moyenne: string
    minMax: string
    essaisParPreuve: string
    essaisParPreuveValeur: (mesures: string, attendus: string) => string
    dureeEssaiUnFil: string
    detailEssai: (duree: string, execution: string, compilation: string | null, reference: string) => string
    webWorkers: string
    webWorkersValeur: (fils: number) => string
    memoireModule: string
    memoireModuleValeur: (total: string, parFil: string | null) => string
    executions: Record<'wasmCompile' | 'wasm' | 'js' | 'jsSansJit', string>
    estimationJit: (seuil: string) => string
    parVerification: string
    parPart: string
    tailleMesuree: (mesuree: number, prevue: number) => string
    verificationAttendue: string
    verificationIncoherente: string
    // Fichiers
    copie: string
    reglagesImportes: (nom: string) => string
    erreurImport: (message: string) => string
    erreurs: {
      json: string
      objet: string
      format: (format: string) => string
      champInconnu: (champ: string) => string
      valeur: (champ: string, attendu: string) => string
      entier: (min: number, max: number) => string
      parmi: (valeurs: string) => string
    }
  }
}

const fr: Textes = {
  locale: 'fr-FR',
  unites: { octets: 'octets', kio: 'Kio', mio: 'Mio', go: 'Go' },
  page: {
    titre: 'PoW Equi-X en WebAssembly — démo et calibrage',
    titreCourt: 'PoW Equi-X en WebAssembly',
    description: 'Mesurer sur son appareil le temps et la mémoire d’une preuve de travail Equi-X, et le coût de sa vérification.',
    intro: 'Preuve de travail <strong>Equi-X</strong> (celle de Tor) : un seul module résout dans le navigateur et vérifie côté serveur, avec un repli en JavaScript pur quand WebAssembly est désactivé. Cette page mesure, sur <em>cet</em> appareil, ce que coûte une preuve pour choisir les seuils de difficulté.',
    codeSource: 'Code source',
    paquetNpm: 'Paquet npm',
    autreLangue: 'English',
    autreLangueTitre: 'Same page in English, with the current settings',
    appareil: 'Appareil',
    alerteWasm: 'WebAssembly est indisponible dans ce navigateur (mode renforcé, isolement, JIT désactivé…) : seul le moteur JavaScript peut calculer ici, bien plus lentement.',
    reglages: 'Réglages',
    effort: 'Effort par part',
    effortAide: 'Une solution Equi-X sur « effort » est retenue.',
    nombre: 'Nombre de parts',
    nombreAide: 'Plusieurs petites preuves rendent l’attente plus régulière.',
    memoire: 'Mémoire par fil',
    memoireAide: 'Equihash(n, 3) sur HashX : chaque pas double la mémoire et le temps d’un essai. Le serveur doit vérifier avec le même n.',
    n60: '1,8 Mio — n = 60 (Equi-X)',
    n64: '3,8 Mio — n = 64',
    n68: '7,6 Mio — n = 68',
    n72: '15 Mio — n = 72',
    n76: '30 Mio — n = 76',
    n80: '63 Mio — n = 80',
    programmes: 'Programmes HashX',
    programmesAuto: 'Compilés en WebAssembly (par défaut)',
    programmesJamais: 'Interprétés',
    programmesAide: 'Compiler chaque programme rend un essai plus de dix fois plus rapide en WebAssembly.',
    repartition: 'Répartition',
    repartitionFixe: 'Nombre de fils fixe',
    repartitionAdaptatif: 'Adaptative : 1 fil, puis plus si l’appareil semble suffisamment puissant',
    repartitionAide: 'Adaptative (<code>filsAdaptatifs</code>) : conseillée pour le web grand public, où trop de fils peut faire tuer l’onglet d’un téléphone.',
    fils: 'Web Workers',
    filsAide: 'Nombre fixe, prérempli comme le paquet : autant que de cœurs, sans dépasser les essais attendus. 0 : fil principal.',
    moteur: 'Moteur',
    moteurAuto: 'Automatique (WebAssembly, sinon JavaScript)',
    moteurWasm: 'WebAssembly',
    moteurJs: 'JavaScript pur (repli)',
    moteurAide: 'Le moteur JavaScript donne les mêmes preuves, plus lentement.',
    repetitions: 'Répétitions',
    repetitionsAide: 'Le temps est aléatoire : médiane et 90ᵉ centile demandent plusieurs mesures.',
    verifications: 'Vérifications',
    verificationsAide: 'Mesurées dès la première preuve, sur celle-ci.',
    lancer: 'Lancer',
    annuler: 'Annuler',
    fichierReglages: 'Pour refaire exactement le même test sur plusieurs appareils :',
    exporterReglages: 'Télécharger les réglages',
    importerReglages: 'Importer des réglages…',
    previsions: 'Prévisions',
    previsionsAide: 'Connues avant tout calcul, d’après les réglages et les mesures de référence du paquet (portable x86-64 récent, un cœur).',
    progression: 'Progression',
    resultats: 'Mesures sur cet appareil',
    resultatsAide: 'Complétées à chaque preuve terminée.',
    calcul: 'Calcul de la preuve',
    colRang: 'n°',
    colMoteur: 'Moteur',
    colN: 'n',
    colDuree: 'Durée',
    colEssais: 'Essais',
    colEssaisParSeconde: 'Essais/s',
    colMemoire: 'Mémoire',
    verification: 'Vérification',
    exporter: 'Exporter',
    exporterAide: 'Pour comparer plusieurs appareils, garde ces mesures (avec l’appareil et les réglages, réimportables) :',
    copier: 'Copier le JSON',
    telecharger: 'Télécharger le JSON',
  },
  dynamique: {
    coeurs: 'Cœurs annoncés',
    memoireAppareil: 'Mémoire de l’appareil',
    memoireAppareilValeur: (go) => `≥ ${go} Go`,
    nonCommuniquee: 'non communiquée',
    inconnu: 'inconnu',
    webAssembly: 'WebAssembly',
    disponible: 'disponible',
    indisponible: 'indisponible',
    navigateur: 'Navigateur',
    taillePreuve: 'Taille de la preuve',
    taillePreuveValeur: (octets, plus, pourcentage) => (plus === null ? `${octets} octets` : `${octets} octets ; ${plus} ou plus dans ≈ ${pourcentage} % des cas (un écart de compteur dépasse 127)`),
    reussite: 'Réussite d’un essai',
    essaisAttendus: 'Essais attendus',
    essaisAttendusValeur: (essais) => `${essais} en moyenne par preuve`,
    executionPrevue: 'Exécution prévue',
    aucuneExecution: 'aucune : WebAssembly indisponible',
    plusLentQueCompile: (facteur) => `, ${facteur} × plus lent que compilé`,
    dureeEssai: 'Durée d’un essai',
    dureeEssaiValeur: (duree) => `≈ ${duree} sur un cœur`,
    parallelisation: 'Parallélisation',
    parallelisationAdaptative: 'adaptative : 1 fil au départ, puis jusqu’à 8 si l’appareil semble suffisamment puissant (davantage si ses caractéristiques matérielles sont connues)',
    parallelisationMemoire: (fils) => `adaptative : ${fils} fil(s) d’emblée, d’après la mémoire et les cœurs annoncés par l’appareil`,
    parallelisationFixe: (fils) => fils === 0 ? 'aucune : calcul sur le fil principal' : `${fils} fil(s)`,
    dureeEstimee: 'Durée estimée',
    dureeAvecFils: (duree, fils) => `${duree} avec ${fils} fil(s)`,
    memoireParFil: 'Mémoire par fil',
    memoireParFilValeur: (total, travail) => `≈ ${total} (${travail} de travail + module)`,
    memoireTotale: 'Mémoire totale',
    memoireTotaleValeur: (total, fils) => `≈ ${total} pour ${fils} fil(s) actif(s)`,
    verificationEstimee: 'Vérification estimée',
    verificationEstimeeValeur: (duree) => `≈ ${duree} par preuve, quel que soit n`,
    dureeDerniereMesure: 'Durée d’après la dernière mesure',
    dureeDerniereMesureValeur: (duree, fils, essai) => `${duree} avec ${fils} fil(s), d’après un essai mesuré de ${essai} sur un fil`,
    moteur: 'Moteur',
    moteurProgression: (wasm, compile) => (wasm ? `WebAssembly, programmes ${compile ? 'compilés' : 'interprétés'}` : 'JavaScript'),
    repli: 'Repli',
    repliIndisponible: 'WebAssembly indisponible',
    repliEchec: (message) => `WebAssembly en échec : ${message}`,
    parametre: 'Paramètre',
    filsActifs: 'Web Workers actifs',
    filsActifsValeur: (fils, evolution) => (evolution ? `${fils} (évolution : ${evolution})` : String(fils)),
    filPrincipal: 'aucun : fil principal',
    partsTrouvees: 'Parts trouvées',
    essais: 'Essais',
    tempsEcoule: 'Temps écoulé',
    tempsRestant: 'Temps restant estimé',
    memoireReelle: 'Mémoire réelle des modules',
    preuveEnCours: (rang, total) => `Preuve ${rang} sur ${total}…`,
    mesureVerification: 'Mesure de la vérification…',
    termine: 'Terminé.',
    annule: 'Calcul annulé.',
    erreur: (message) => `Erreur : ${message}`,
    preuvesMesurees: 'Preuves mesurées',
    preuvesMesureesValeur: (faites, total) => `${faites} sur ${total}`,
    dureeMediane: 'Durée médiane',
    centile90: '90ᵉ centile',
    auMoinsTrois: 'au moins 3 preuves nécessaires',
    moyenne: 'Moyenne',
    minMax: 'Min – max',
    essaisParPreuve: 'Essais par preuve',
    essaisParPreuveValeur: (mesures, attendus) => `${mesures} mesurés, ${attendus} attendus`,
    dureeEssaiUnFil: 'Durée d’un essai (un fil)',
    detailEssai: (duree, execution, compilation, reference) => `${duree} (${execution}${compilation ? `, dont ${compilation} de compilation des programmes HashX` : ''}) ; référence : ${reference}`,
    webWorkers: 'Web Workers',
    webWorkersValeur: (fils) => `au plus ${fils} à la fois`,
    memoireModule: 'Mémoire du module',
    memoireModuleValeur: (total, parFil) => `${total} au total${parFil ? `, ${parFil} par fil actif` : ''}`,
    executions: { wasmCompile: 'Wasm complet', wasm: 'Wasm + interprète', js: 'JS avec JIT *', jsSansJit: 'JS pur *' },
    estimationJit: (seuil) => `* Estimation : le JIT n’est pas observable, il est déduit de la vitesse (un essai JavaScript en moins de ${seuil} à n = 60 suppose un JIT).`,
    parVerification: 'Par vérification',
    parPart: 'Par part',
    tailleMesuree: (mesuree, prevue) => `${mesuree} octets mesurés (${prevue} prévus)`,
    verificationAttendue: 'mesurée dès la fin de la première preuve',
    verificationIncoherente: 'Une preuve calculée n’a pas été vérifiée : module ou chargeur incohérent.',
    copie: 'Copié ✓',
    reglagesImportes: (nom) => `Réglages importés de « ${nom} ».`,
    erreurImport: (message) => `Fichier de réglages refusé : ${message}`,
    erreurs: {
      json: 'ce n’est pas du JSON valide.',
      objet: 'un objet JSON est attendu.',
      format: (format) => `format « ${format} » inconnu (attendu : pow-equix-wasm/reglages ou pow-equix-wasm/mesures).`,
      champInconnu: (champ) => `champ inconnu « ${champ} ».`,
      valeur: (champ, attendu) => `« ${champ} » doit être ${attendu}.`,
      entier: (min, max) => `un entier de ${min} à ${max}`,
      parmi: (valeurs) => `l’une de ces valeurs : ${valeurs}`,
    },
  },
}

const en: Textes = {
  locale: 'en-GB',
  unites: { octets: 'bytes', kio: 'KiB', mio: 'MiB', go: 'GB' },
  page: {
    titre: 'Equi-X PoW in WebAssembly — demo and calibration',
    titreCourt: 'Equi-X PoW in WebAssembly',
    description: 'Measure on your own device the time and memory of an Equi-X proof of work, and the cost of verifying it.',
    intro: '<strong>Equi-X</strong> proof of work (the one Tor uses): a single module solves in the browser and verifies on the server, with a pure-JavaScript fallback when WebAssembly is disabled. This page measures, on <em>this</em> device, what a proof costs, to choose difficulty thresholds.',
    codeSource: 'Source code',
    paquetNpm: 'npm package',
    autreLangue: 'Français',
    autreLangueTitre: 'La même page en français, avec les réglages en cours',
    appareil: 'Device',
    alerteWasm: 'WebAssembly is unavailable in this browser (hardened mode, lockdown, JIT disabled…): only the JavaScript engine can compute here, much more slowly.',
    reglages: 'Settings',
    effort: 'Effort per part',
    effortAide: 'One Equi-X solution in “effort” is kept.',
    nombre: 'Number of parts',
    nombreAide: 'Several small proofs make the wait more regular.',
    memoire: 'Memory per thread',
    memoireAide: 'Equihash(n, 3) over HashX: each step doubles the memory and the time of an attempt. The server must verify with the same n.',
    n60: '1.8 MiB — n = 60 (Equi-X)',
    n64: '3.8 MiB — n = 64',
    n68: '7.6 MiB — n = 68',
    n72: '15 MiB — n = 72',
    n76: '30 MiB — n = 76',
    n80: '63 MiB — n = 80',
    programmes: 'HashX programs',
    programmesAuto: 'Compiled to WebAssembly (default)',
    programmesJamais: 'Interpreted',
    programmesAide: 'Compiling each program makes an attempt over ten times faster in WebAssembly.',
    repartition: 'Parallelism',
    repartitionFixe: 'Fixed number of threads',
    repartitionAdaptatif: 'Adaptive: 1 thread, then more if the device seems powerful enough',
    repartitionAide: 'Adaptive (<code>filsAdaptatifs</code>): recommended for the general public web, where too many threads can get a phone tab killed.',
    fils: 'Web Workers',
    filsAide: 'Fixed number, prefilled like the package: one per core, no more than the expected attempts. 0: main thread.',
    moteur: 'Engine',
    moteurAuto: 'Automatic (WebAssembly, else JavaScript)',
    moteurWasm: 'WebAssembly',
    moteurJs: 'Pure JavaScript (fallback)',
    moteurAide: 'The JavaScript engine gives the same proofs, more slowly.',
    repetitions: 'Repetitions',
    repetitionsAide: 'Time is random: median and 90th percentile need several measurements.',
    verifications: 'Verifications',
    verificationsAide: 'Measured on the first proof, as soon as it is found.',
    lancer: 'Start',
    annuler: 'Cancel',
    fichierReglages: 'To run exactly the same test on several devices:',
    exporterReglages: 'Download settings',
    importerReglages: 'Import settings…',
    previsions: 'Forecasts',
    previsionsAide: 'Known before any computation, from the settings and the package’s reference measurements (recent x86-64 laptop, one core).',
    progression: 'Progress',
    resultats: 'Measurements on this device',
    resultatsAide: 'Updated after each proof.',
    calcul: 'Computing the proof',
    colRang: '#',
    colMoteur: 'Engine',
    colN: 'n',
    colDuree: 'Duration',
    colEssais: 'Attempts',
    colEssaisParSeconde: 'Attempts/s',
    colMemoire: 'Memory',
    verification: 'Verification',
    exporter: 'Export',
    exporterAide: 'To compare several devices, keep these measurements (with the device and the settings, which can be imported again):',
    copier: 'Copy JSON',
    telecharger: 'Download JSON',
  },
  dynamique: {
    coeurs: 'Announced cores',
    memoireAppareil: 'Device memory',
    memoireAppareilValeur: (go) => `≥ ${go} GB`,
    nonCommuniquee: 'not disclosed',
    inconnu: 'unknown',
    webAssembly: 'WebAssembly',
    disponible: 'available',
    indisponible: 'unavailable',
    navigateur: 'Browser',
    taillePreuve: 'Proof size',
    taillePreuveValeur: (octets, plus, pourcentage) => (plus === null ? `${octets} bytes` : `${octets} bytes; ${plus} or more in ≈ ${pourcentage} % of cases (a counter gap exceeds 127)`),
    reussite: 'Success of an attempt',
    essaisAttendus: 'Expected attempts',
    essaisAttendusValeur: (essais) => `${essais} on average per proof`,
    executionPrevue: 'Planned execution',
    aucuneExecution: 'none: WebAssembly unavailable',
    plusLentQueCompile: (facteur) => `, ${facteur} × slower than compiled`,
    dureeEssai: 'Duration of an attempt',
    dureeEssaiValeur: (duree) => `≈ ${duree} on one core`,
    parallelisation: 'Parallelism',
    parallelisationAdaptative: 'adaptive: 1 thread at first, then up to 8 if the device seems powerful enough (more if its hardware characteristics are known)',
    parallelisationMemoire: (fils) => `adaptive: ${fils} thread(s) from the start, from the memory and cores the device announces`,
    parallelisationFixe: (fils) => fils === 0 ? 'none: computed on the main thread' : `${fils} thread(s)`,
    dureeEstimee: 'Estimated duration',
    dureeAvecFils: (duree, fils) => `${duree} with ${fils} thread(s)`,
    memoireParFil: 'Memory per thread',
    memoireParFilValeur: (total, travail) => `≈ ${total} (${travail} working memory + module)`,
    memoireTotale: 'Total memory',
    memoireTotaleValeur: (total, fils) => `≈ ${total} for ${fils} active thread(s)`,
    verificationEstimee: 'Estimated verification',
    verificationEstimeeValeur: (duree) => `≈ ${duree} per proof, whatever n`,
    dureeDerniereMesure: 'Duration from the last measurement',
    dureeDerniereMesureValeur: (duree, fils, essai) => `${duree} with ${fils} thread(s), from a measured attempt of ${essai} on one thread`,
    moteur: 'Engine',
    moteurProgression: (wasm, compile) => (wasm ? `WebAssembly, ${compile ? 'compiled' : 'interpreted'} programs` : 'JavaScript'),
    repli: 'Fallback',
    repliIndisponible: 'WebAssembly unavailable',
    repliEchec: (message) => `WebAssembly failed: ${message}`,
    parametre: 'Parameter',
    filsActifs: 'Active Web Workers',
    filsActifsValeur: (fils, evolution) => (evolution ? `${fils} (history: ${evolution})` : String(fils)),
    filPrincipal: 'none: main thread',
    partsTrouvees: 'Parts found',
    essais: 'Attempts',
    tempsEcoule: 'Elapsed time',
    tempsRestant: 'Estimated time left',
    memoireReelle: 'Actual module memory',
    preuveEnCours: (rang, total) => `Proof ${rang} of ${total}…`,
    mesureVerification: 'Measuring verification…',
    termine: 'Done.',
    annule: 'Cancelled.',
    erreur: (message) => `Error: ${message}`,
    preuvesMesurees: 'Proofs measured',
    preuvesMesureesValeur: (faites, total) => `${faites} of ${total}`,
    dureeMediane: 'Median duration',
    centile90: '90th percentile',
    auMoinsTrois: 'at least 3 proofs needed',
    moyenne: 'Mean',
    minMax: 'Min – max',
    essaisParPreuve: 'Attempts per proof',
    essaisParPreuveValeur: (mesures, attendus) => `${mesures} measured, ${attendus} expected`,
    dureeEssaiUnFil: 'Duration of an attempt (one thread)',
    detailEssai: (duree, execution, compilation, reference) => `${duree} (${execution}${compilation ? `, including ${compilation} compiling HashX programs` : ''}); reference: ${reference}`,
    webWorkers: 'Web Workers',
    webWorkersValeur: (fils) => `at most ${fils} at a time`,
    memoireModule: 'Module memory',
    memoireModuleValeur: (total, parFil) => `${total} in total${parFil ? `, ${parFil} per active thread` : ''}`,
    executions: { wasmCompile: 'Full Wasm', wasm: 'Wasm + interpreter', js: 'JS with JIT *', jsSansJit: 'Pure JS *' },
    estimationJit: (seuil) => `* Estimate: the JIT cannot be observed, it is inferred from speed (a JavaScript attempt under ${seuil} at n = 60 implies a JIT).`,
    parVerification: 'Per verification',
    parPart: 'Per part',
    tailleMesuree: (mesuree, prevue) => `${mesuree} bytes measured (${prevue} expected)`,
    verificationAttendue: 'measured once the first proof is found',
    verificationIncoherente: 'A computed proof was not verified: inconsistent module or loader.',
    copie: 'Copied ✓',
    reglagesImportes: (nom) => `Settings imported from “${nom}”.`,
    erreurImport: (message) => `Settings file rejected: ${message}`,
    erreurs: {
      json: 'this is not valid JSON.',
      objet: 'a JSON object is expected.',
      format: (format) => `unknown format “${format}” (expected: pow-equix-wasm/reglages or pow-equix-wasm/mesures).`,
      champInconnu: (champ) => `unknown field “${champ}”.`,
      valeur: (champ, attendu) => `“${champ}” must be ${attendu}.`,
      entier: (min, max) => `an integer from ${min} to ${max}`,
      parmi: (valeurs) => `one of: ${valeurs}`,
    },
  },
}

export const TEXTES: Record<Langue, Textes> = { fr, en }
