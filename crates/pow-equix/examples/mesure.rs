//! Mesure native du solveur et de la vérification, pour chaque n demandé.
//!
//! cargo run --release -p pow-equix --example mesure [essais] [--n 60,64,…] [--solutions] [--probabilites]
//! cargo run --release -p pow-equix --features compilateur --example mesure
//!
//! Le temps d’un essai est décomposé : construction du programme HashX, table
//! des valeurs (interprétée, ou compilée en code machine avec `compilateur`),
//! puis recherche des collisions. `--solutions` compte les solutions par défi.

use pow_equix::{N_VALIDES, Parametres, Solveur, taille_max_preuve, verifier_preuve};
use std::time::{Duration, Instant};

fn argument(nom: &str) -> Option<String> {
    let arguments: Vec<String> = std::env::args().collect();
    arguments.iter().position(|argument| argument == nom).and_then(|index| arguments.get(index + 1).cloned())
}

fn ms(duree: Duration, essais: u32) -> f64 {
    duree.as_secs_f64() * 1000.0 / f64::from(essais)
}

fn main() {
    let essais: u32 = std::env::args().nth(1).and_then(|valeur| valeur.parse().ok()).unwrap_or(20);
    let liste: Vec<u32> = argument("--n").map_or(N_VALIDES.to_vec(), |valeur| valeur.split(',').filter_map(|n| n.parse().ok()).collect());
    let graine = b"pow-equix/mesure\0";
    println!("HashX {}", if cfg!(feature = "compilateur") { "compilé en code machine" } else { "interprété" });
    for n in liste {
        let Some(parametres) = Parametres::new(n) else { continue };
        let mut solveur = Solveur::new();
        let (mut programme, mut table, mut recherche, mut solutions) = (Duration::ZERO, Duration::ZERO, Duration::ZERO, 0usize);
        for compteur in 0..essais {
            let debut = Instant::now();
            if solveur.preparer(graine, compteur, n).is_none() {
                continue;
            }
            let prepare = Instant::now();
            solveur.remplir();
            let rempli = Instant::now();
            solutions += solveur.solutions().len();
            let fin = Instant::now();
            programme += prepare - debut;
            table += rempli - prepare;
            recherche += fin - rempli;
        }
        let total = programme + table + recherche;
        println!(
            "n = {n} : {:.2} ms par essai (programme {:.3} ms, table {:.2} ms, recherche {:.2} ms), {:.2} solutions par défi, mémoire du solveur {:.2} Mio",
            ms(total, essais),
            ms(programme, essais),
            ms(table, essais),
            ms(recherche, essais),
            solutions as f64 / f64::from(essais),
            parametres.memoire_solveur() as f64 / 1024.0 / 1024.0,
        );
        // Probabilité qu’un essai aboutisse selon l’effort, sur un grand échantillon.
        if std::env::args().any(|argument| argument == "--probabilites") {
            for effort in [1u32, 2, 4, 16] {
                let reussites = (0..essais).filter(|compteur| solveur.essayer(b"autre graine", *compteur, effort, n).is_some()).count();
                println!("  effort {effort:>3} : {:.4} des essais aboutissent", reussites as f64 / f64::from(essais));
            }
        }
        let (parts, _) = solveur.prouver(graine, 1, 8, 0, n).expect("preuve");
        assert!(parts.len() <= taille_max_preuve(n, 8));
        let repetitions = 200;
        let debut = Instant::now();
        for _ in 0..repetitions {
            assert!(verifier_preuve(graine, 1, 8, &parts, n));
        }
        println!("  vérification : {:.1} µs pour 8 parts, preuve de {} octets", debut.elapsed().as_secs_f64() * 1e6 / f64::from(repetitions), parts.len());
    }
}
