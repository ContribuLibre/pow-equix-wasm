//! Mesure native du solveur et de la vérification, pour chaque n demandé : de
//! quoi mesurer une machine sans navigateur, et servir aux extrapolations du
//! banc comparatif (demo/banc).
//!
//! cargo run --release -p pow-equix --example mesure [essais] [--n 60,72,80] [--solutions] [--probabilites]
//! cargo run --release -p pow-equix --features compilateur --example mesure -- 20 --execution compile,interprete --fils 1,8 --json
//!
//! - `--execution` : `interprete` (par défaut sans l’option `compilateur`) et/ou
//!   `compile` (HashX en code machine ; demande l’option `compilateur`).
//! - `--fils` : un ou plusieurs nombres de fils ; chaque fil a son solveur et
//!   enchaîne ses propres défis : essais par seconde par cœur et au total.
//! - `--json` : une ligne JSON par mesure, sinon un texte lisible.
//!
//! Le temps d’un essai est décomposé : construction du programme HashX, table
//! des valeurs, puis recherche des collisions.

use pow_equix::{N_VALIDES, Parametres, RuntimeOption, Solveur, taille_max_preuve, verifier_preuve};
use std::time::{Duration, Instant};

fn argument(nom: &str) -> Option<String> {
    let arguments: Vec<String> = std::env::args().collect();
    arguments.iter().position(|argument| argument == nom).and_then(|index| arguments.get(index + 1).cloned())
}

fn liste<T: std::str::FromStr>(nom: &str, defaut: Vec<T>) -> Vec<T> {
    argument(nom).map_or(defaut, |valeur| valeur.split(',').filter_map(|element| element.parse().ok()).collect())
}

fn ms(duree: Duration, essais: u32) -> f64 {
    duree.as_secs_f64() * 1000.0 / f64::from(essais.max(1))
}

/// Modèle du processeur (Linux), pour identifier la machine dans les mesures.
fn processeur() -> String {
    std::fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|texte| texte.lines().find(|ligne| ligne.starts_with("model name")).and_then(|ligne| ligne.split(':').nth(1)).map(|nom| nom.trim().to_string()))
        .unwrap_or_else(|| std::env::consts::ARCH.to_string())
}

struct Detail {
    programme: Duration,
    table: Duration,
    recherche: Duration,
    solutions: usize,
}

/// `essais` défis sur un fil, à partir du compteur `debut`.
fn serie(execution: RuntimeOption, n: u32, essais: u32, debut: u32) -> Detail {
    let mut solveur = Solveur::avec_execution(execution);
    let graine = b"pow-equix/mesure\0";
    let mut detail = Detail { programme: Duration::ZERO, table: Duration::ZERO, recherche: Duration::ZERO, solutions: 0 };
    for compteur in debut..debut + essais {
        let depart = Instant::now();
        if solveur.preparer(graine, compteur, n).is_none() {
            continue;
        }
        let prepare = Instant::now();
        solveur.remplir();
        let rempli = Instant::now();
        detail.solutions += solveur.solutions().len();
        let fin = Instant::now();
        detail.programme += prepare - depart;
        detail.table += rempli - prepare;
        detail.recherche += fin - rempli;
    }
    detail
}

fn main() {
    let essais: u32 = std::env::args().nth(1).and_then(|valeur| valeur.parse().ok()).unwrap_or(20);
    let json = std::env::args().any(|argument| argument == "--json");
    let defaut_execution = if cfg!(feature = "compilateur") { "compile" } else { "interprete" };
    let executions: Vec<String> = liste("--execution", vec![defaut_execution.to_string()]);
    let liste_fils: Vec<u32> = liste("--fils", vec![1]);
    let processeur = processeur();
    let coeurs = std::thread::available_parallelism().map_or(1, |valeur| valeur.get());
    if !json {
        println!("{processeur}, {coeurs} cœurs logiques");
    }
    for n in liste("--n", N_VALIDES.to_vec()) {
        let Some(parametres) = Parametres::new(n) else { continue };
        for nom_execution in &executions {
            let execution = match nom_execution.as_str() {
                "compile" if cfg!(feature = "compilateur") => RuntimeOption::CompileOnly,
                "compile" => {
                    eprintln!("« compile » demande l’option compilateur : cargo run --features compilateur …");
                    continue;
                }
                _ => RuntimeOption::InterpretOnly,
            };
            for &fils in &liste_fils {
                // Chaque fil enchaîne ses défis (compteurs disjoints) ; on mesure le débit total.
                let depart = Instant::now();
                let details: Vec<Detail> = std::thread::scope(|portee| {
                    let taches: Vec<_> = (0..fils).map(|rang| portee.spawn(move || serie(execution, n, essais, rang * essais))).collect();
                    taches.into_iter().map(|tache| tache.join().expect("fil de mesure")).collect()
                });
                let ecoule = depart.elapsed();
                let total = essais * fils;
                let par_seconde = f64::from(total) / ecoule.as_secs_f64();
                let somme = |lire: fn(&Detail) -> Duration| details.iter().map(lire).sum::<Duration>();
                let (programme, table, recherche) = (somme(|d| d.programme), somme(|d| d.table), somme(|d| d.recherche));
                let solutions = details.iter().map(|d| d.solutions).sum::<usize>() as f64 / f64::from(total);
                // Vérification : 8 parts, sur un fil.
                let mut solveur = Solveur::avec_execution(execution);
                let (parts, _) = solveur.prouver(b"pow-equix/mesure\0", 1, 8, 0, n).expect("preuve");
                assert!(parts.len() <= taille_max_preuve(n, 8));
                let repetitions = 200;
                let debut_verification = Instant::now();
                for _ in 0..repetitions {
                    assert!(verifier_preuve(b"pow-equix/mesure\0", 1, 8, &parts, n));
                }
                let verification_part_us = debut_verification.elapsed().as_secs_f64() * 1e6 / f64::from(repetitions * 8);
                if json {
                    println!(
                        "{{\"format\":\"pow-equix-wasm/banc-natif\",\"version\":1,\"processeur\":{processeur:?},\"coeurs\":{coeurs},\"n\":{n},\"execution\":{nom_execution:?},\"fils\":{fils},\"essais\":{total},\"essaisParSeconde\":{par_seconde:.3},\"essaisParSecondeParFil\":{:.3},\"msParEssai\":{:.3},\"programmeMs\":{:.3},\"tableMs\":{:.3},\"rechercheMs\":{:.3},\"solutionsParDefi\":{solutions:.3},\"memoireSolveurOctets\":{},\"verificationPartMicrosecondes\":{verification_part_us:.2}}}",
                        par_seconde / f64::from(fils),
                        ms(programme + table + recherche, total),
                        ms(programme, total),
                        ms(table, total),
                        ms(recherche, total),
                        parametres.memoire_solveur(),
                    );
                } else {
                    println!(
                        "n = {n}, {nom_execution}, {fils} fil(s) : {par_seconde:.2} essais/s ({:.2} par fil) ; {:.2} ms par essai (programme {:.3}, table {:.2}, recherche {:.2}) ; {solutions:.2} solutions par défi ; mémoire du solveur {:.2} Mio par fil ; vérification {verification_part_us:.1} µs par part",
                        par_seconde / f64::from(fils),
                        ms(programme + table + recherche, total),
                        ms(programme, total),
                        ms(table, total),
                        ms(recherche, total),
                        parametres.memoire_solveur() as f64 / 1024.0 / 1024.0,
                    );
                }
                // Probabilité qu’un essai aboutisse selon l’effort, sur un grand échantillon.
                if std::env::args().any(|argument| argument == "--probabilites") && fils == liste_fils[0] {
                    for effort in [1u32, 2, 4, 16] {
                        let reussites = (0..essais).filter(|compteur| solveur.essayer(b"autre graine", *compteur, effort, n).is_some()).count();
                        println!("  effort {effort:>3} : {:.4} des essais aboutissent", reussites as f64 / f64::from(essais));
                    }
                }
            }
        }
    }
}
