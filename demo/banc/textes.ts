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
    difficultesCalibrees: (cible: string) => string
    plafond: (retenus: number, demandes: number) => string
    statuts: Record<'complet' | 'incomplet' | 'enCours' | 'nonCommence', string>
    auDessus: string
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
    provisoire: 'Scénarios par défaut : défi visé ≈ 1 s (médiane, tous les cœurs, sur le PC de référence), 80 % des défis dans un rapport ≤ 2 (p90/p10 ≤ 2). Difficultés issues d’une simulation : à calibrer sur le PC de référence, puis à importer telles quelles ailleurs. La durée de mesure du débit maximal (dureeDebitMs) reste provisoire.',
    scenariosAide: 'Fichier JSON pow-equix-wasm/banc-scenarios : dureeCibleMs (médiane visée par le calibrage), dureeDebitMs (mesure du débit maximal), calibrage (machine de référence), et scenarios : { id, libelle, algorithme (sha256, argon2id, equix), parametres, parts, difficulte, fils (« coeurs » par défaut), sansParallelisation, repetitions }. Difficulté : bits nuls en tête pour SHA-256 et Argon2id, effort pour Equi-X. La mémoire se règle pour Argon2id { memoireKio, iterations, parallelisme } comme pour Equi-X { n, compilation }. Les fils sont plafonnés par la mémoire de l’appareil (Argon2id, Equi-X).',
    importerScenarios: 'Importer des scénarios…',
    exporterScenarios: 'Télécharger les scénarios',
    reinitialiser: 'Scénarios provisoires',
    rapide: 'Mode rapide (10 répétitions par scénario) : pour essayer le banc, résultats non représentatifs',
    estimation: 'Estimation',
    calibrer: 'Mesurer la vitesse (quelques secondes)',
    exporterPartiel: 'Exporter maintenant (même partiel)',
    effacer: 'Effacer les résultats stockés',
    reference: 'Machine de référence',
    referenceAide: 'Sur le PC de référence seulement, tous les cœurs : ajuste la difficulté de chaque scénario pour que la médiane d’un défi atteigne dureeCibleMs (1 s), sans changer le nombre de parts sauf si p90/p10 dépasse 2 sur 30 défis de contrôle, puis fige le résultat dans le fichier de scénarios, à télécharger et à importer tel quel sur les autres machines.',
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
    colonnes: ['id', 'Algorithme', 'Paramètres', 'Parts', 'Difficulté', 'Fils', 'Répétitions', 'Essais attendus', 'Durée estimée'],
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
    difficultesCalibrees: (cible) => `Difficultés calibrées pour une médiane de ${cible} : télécharge le fichier de scénarios pour les autres machines.`,
    plafond: (retenus, demandes) => `${retenus} (plafond mémoire, ${demandes} demandés)`,
    statuts: { complet: 'complet', incomplet: 'incomplet', enCours: 'en cours', nonCommence: 'non commencé' },
    auDessus: 'au-dessus de la cible',
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
    provisoire: 'Default scenarios: challenge targeted at ≈ 1 s (median, all cores, on the reference PC), 80 % of challenges within a factor ≤ 2 (p90/p10 ≤ 2). Difficulties come from a simulation: calibrate them on the reference PC, then import them as is elsewhere. The maximum throughput measurement duration (dureeDebitMs) is still provisional.',
    scenariosAide: 'JSON file pow-equix-wasm/banc-scenarios: dureeCibleMs (median targeted by calibration), dureeDebitMs (maximum throughput measurement), calibrage (reference machine), and scenarios: { id, libelle, algorithme (sha256, argon2id, equix), parametres, parts, difficulte, fils (“coeurs” by default), sansParallelisation, repetitions }. Difficulty: leading zero bits for SHA-256 and Argon2id, effort for Equi-X. Memory is tunable for Argon2id { memoireKio, iterations, parallelisme } as for Equi-X { n, compilation }. Threads are capped by the device memory (Argon2id, Equi-X).',
    importerScenarios: 'Import scenarios…',
    exporterScenarios: 'Download scenarios',
    reinitialiser: 'Provisional scenarios',
    rapide: 'Quick mode (10 repetitions per scenario): to try the bench, results are not representative',
    estimation: 'Estimate',
    calibrer: 'Measure speed (a few seconds)',
    exporterPartiel: 'Export now (even partial)',
    effacer: 'Clear stored results',
    reference: 'Reference machine',
    referenceAide: 'On the reference PC only, all cores: adjusts the difficulty of each scenario so that the median challenge reaches dureeCibleMs (1 s), without changing the number of parts unless p90/p10 exceeds 2 over 30 control challenges, then freezes the result in the scenario file, to download and import as is on the other machines.',
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
    colonnes: ['id', 'Algorithm', 'Parameters', 'Parts', 'Difficulty', 'Threads', 'Repetitions', 'Expected attempts', 'Estimated duration'],
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
    difficultesCalibrees: (cible) => `Difficulties calibrated for a median of ${cible}: download the scenario file for the other machines.`,
    plafond: (retenus, demandes) => `${retenus} (memory cap, ${demandes} requested)`,
    statuts: { complet: 'complete', incomplet: 'incomplete', enCours: 'in progress', nonCommence: 'not started' },
    auDessus: 'above target',
  },
}

export const TEXTES_BANC: Record<Langue, TextesBanc> = { fr, en }
