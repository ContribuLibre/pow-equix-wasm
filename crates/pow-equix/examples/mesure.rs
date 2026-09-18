//! Mesure native du solveur et de la vérification.
//!
//! cargo run --release -p pow-equix --example mesure [essais] [--probabilites]
//! cargo run --release -p pow-equix --features compilateur --example mesure

use pow_equix::{Solveur, TAILLE_PART, verifier_preuve};
use std::time::Instant;

fn main() {
    let essais: u32 = std::env::args().nth(1).and_then(|valeur| valeur.parse().ok()).unwrap_or(50);
    let mut solveur = Solveur::new();
    let graine = b"pow-equix/mesure\0";
    let debut = Instant::now();
    let solutions = (0..essais).filter(|compteur| solveur.essayer(graine, *compteur, 1).is_some()).count();
    println!(
        "résolution : {:.2} ms par essai ({essais} essais, {solutions} avec solution)",
        debut.elapsed().as_secs_f64() * 1000.0 / f64::from(essais)
    );
    // Probabilité qu’un essai aboutisse selon l’effort, sur un grand échantillon.
    if std::env::args().any(|argument| argument == "--probabilites") {
        for effort in [1u32, 2, 4, 16] {
            let reussites = (0..essais).filter(|compteur| solveur.essayer(b"autre graine", *compteur, effort).is_some()).count();
            println!("effort {effort:>3} : {:.4} des essais aboutissent", reussites as f64 / f64::from(essais));
        }
    }
    let (parts, _) = solveur.prouver(graine, 1, 8, 0).expect("preuve");
    assert_eq!(parts.len(), 8 * TAILLE_PART);
    let repetitions = 200;
    let debut = Instant::now();
    for _ in 0..repetitions {
        assert!(verifier_preuve(graine, 1, 8, &parts));
    }
    println!("vérification : {:.1} µs pour 8 parts", debut.elapsed().as_secs_f64() * 1e6 / f64::from(repetitions));
}
