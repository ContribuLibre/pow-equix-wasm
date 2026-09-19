// Textes de la page du banc, en français et en anglais (même principe que demo/textes.ts).

import type { Langue } from '../textes.ts'

export interface TextesBanc {
  page: Record<string, string>
  locale: string
  dynamique: {
    navigateur: string
    coeurs: string
    memoireAppareil: string
    ecran: string
    plateforme: string
    inconnu: string
    scenariosValides: (nombre: number) => string
    scenariosInvalides: (message: string) => string
    colonnes: string[]
    estimationTotale: (duree: string, calibre: boolean) => string
    calibrage: (id: string) => string
    calibre: string
    enCours: (scenario: string, rang: number, total: number, repetition: number, repetitions: number) => string
    verificationEnCours: (config: string, fils: number) => string
    progression: (ecoule: string, restant: string) => string
    termine: string
    annule: string
    erreur: (message: string) => string
    colonnesResultats: string[]
    colonnesVerification: string[]
    nonRepresentatif: string
    importes: (nom: string) => string
    reprise: (faits: number, total: number) => string
    aucuneReprise: string
    efface: (nombre: number) => string
    scenarioIncomplet: (id: string, tentatives: number) => string
    tentative: (id: string, tentative: number, maximum: number) => string
    debitEnCours: (id: string, concurrence: number, duree: string) => string
    calibrageDifficulte: (id: string, difficulte: number, mediane: string, cible: string) => string
    plafond: (retenus: number, demandes: number, source: 'deviceMemory' | 'garde' | null) => string
    statuts: Record<'complet' | 'incomplet' | 'enCours' | 'nonCommence', string>
    auDessus: string
    machineImportee: (resume: string) => string
    machineRefusee: (message: string) => string
    machineRetiree: string
    copie: string
    garde: (limites: string) => string
    aucuneLimite: string
    plantagesConstates: (liste: string) => string
    limitesLevees: (nombre: number) => string
    palier: (id: string, fils: number) => string
    calibrageTermine: (cible: string, echecs: string[], controles: string[]) => string
    controle: (id: string, parts: number, difficulte: number, rapport: string, conforme: boolean) => string
    theorie: string
    calibrePartiel: (difficulte: number) => string
    nonCalibre: string
  }
}

const fr: TextesBanc = {
  locale: 'fr-FR',
  page: {
    titre: 'Banc comparatif SHA-256, Argon2id, Equi-X — pow-equix-wasm',
    titreCourt: 'Banc comparatif : SHA-256, Argon2id, Equi-X',
    description: 'Banc standardisé pour comparer SHA-256 (hashcash), Argon2id et Equi-X sur un appareil : durée des défis, dispersion, vérification.',
    intro: 'Ce banc lance les mêmes scénarios sur chaque appareil (au moins 100 défis par scénario), vérifie chaque preuve, mesure le débit de vérification, et produit un fichier JSON à agréger avec <code>scripts/agreger-banc.ts</code> pour remplir le tableau comparatif du README.',
    retourDemo: 'Démo et réglages libres',
    autreLangue: 'English',
    autreLangueTitre: 'Same page in English',
    fiche: 'Fiche de l’appareil',
    configMachine: 'Fiche machine par commande (facultatif, recommandé)',
    configMachineAide: 'Copie la commande de ton système dans un terminal : elle écrit config-machine.json dans le dossier courant et l’affiche (modèle, processeur et fréquence, cœurs physiques et logiques, mémoire vive, GPU, système), sans rien envoyer sur le réseau. Importe ensuite le fichier, ou colle son contenu ci-dessous : il est joint à l’export.',
    copierCommande: 'Copier la commande',
    sansTerminal: 'Sans terminal : remplis simplement les champs ci-dessous (au moins le modèle).',
    importerMachine: 'Importer config-machine.json…',
    oublierMachine: 'Retirer la fiche machine',
    collerMachine: 'ou colle ici le contenu de config-machine.json',
    leverLimites: 'Lever les limites de fils (garde-fou)',
    ficheAide: 'Détecté par la page ; complète les champs libres avant de lancer : ils identifient la machine dans le tableau.',
    modele: 'Modèle',
    modeleExemple: 'ex. ThinkPad T14 (2020), iPhone 12',
    processeur: 'Processeur',
    processeurExemple: 'ex. AMD Ryzen 7 4700U',
    gpu: 'Carte graphique',
    gpuExemple: 'ex. Radeon intégrée',
    ram: 'Mémoire vive',
    ramExemple: 'ex. 32 Go',
    remarques: 'Remarques',
    remarquesExemple: 'ex. sur secteur, autres applications fermées',
    scenarios: 'Scénarios',
    provisoire: 'Scénarios par défaut : défi visé ≈ 1 s (médiane, tous les cœurs, sur le PC de référence), 80 % des défis dans un rapport ≤ 2 (p90/p10 ≤ 2). Parts fixées par la théorie (p90/p10 ≤ 2 sur 8 fils), difficultés à calibrer sur le PC de référence, puis à importer telles quelles ailleurs. La durée de mesure du débit maximal (dureeDebitMs) reste provisoire.',
    scenariosAide: 'Fichier JSON pow-equix-wasm/banc-scenarios : dureeCibleMs (médiane visée par le calibrage), dureeDebitMs (mesure du débit maximal), calibrage (machine de référence), et scenarios : { id, libelle, algorithme (sha256, argon2id, equix), parametres, parts, difficulte, fils (« coeurs » par défaut), sansParallelisation, repetitions }. Difficulté : bits nuls en tête pour SHA-256 et Argon2id, effort pour Equi-X. La mémoire se règle pour Argon2id { memoireKio, iterations, parallelisme } comme pour Equi-X { n, compilation }. Les fils sont plafonnés par la mémoire de l’appareil (Argon2id, Equi-X).',
    importerScenarios: 'Importer des scénarios…',
    exporterScenarios: 'Télécharger les scénarios',
    reinitialiser: 'Revenir aux scénarios par défaut',
    rapide: 'Mode rapide (10 répétitions par scénario) : pour essayer le banc, résultats non représentatifs',
    estimation: 'Estimation',
    calibrer: 'Mesurer la vitesse (quelques secondes)',
    exporterPartiel: 'Exporter maintenant (même partiel)',
    effacer: 'Effacer les résultats stockés',
    reference: 'Machine de référence',
    referenceAide: 'Sur le PC de référence seulement, tous les cœurs : ajuste la difficulté de chaque scénario pour que la médiane d’un défi atteigne dureeCibleMs (1 s), les parts suivant la théorie (plus petit nombre donnant p90/p10 ≤ 2), avec un contrôle informatif sur 100 défis, puis fige le résultat dans le fichier de scénarios, à télécharger et à importer tel quel sur les autres machines.',
    calibrerDifficultes: 'Calibrer les difficultés sur cette machine',
    estimationAide: 'D’après des durées de référence, puis d’après une mesure de vitesse sur cet appareil. Pour chaque scénario : les défis seuls sur tous les cœurs (latence), puis le débit maximal (dureeDebitMs), puis le banc de vérification (3 s par configuration, sur 1 fil puis sur tous les cœurs). Chaque défi terminé est enregistré dans ce navigateur : après un plantage, relancer reprend où le banc s’était arrêté (3 tentatives au plus par scénario).',
    lancer: 'Lancer le banc',
    annuler: 'Annuler',
    progression: 'Progression',
    resultats: 'Résultats',
    verification: 'Débit de vérification',
    verificationAide: 'Parts valides vérifiées par seconde (résistance au déni de service), sur 1 fil et sur tous les cœurs.',
    exporter: 'Exporter',
    exporterAide: 'Fichier complet, schéma pow-equix-wasm/banc version 1 (demo/banc/schema.ts), à agréger avec les autres appareils :',
    telecharger: 'Télécharger le JSON',
  },
  dynamique: {
    navigateur: 'Navigateur',
    coeurs: 'Cœurs annoncés',
    memoireAppareil: 'Mémoire de l’appareil (deviceMemory)',
    ecran: 'Écran',
    plateforme: 'Plateforme',
    inconnu: 'inconnu',
    scenariosValides: (nombre) => `${nombre} scénario(s) valide(s).`,
    scenariosInvalides: (message) => `Scénarios refusés : ${message}.`,
    colonnes: ['id', 'Algorithme', 'Paramètres', 'Parts', 'Difficulté', 'Fils', 'Répétitions', 'Essais attendus', 'Durée estimée', 'Contrôle p90/p10 (calibrage)'],
    estimationTotale: (duree, calibre) => `Durée totale estimée : ${duree} (${calibre ? 'après calibrage sur cet appareil' : 'd’après les références, avant calibrage'}).`,
    calibrage: (id) => `Calibrage : ${id}…`,
    calibre: 'Calibrage terminé.',
    enCours: (scenario, rang, total, repetition, repetitions) => `Scénario ${rang}/${total} (${scenario}) : défi ${repetition}/${repetitions}`,
    verificationEnCours: (config, fils) => `Débit de vérification : ${config}, ${fils} fil(s)…`,
    progression: (ecoule, restant) => `Écoulé : ${ecoule} ; restant estimé : ${restant}`,
    termine: 'Banc terminé.',
    annule: 'Banc annulé.',
    erreur: (message) => `Erreur : ${message}`,
    colonnesResultats: ['Scénario', 'Statut', 'Fils', 'Défis', 'Médiane', 'Moyenne', 'p5', 'p10', 'p90', 'p95', 'Min', 'Max', 'p90/p10 (≤ 2 visé)', 'p95/p5', 'Défis seuls en 100 s', 'Débit maximal (défis en 100 s)', 'Essais (moy.)', 'Vérification (méd.)', 'Taille', 'Mémoire'],
    colonnesVerification: ['Algorithme', 'Paramètres', 'Fils', 'Vérifications/s'],
    nonRepresentatif: 'Mode rapide : résultats non représentatifs.',
    importes: (nom) => `Scénarios importés de « ${nom} ».`,
    reprise: (faits, total) => `Résultats stockés pour ce fichier de scénarios : ${faits} défi(s) sur ${total}. Relancer reprend là où le banc s’était arrêté.`,
    aucuneReprise: 'Aucun résultat stocké pour ce fichier de scénarios.',
    efface: (nombre) => `${nombre} enregistrement(s) effacé(s).`,
    scenarioIncomplet: (id, tentatives) => `${id} : abandonné après ${tentatives} tentative(s), marqué incomplet.`,
    tentative: (id, tentative, maximum) => `${id} : tentative ${tentative}/${maximum}.`,
    debitEnCours: (id, concurrence, duree) => `Débit maximal : ${id}, ${concurrence} défi(s) en parallèle pendant ${duree}…`,
    calibrageDifficulte: (id, difficulte, mediane, cible) => `Calibrage de ${id} : difficulté ${difficulte}, médiane ${mediane} pour ${cible} visées.`,
    plafond: (retenus, demandes, source) => `${retenus} (${source === 'garde' ? 'limite après plantage' : 'plafond de la mémoire annoncée'}, ${demandes} demandés)`,
    statuts: { complet: 'complet', incomplet: 'incomplet', enCours: 'en cours', nonCommence: 'non commencé' },
    auDessus: 'au-dessus de la cible',
    machineImportee: (resume) => `Fiche machine : ${resume}.`,
    machineRefusee: (message) => `Fiche machine refusée : ${message}.`,
    machineRetiree: 'Fiche machine retirée.',
    copie: 'Copié ✓',
    garde: (limites) => `Limites de fils sur cet appareil (après plantage) : ${limites}.`,
    aucuneLimite: 'Aucune limite de fils sur cet appareil : le banc monte jusqu’aux cœurs, par paliers (1, 2, 4, 8…), en notant chaque palier pour se protéger d’un plantage mémoire.',
    plantagesConstates: (liste) => `Plantage constaté au dernier chargement : ${liste}. Ces réglages ne dépasseront plus ce nombre de fils sur cet appareil.`,
    limitesLevees: (nombre) => `${nombre} limite(s) de fils levée(s).`,
    palier: (id, fils) => `Palier de mémoire : ${id}, ${fils} fil(s)…`,
    calibrageTermine: (cible, echecs, controles) => `Calibrage terminé. Médiane visée : ${cible} ; télécharge le fichier de scénarios pour les autres machines.${controles.length ? ` Contrôle de régularité (100 défis, informatif) : ${controles.join(' ; ')}.` : ''}${echecs.length ? ` En échec après 3 tentatives : ${echecs.join(' ; ')}.` : ''}`,
    controle: (id, parts, difficulte, rapport, conforme) => `${id} ${parts} parts × ${difficulte} : p90/p10 ${rapport} ${conforme ? '≤ 2 ✓' : '> 2 ⚠'}`,
    theorie: 'théorie',
    calibrePartiel: (difficulte) => `gardé à la dernière difficulté mesurée, ${difficulte}`,
    nonCalibre: 'non calibré',
  },
}

const en: TextesBanc = {
  locale: 'en-GB',
  page: {
    titre: 'SHA-256, Argon2id, Equi-X comparison bench — pow-equix-wasm',
    titreCourt: 'Comparison bench: SHA-256, Argon2id, Equi-X',
    description: 'Standard bench comparing SHA-256 (hashcash), Argon2id and Equi-X on a device: challenge duration, spread, verification.',
    intro: 'This bench runs the same scenarios on every device (at least 100 challenges per scenario), verifies every proof, measures verification throughput, and produces a JSON file to aggregate with <code>scripts/agreger-banc.ts</code> to fill the README comparison table.',
    retourDemo: 'Demo and free settings',
    autreLangue: 'Français',
    autreLangueTitre: 'La même page en français',
    fiche: 'Device sheet',
    configMachine: 'Machine sheet from a command (optional, recommended)',
    configMachineAide: 'Copy the command for your system into a terminal: it writes config-machine.json in the current folder and prints it (model, processor and frequency, physical and logical cores, RAM, GPU, system), without sending anything over the network. Then import the file, or paste its content below: it is attached to the export.',
    copierCommande: 'Copy the command',
    sansTerminal: 'No terminal: just fill in the fields below (at least the model).',
    importerMachine: 'Import config-machine.json…',
    oublierMachine: 'Remove the machine sheet',
    collerMachine: 'or paste the content of config-machine.json here',
    leverLimites: 'Lift the thread limits (safeguard)',
    ficheAide: 'Detected by the page; fill in the free fields before starting: they identify the machine in the table.',
    modele: 'Model',
    modeleExemple: 'e.g. ThinkPad T14 (2020), iPhone 12',
    processeur: 'Processor',
    processeurExemple: 'e.g. AMD Ryzen 7 4700U',
    gpu: 'Graphics card',
    gpuExemple: 'e.g. integrated Radeon',
    ram: 'RAM',
    ramExemple: 'e.g. 32 GB',
    remarques: 'Notes',
    remarquesExemple: 'e.g. plugged in, other applications closed',
    scenarios: 'Scenarios',
    provisoire: 'Default scenarios: challenge targeted at ≈ 1 s (median, all cores, on the reference PC), 80 % of challenges within a factor ≤ 2 (p90/p10 ≤ 2). Parts set by the theory (p90/p10 ≤ 2 on 8 threads); calibrate the difficulties on the reference PC, then import them as is elsewhere. The maximum throughput measurement duration (dureeDebitMs) is still provisional.',
    scenariosAide: 'JSON file pow-equix-wasm/banc-scenarios: dureeCibleMs (median targeted by calibration), dureeDebitMs (maximum throughput measurement), calibrage (reference machine), and scenarios: { id, libelle, algorithme (sha256, argon2id, equix), parametres, parts, difficulte, fils (“coeurs” by default), sansParallelisation, repetitions }. Difficulty: leading zero bits for SHA-256 and Argon2id, effort for Equi-X. Memory is tunable for Argon2id { memoireKio, iterations, parallelisme } as for Equi-X { n, compilation }. Threads are capped by the device memory (Argon2id, Equi-X).',
    importerScenarios: 'Import scenarios…',
    exporterScenarios: 'Download scenarios',
    reinitialiser: 'Back to default scenarios',
    rapide: 'Quick mode (10 repetitions per scenario): to try the bench, results are not representative',
    estimation: 'Estimate',
    calibrer: 'Measure speed (a few seconds)',
    exporterPartiel: 'Export now (even partial)',
    effacer: 'Clear stored results',
    reference: 'Reference machine',
    referenceAide: 'On the reference PC only, all cores: adjusts the difficulty of each scenario so that the median challenge reaches dureeCibleMs (1 s), parts following the theory (smallest number giving p90/p10 ≤ 2), with an informative check over 100 challenges, then freezes the result in the scenario file, to download and import as is on the other machines.',
    calibrerDifficultes: 'Calibrate difficulties on this machine',
    estimationAide: 'From reference durations, then from a speed measurement on this device. For each scenario: single challenges on all cores (latency), then maximum throughput (dureeDebitMs), then the verification bench (3 s per configuration, on 1 thread then on all cores). Each finished challenge is stored in this browser: after a crash, starting again resumes where the bench stopped (at most 3 attempts per scenario).',
    lancer: 'Start the bench',
    annuler: 'Cancel',
    progression: 'Progress',
    resultats: 'Results',
    verification: 'Verification throughput',
    verificationAide: 'Valid parts verified per second (denial-of-service resistance), on 1 thread and on all cores.',
    exporter: 'Export',
    exporterAide: 'Complete file, schema pow-equix-wasm/banc version 1 (demo/banc/schema.ts), to aggregate with other devices:',
    telecharger: 'Download JSON',
  },
  dynamique: {
    navigateur: 'Browser',
    coeurs: 'Announced cores',
    memoireAppareil: 'Device memory (deviceMemory)',
    ecran: 'Screen',
    plateforme: 'Platform',
    inconnu: 'unknown',
    scenariosValides: (nombre) => `${nombre} valid scenario(s).`,
    scenariosInvalides: (message) => `Scenarios rejected: ${message}.`,
    colonnes: ['id', 'Algorithm', 'Parameters', 'Parts', 'Difficulty', 'Threads', 'Repetitions', 'Expected attempts', 'Estimated duration', 'p90/p10 check (calibration)'],
    estimationTotale: (duree, calibre) => `Estimated total duration: ${duree} (${calibre ? 'after calibration on this device' : 'from references, before calibration'}).`,
    calibrage: (id) => `Calibrating: ${id}…`,
    calibre: 'Calibration done.',
    enCours: (scenario, rang, total, repetition, repetitions) => `Scenario ${rang}/${total} (${scenario}): challenge ${repetition}/${repetitions}`,
    verificationEnCours: (config, fils) => `Verification throughput: ${config}, ${fils} thread(s)…`,
    progression: (ecoule, restant) => `Elapsed: ${ecoule}; estimated remaining: ${restant}`,
    termine: 'Bench finished.',
    annule: 'Bench cancelled.',
    erreur: (message) => `Error: ${message}`,
    colonnesResultats: ['Scenario', 'Status', 'Threads', 'Challenges', 'Median', 'Mean', 'p5', 'p10', 'p90', 'p95', 'Min', 'Max', 'p90/p10 (≤ 2 targeted)', 'p95/p5', 'Single challenges in 100 s', 'Maximum throughput (challenges in 100 s)', 'Attempts (mean)', 'Verification (median)', 'Size', 'Memory'],
    colonnesVerification: ['Algorithm', 'Parameters', 'Threads', 'Verifications/s'],
    nonRepresentatif: 'Quick mode: results are not representative.',
    importes: (nom) => `Scenarios imported from “${nom}”.`,
    reprise: (faits, total) => `Stored results for this scenario file: ${faits} challenge(s) of ${total}. Starting again resumes where the bench stopped.`,
    aucuneReprise: 'No stored results for this scenario file.',
    efface: (nombre) => `${nombre} record(s) cleared.`,
    scenarioIncomplet: (id, tentatives) => `${id}: abandoned after ${tentatives} attempt(s), marked incomplete.`,
    tentative: (id, tentative, maximum) => `${id}: attempt ${tentative}/${maximum}.`,
    debitEnCours: (id, concurrence, duree) => `Maximum throughput: ${id}, ${concurrence} challenge(s) in parallel for ${duree}…`,
    calibrageDifficulte: (id, difficulte, mediane, cible) => `Calibrating ${id}: difficulty ${difficulte}, median ${mediane} for a target of ${cible}.`,
    plafond: (retenus, demandes, source) => `${retenus} (${source === 'garde' ? 'limit after a crash' : 'announced memory cap'}, ${demandes} requested)`,
    statuts: { complet: 'complete', incomplet: 'incomplete', enCours: 'in progress', nonCommence: 'not started' },
    auDessus: 'above target',
    machineImportee: (resume) => `Machine sheet: ${resume}.`,
    machineRefusee: (message) => `Machine sheet rejected: ${message}.`,
    machineRetiree: 'Machine sheet removed.',
    copie: 'Copied ✓',
    garde: (limites) => `Thread limits on this device (after a crash): ${limites}.`,
    aucuneLimite: 'No thread limit on this device: the bench goes up to the cores, in steps (1, 2, 4, 8…), recording each step to guard against a memory crash.',
    plantagesConstates: (liste) => `Crash detected on the last load: ${liste}. These settings will no longer exceed this number of threads on this device.`,
    limitesLevees: (nombre) => `${nombre} thread limit(s) lifted.`,
    palier: (id, fils) => `Memory step: ${id}, ${fils} thread(s)…`,
    // « Calibrage terminé. » reste en français en tête, pour un pilotage automatique commun aux deux langues.
    calibrageTermine: (cible, echecs, controles) => `Calibrage terminé. Calibration done. Target median: ${cible}; download the scenario file for the other machines.${controles.length ? ` Regularity check (100 challenges, informative): ${controles.join('; ')}.` : ''}${echecs.length ? ` Failed after 3 attempts: ${echecs.join('; ')}.` : ''}`,
    controle: (id, parts, difficulte, rapport, conforme) => `${id} ${parts} parts × ${difficulte}: p90/p10 ${rapport} ${conforme ? '≤ 2 ✓' : '> 2 ⚠'}`,
    theorie: 'theory',
    calibrePartiel: (difficulte) => `kept at the last measured difficulty, ${difficulte}`,
    nonCalibre: 'not calibrated',
  },
}

export const TEXTES_BANC: Record<Langue, TextesBanc> = { fr, en }
