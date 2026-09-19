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
    provisoire: 'Valeurs provisoires : les scénarios par défaut ne sont pas encore arbitrés. Modifie le JSON ci-dessous, ou importe un fichier de scénarios.',
    scenariosAide: 'Liste JSON : { id, libelle, algorithme (sha256, argon2id, equix), parametres, parts, difficulte, fils (nombre ou « coeurs »), repetitions }. Difficulté : bits nuls en tête pour SHA-256 et Argon2id, effort pour Equi-X. Paramètres : Argon2id { memoireKio, iterations, parallelisme } ; Equi-X { n, compilation }.',
    importerScenarios: 'Importer des scénarios…',
    exporterScenarios: 'Télécharger les scénarios',
    reinitialiser: 'Scénarios provisoires',
    rapide: 'Mode rapide (10 répétitions par scénario) : pour essayer le banc, résultats non représentatifs',
    estimation: 'Estimation',
    calibrer: 'Calibrer (quelques secondes)',
    estimationAide: 'D’après des durées de référence, puis d’après un calibrage sur cet appareil. Le banc de vérification s’y ajoute (3 s par configuration, sur 1 fil puis sur tous les cœurs).',
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
    colonnesResultats: ['Scénario', 'Défis', 'Médiane', 'Moyenne', 'p5', 'p10', 'p90', 'p95', 'Min', 'Max', 'p95/p5', 'Défis en 100 s', 'Essais (moy.)', 'Vérification (méd.)', 'Taille', 'Mémoire'],
    colonnesVerification: ['Algorithme', 'Paramètres', 'Fils', 'Vérifications/s'],
    nonRepresentatif: 'Mode rapide : résultats non représentatifs.',
    importes: (nom) => `Scénarios importés de « ${nom} ».`,
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
    provisoire: 'Provisional values: the default scenarios are not settled yet. Edit the JSON below, or import a scenario file.',
    scenariosAide: 'JSON list: { id, libelle, algorithme (sha256, argon2id, equix), parametres, parts, difficulte, fils (number or “coeurs”), repetitions }. Difficulty: leading zero bits for SHA-256 and Argon2id, effort for Equi-X. Parameters: Argon2id { memoireKio, iterations, parallelisme }; Equi-X { n, compilation }.',
    importerScenarios: 'Import scenarios…',
    exporterScenarios: 'Download scenarios',
    reinitialiser: 'Provisional scenarios',
    rapide: 'Quick mode (10 repetitions per scenario): to try the bench, results are not representative',
    estimation: 'Estimate',
    calibrer: 'Calibrate (a few seconds)',
    estimationAide: 'From reference durations, then from a calibration on this device. The verification bench adds to it (3 s per configuration, on 1 thread then on all cores).',
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
    colonnesResultats: ['Scenario', 'Challenges', 'Median', 'Mean', 'p5', 'p10', 'p90', 'p95', 'Min', 'Max', 'p95/p5', 'Challenges in 100 s', 'Attempts (mean)', 'Verification (median)', 'Size', 'Memory'],
    colonnesVerification: ['Algorithm', 'Parameters', 'Threads', 'Verifications/s'],
    nonRepresentatif: 'Quick mode: results are not representative.',
    importes: (nom) => `Scenarios imported from “${nom}”.`,
  },
}

export const TEXTES_BANC: Record<Langue, TextesBanc> = { fr, en }
