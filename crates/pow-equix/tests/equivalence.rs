//! Équivalence avec les crates d’Arti telles que publiées :
//!
//! - pour n = 60, notre solveur trouve exactement les solutions de `equix`
//!   (mêmes listes, dans le même ordre), et chaque vérification accepte ce que
//!   l’autre accepte ;
//! - le programme exposé par notre copie de `hashx`, évalué par un interprète
//!   écrit ici à partir de son seul encodage, donne les sorties de `hashx`.

use equix::{EquiXBuilder, RuntimeOption as RuntimeEquix};
use hashx::expose::{self, TAILLE_INSTRUCTION};
use hashx_arti::HashX as HashXArti;
use pow_equix::equihash::{self, Parametres, Solution};
use pow_equix::solveur::MemoireSolveur;
use pow_equix::{RuntimeOption, Solveur, decoder_preuve, defi, encoder_preuve, graine_hashx, taille_max_preuve, verifier_part, verifier_preuve};

const GRAINE: &[u8] = b"pow-equix/equivalence\0graine";

/// Solveur dont HashX est compilé en code machine quand la plateforme le permet :
/// les tests résolvent des centaines de défis.
fn solveur() -> Solveur {
    Solveur::avec_execution(RuntimeOption::TryCompile)
}

fn equix_interprete() -> EquiXBuilder {
    let mut constructeur = EquiXBuilder::new();
    constructeur.runtime(RuntimeEquix::InterpretOnly);
    constructeur
}

/// Solutions d’Equi-X pour un défi quelconque, ou `None` sans programme valide.
fn solutions_equix(defi: &[u8], execution: RuntimeEquix) -> Option<Vec<Solution>> {
    let mut constructeur = EquiXBuilder::new();
    constructeur.runtime(execution);
    let instance = constructeur.build(defi).ok()?;
    let mut memoire = equix::SolverMemory::new();
    Some(instance.solve_with_memory(&mut memoire).iter().map(|solution| solution.as_ref().map(u32::from)).collect())
}

fn solutions_nous(defi: &[u8], memoire: &mut MemoireSolveur, execution: RuntimeOption) -> Option<Vec<Solution>> {
    let mut constructeur = hashx::HashXBuilder::new();
    constructeur.runtime(execution);
    let hashx = constructeur.build(defi).ok()?;
    memoire.remplir(&hashx);
    Some(memoire.resoudre())
}

/// Compare les solutions sur une tranche de défis ; renvoie (solutions, défis sans programme).
fn comparer_tranche(tranche: std::ops::Range<u32>) -> (usize, usize) {
    let parametres = Parametres::new(60).expect("n = 60");
    let mut memoire = MemoireSolveur::new(parametres);
    let (mut solutions, mut sans_programme) = (0, 0);
    for compteur in tranche {
        let defi = defi(GRAINE, compteur);
        let attendu = solutions_equix(&defi, RuntimeEquix::TryCompile);
        assert_eq!(solutions_nous(&defi, &mut memoire, RuntimeOption::TryCompile), attendu, "défi {compteur}");
        match attendu {
            Some(liste) => solutions += liste.len(),
            None => sans_programme += 1,
        }
    }
    // Environ deux solutions par défi ; quelques défis sans programme HashX valide.
    assert!((850..1150).contains(&solutions), "{solutions} solutions");
    assert!(sans_programme < 10);
    (solutions, sans_programme)
}

// 2000 défis en quatre tranches, que le lanceur de tests exécute en parallèle.
#[test]
fn n60_memes_solutions_qu_equix_defis_0_a_499() {
    comparer_tranche(0..500);
}

#[test]
fn n60_memes_solutions_qu_equix_defis_500_a_999() {
    comparer_tranche(500..1000);
}

#[test]
fn n60_memes_solutions_qu_equix_defis_1000_a_1499() {
    comparer_tranche(1000..1500);
}

#[test]
fn n60_memes_solutions_qu_equix_defis_1500_a_1999() {
    comparer_tranche(1500..2000);
}

#[test]
fn n60_memes_solutions_qu_equix_avec_l_interprete() {
    // Le chemin du module WebAssembly : HashX interprété des deux côtés.
    let mut memoire = MemoireSolveur::new(Parametres::new(60).expect("n = 60"));
    for compteur in 0..12u32 {
        let defi = defi(b"pow-equix/interprete", compteur);
        assert_eq!(solutions_nous(&defi, &mut memoire, RuntimeOption::InterpretOnly), solutions_equix(&defi, RuntimeEquix::InterpretOnly));
    }
}

#[test]
fn n60_reproduit_les_vecteurs_d_equix() {
    // Mêmes défis que les tests d’Arti (`expected_solution_count`) : 38 solutions distinctes.
    let parametres = Parametres::new(60).expect("n = 60");
    let mut memoire = MemoireSolveur::new(parametres);
    let mut toutes = std::collections::HashSet::new();
    for graine in 0u32..20 {
        for solution in solutions_nous(&graine.to_le_bytes(), &mut memoire, RuntimeOption::TryCompile).expect("programme") {
            assert!(toutes.insert(solution));
        }
    }
    assert_eq!(toutes.len(), 38);
    let premiere = solutions_nous(&0u32.to_le_bytes(), &mut memoire, RuntimeOption::TryCompile).expect("programme");
    assert_eq!(premiere.len(), 1);
    assert!(equix::verify_array(&0u32.to_le_bytes(), &premiere[0].map(|indice| indice as u16)).is_ok());
}

/// Accord des deux vérifications sur une solution candidate (n = 60, effort 1).
fn accord(compteur: u32, octets: &[u8; 16]) -> bool {
    let defi = defi(GRAINE, compteur);
    let equix = equix_interprete().verify_bytes(&defi, octets).is_ok();
    assert_eq!(verifier_part(GRAINE, compteur, octets, 1, 60), equix, "défi {compteur}, solution {octets:?}");
    equix
}

#[test]
fn n60_verification_croisee_et_alterations() {
    let mut solveur = solveur();
    let (mut acceptees, mut refusees) = (0, 0);
    for compteur in 0..120u32 {
        let Some(solution) = solveur.essayer(GRAINE, compteur, 1, 60) else { continue };
        let solution: [u8; 16] = solution.try_into().expect("16 octets");
        assert!(accord(compteur, &solution));
        acceptees += 1;
        // Toute altération d’un bit est refusée par les deux vérifications.
        for bit in 0..128 {
            let mut alteree = solution;
            alteree[bit / 8] ^= 1 << (bit % 8);
            assert!(!accord(compteur, &alteree));
            refusees += 1;
        }
        // Échanger deux indices, ou présenter la solution pour un autre défi.
        let mut echangee = solution;
        echangee.swap(0, 2);
        echangee.swap(1, 3);
        accord(compteur, &echangee);
        assert!(!accord(compteur + 1000, &solution));
    }
    assert!(acceptees > 80 && refusees > 10_000);
}

#[test]
fn n60_la_solution_garde_la_forme_d_equix_mais_l_enveloppe_rompt_avec_la_0_2() {
    let mut solveur = solveur();
    let (preuve, essais) = solveur.prouver(GRAINE, 4, 3, 0, 60).expect("preuve");
    assert!(essais >= 3);
    assert!(verifier_preuve(GRAINE, 4, 3, &preuve, 60));
    let parts = decoder_preuve(&preuve, 3, 60).expect("forme canonique");
    // Écarts d’un octet (compteurs < 128) : 3 × (1 + 16) octets, au lieu de 3 × 20 en 0.2.
    assert_eq!(preuve.len(), 3 * 17);
    let mut ancienne = Vec::new();
    for &(compteur, solution) in &parts {
        let solution: &[u8; 16] = solution.try_into().expect("16 octets");
        // Solution rangée = 8 × u16 petit-boutistes d’Equi-X ; effort sur défi ‖ solution, comme avant.
        assert!(equix_interprete().verify_bytes(&defi(GRAINE, compteur), solution).is_ok());
        assert!(pow_equix::effort_atteint(&defi(GRAINE, compteur), solution, 4));
        ancienne.extend_from_slice(&compteur.to_le_bytes());
        ancienne.extend_from_slice(solution);
    }
    // Rupture assumée : la même preuve au format de la 0.2 (compteur u32 ‖ solution) est refusée.
    assert!(!verifier_preuve(GRAINE, 4, 3, &ancienne, 60));
}

#[test]
fn la_solution_rangee_fait_l_aller_retour_sur_b_bits_par_indice() {
    let mut graine = 0x9e37_79b9_7f4a_7c15u64;
    for n in pow_equix::N_VALIDES {
        let parametres = Parametres::new(n).expect("n");
        assert_eq!(parametres.taille_solution(), (n / 4 + 1) as usize);
        for _ in 0..200 {
            let indices: Solution = std::array::from_fn(|_| {
                graine ^= graine << 13;
                graine ^= graine >> 7;
                graine ^= graine << 17;
                (graine as u32) & ((1 << parametres.bits_indice()) - 1)
            });
            let octets = equihash::encoder(parametres, &indices);
            assert_eq!(octets.len(), parametres.taille_solution());
            assert_eq!(equihash::decoder(parametres, &octets), Some(indices));
            if n == 60 {
                let u16s: Vec<u8> = indices.iter().flat_map(|&indice| (indice as u16).to_le_bytes()).collect();
                assert_eq!(octets, u16s);
            }
        }
    }
    // L’indice 0 occupe les bits de poids faible du flux.
    let parametres = Parametres::new(80).expect("n = 80");
    let mut indices = [0u32; 8];
    indices[0] = 1;
    indices[1] = 1;
    assert_eq!(equihash::encoder(parametres, &indices)[..3], [0b0000_0001, 0, 0b0010_0000]);
}

#[test]
fn l_enveloppe_n_accepte_qu_une_forme_d_octets() {
    let solution = [0xabu8; 16];
    let preuve = |ecarts: &[&[u8]]| -> Vec<u8> { ecarts.iter().flat_map(|ecart| [*ecart, &solution[..]].concat()).collect() };
    let compteurs = |octets: &[u8], nombre: usize| decoder_preuve(octets, nombre, 60).map(|parts| parts.iter().map(|part| part.0).collect::<Vec<_>>());
    // Aller-retour, écarts de 1 à 5 octets, jusqu’à u32::MAX.
    for liste in [vec![0u32], vec![0, 1, 2], vec![127, 128, 16_511], vec![5, 1_000_000, u32::MAX], vec![u32::MAX]] {
        let parts: Vec<(u32, &[u8])> = liste.iter().map(|&compteur| (compteur, &solution[..])).collect();
        let octets = encoder_preuve(&parts).expect("compteurs croissants");
        assert_eq!(compteurs(&octets, liste.len()), Some(liste.clone()));
        assert!(octets.len() <= taille_max_preuve(60, liste.len()));
    }
    assert_eq!(compteurs(&preuve(&[&[0x7f], &[0x00]]), 2), Some(vec![127, 128]));
    assert_eq!(compteurs(&preuve(&[&[0xff, 0xff, 0xff, 0xff, 0x0f]]), 1), Some(vec![u32::MAX]));
    // Formes non canoniques : zéros de tête, plus de 5 octets, dépassement de u32.
    assert_eq!(compteurs(&preuve(&[&[0x80, 0x00]]), 1), None);
    assert_eq!(compteurs(&preuve(&[&[0x81, 0x80, 0x00]]), 1), None);
    assert_eq!(compteurs(&preuve(&[&[0x80, 0x80, 0x80, 0x80, 0x80, 0x01]]), 1), None);
    assert_eq!(compteurs(&preuve(&[&[0xff, 0xff, 0xff, 0xff, 0x10]]), 1), None);
    // Compteur cumulé au-delà de u32::MAX.
    assert_eq!(compteurs(&preuve(&[&[0xff, 0xff, 0xff, 0xff, 0x0f], &[0x00]]), 2), None);
    assert_eq!(compteurs(&preuve(&[&[0xfe, 0xff, 0xff, 0xff, 0x0f], &[0x00]]), 2), Some(vec![u32::MAX - 1, u32::MAX]));
    // Exactement `nombre` parts, tous les octets consommés.
    let deux = preuve(&[&[0x03], &[0x00]]);
    assert_eq!(compteurs(&deux, 2), Some(vec![3, 4]));
    assert_eq!(compteurs(&deux, 1), None);
    assert_eq!(compteurs(&deux, 3), None);
    assert_eq!(compteurs(&[deux.as_slice(), &[0]].concat(), 2), None);
    assert_eq!(compteurs(&deux[..deux.len() - 1], 2), None);
    assert_eq!(compteurs(&[], 0), None);
    assert_eq!(compteurs(&[], 1), None);
    // Trop long pour ce nombre de parts : refusé avant toute lecture.
    assert_eq!(taille_max_preuve(60, 4), 4 * 21);
    assert_eq!(taille_max_preuve(80, 4), 4 * 26);
    assert_eq!(taille_max_preuve(60, 0), 0);
    assert_eq!(taille_max_preuve(62, 1), 0);
    // L’encodeur refuse des compteurs qui ne croissent pas strictement.
    assert!(encoder_preuve(&[(4, &solution[..]), (4, &solution[..])]).is_none());
    assert!(encoder_preuve(&[(5, &solution[..]), (4, &solution[..])]).is_none());
}

/// Interprète de référence écrit d’après l’encodage documenté dans `expose.rs`,
/// comme le fait le générateur WebAssembly du chargeur JavaScript.
fn evaluer(programme: &[u8], cle: [u64; 4], entree: u64) -> [u64; 2] {
    fn tour(v: &mut [u64; 4]) {
        v[0] = v[0].wrapping_add(v[1]);
        v[2] = v[2].wrapping_add(v[3]);
        v[1] = v[1].rotate_left(13);
        v[3] = v[3].rotate_left(16);
        v[1] ^= v[0];
        v[3] ^= v[2];
        v[0] = v[0].rotate_left(32);
        v[2] = v[2].wrapping_add(v[1]);
        v[0] = v[0].wrapping_add(v[3]);
        v[1] = v[1].rotate_left(17);
        v[3] = v[3].rotate_left(21);
        v[1] ^= v[2];
        v[3] ^= v[0];
        v[2] = v[2].rotate_left(32);
    }
    // SipHash 2-4 en mode compteur, 512 bits de sortie.
    let mut s = cle;
    s[1] ^= 0xee;
    s[3] ^= entree;
    tour(&mut s);
    tour(&mut s);
    s[0] ^= entree;
    s[2] ^= 0xee;
    for _ in 0..4 {
        tour(&mut s);
    }
    let mut t = s;
    t[1] ^= 0xdd;
    for _ in 0..4 {
        tour(&mut t);
    }
    let mut r = [s[0], s[1], s[2], s[3], t[0], t[1], t[2], t[3]];
    let (mut pc, mut branche_permise, mut cible, mut mulh) = (0usize, true, None, 0u32);
    while pc < programme.len() / TAILLE_INSTRUCTION {
        let i = &programme[pc * TAILLE_INSTRUCTION..(pc + 1) * TAILLE_INSTRUCTION];
        let (dst, src, parametre) = (usize::from(i[1]), usize::from(i[2]), u32::from(i[3]));
        let constante = u32::from_le_bytes([i[4], i[5], i[6], i[7]]);
        let etendue = i64::from(constante as i32) as u64;
        pc += 1;
        match i[0] {
            expose::CODE_MUL => r[dst] = r[dst].wrapping_mul(r[src]),
            expose::CODE_UMULH => {
                r[dst] = ((u128::from(r[dst]) * u128::from(r[src])) >> 64) as u64;
                mulh = r[dst] as u32;
            }
            expose::CODE_SMULH => {
                r[dst] = ((i128::from(r[dst] as i64) * i128::from(r[src] as i64)) >> 64) as u64;
                mulh = r[dst] as u32;
            }
            expose::CODE_ADD_SHIFT => r[dst] = r[dst].wrapping_add(r[src] << parametre),
            expose::CODE_ADD_CONST => r[dst] = r[dst].wrapping_add(etendue),
            expose::CODE_SUB => r[dst] = r[dst].wrapping_sub(r[src]),
            expose::CODE_XOR => r[dst] ^= r[src],
            expose::CODE_XOR_CONST => r[dst] ^= etendue,
            expose::CODE_ROTATE => r[dst] = r[dst].rotate_right(parametre),
            expose::CODE_TARGET => cible = Some(pc - 1),
            expose::CODE_BRANCH => {
                if branche_permise && constante & mulh == 0 {
                    branche_permise = false;
                    pc = cible.expect("cible avant tout branchement");
                }
            }
            code => panic!("code inconnu {code}"),
        }
    }
    let mut x = [r[0].wrapping_add(cle[0]), r[1].wrapping_add(cle[1]), r[2], r[3]];
    let mut y = [r[4], r[5], r[6].wrapping_add(cle[2]), r[7].wrapping_add(cle[3])];
    tour(&mut x);
    tour(&mut y);
    [x[0] ^ y[0], x[1] ^ y[1]]
}

#[test]
fn le_programme_expose_calcule_comme_hashx() {
    let (mut programmes, mut branches) = (0, 0);
    for graine in 0u32..300 {
        let graine = [b"pow-equix/programme\0".as_slice(), &graine.to_le_bytes()].concat();
        let arti = HashXArti::new(&graine).ok();
        let nous = equihash::hashx_interprete(&graine);
        assert_eq!(arti.is_some(), nous.is_some(), "validité du programme");
        let (Some(arti), Some(nous)) = (arti, nous) else { continue };
        programmes += 1;
        let programme = nous.programme_encode().expect("programme interprété");
        branches += programme.chunks_exact(TAILLE_INSTRUCTION).filter(|i| i[0] == expose::CODE_BRANCH).count();
        for entree in (0..40u64).chain([65_535, 1 << 20, (1 << 21) - 1, u64::MAX]) {
            let attendu = arti.hash_to_bytes(entree);
            let mot = |rang: usize| u64::from_le_bytes(attendu[rang * 8..rang * 8 + 8].try_into().expect("8 octets"));
            assert_eq!(evaluer(&programme, nous.cle_registres(), entree), [mot(0), mot(1)]);
            assert_eq!(nous.hash_to_u128(entree), u128::from(mot(0)) | (u128::from(mot(1)) << 64));
            assert_eq!(nous.hash_to_u64(entree), arti.hash_to_u64(entree));
        }
    }
    assert!(programmes > 290 && branches > 0);
}

#[test]
fn au_dela_de_60_une_preuve_se_verifie_et_toute_alteration_est_refusee() {
    let mut solveur = solveur();
    for n in [64, 68] {
        let taille = (n / 4 + 1) as usize;
        let (parts, _) = solveur.prouver(GRAINE, 2, 2, 0, n).expect("preuve");
        let decodees = decoder_preuve(&parts, 2, n).expect("preuve canonique");
        let premiere = decodees[0].0;
        let longueur_premiere = taille + if premiere < 128 { 1 } else { 2 };
        assert!(parts.len() <= taille_max_preuve(n, 2));
        assert!(verifier_preuve(GRAINE, 2, 2, &parts, n));
        // Autre n, autre graine, autre nombre, autre effort.
        assert!(!verifier_preuve(GRAINE, 2, 2, &parts, if n == 64 { 68 } else { 64 }));
        assert!(!verifier_preuve(GRAINE, 2, 2, &parts, 60));
        assert!(!verifier_preuve(GRAINE, 2, 2, &parts, 62));
        assert!(!verifier_preuve(b"autre graine", 2, 2, &parts, n));
        assert!(verifier_preuve(GRAINE, 2, 1, &parts[..longueur_premiere], n));
        assert!(!verifier_preuve(GRAINE, 2, 3, &parts, n));
        for octet in 0..parts.len() {
            let mut alteree = parts.clone();
            alteree[octet] ^= 0x10;
            assert!(!verifier_preuve(GRAINE, 2, 2, &alteree, n), "n = {n}, octet {octet}");
        }
        // Une solution de mauvaise taille est refusée avant tout calcul.
        let (compteur, solution) = decodees[0];
        assert!(verifier_part(GRAINE, compteur, solution, 1, n));
        assert!(!verifier_part(GRAINE, compteur, &[solution, &[0]].concat(), 1, n));
        assert!(!verifier_part(GRAINE, compteur, &solution[1..], 1, n));
    }
}

#[test]
fn les_valeurs_de_n_hors_de_la_famille_sont_refusees() {
    for n in [0, 56, 59, 61, 62, 84, 120] {
        assert!(Parametres::new(n).is_none());
        assert_eq!(taille_max_preuve(n, 1), 0);
        assert!(solveur().essayer(GRAINE, 0, 1, n).is_none());
        assert!(!verifier_preuve(GRAINE, 1, 1, &[0; 36], n));
    }
}

#[test]
fn la_graine_hashx_separe_chaque_n() {
    let defi = defi(GRAINE, 7);
    assert_eq!(graine_hashx(&defi, 60), defi);
    let graines: std::collections::HashSet<_> = pow_equix::N_VALIDES.iter().map(|&n| graine_hashx(&defi, n)).collect();
    assert_eq!(graines.len(), pow_equix::N_VALIDES.len());
    assert_eq!(graine_hashx(&defi, 72).last(), Some(&72));
}

#[test]
fn chaque_n_trouve_environ_deux_solutions_par_defi() {
    // Mesure complète (plus de défis, jusqu’à n = 80) : exemple `mesure --solutions`.
    let mut solveur = solveur();
    for (n, defis) in [(64u32, 120u32), (72, 12)] {
        let mut solutions = 0;
        for compteur in 0..defis {
            if solveur.preparer(GRAINE, compteur, n).is_some() {
                solveur.remplir();
                let trouvees = solveur.solutions();
                let parametres = Parametres::new(n).expect("n");
                let hashx = equihash::hashx_interprete(&graine_hashx(&defi(GRAINE, compteur), n)).expect("programme");
                assert!(trouvees.iter().all(|solution| equihash::solution_valide(&hashx, parametres, solution)));
                solutions += trouvees.len();
            }
        }
        let moyenne = solutions as f64 / f64::from(defis);
        assert!((1.2..2.8).contains(&moyenne), "n = {n} : {moyenne} solutions par défi");
    }
}

#[test]
fn les_plus_grands_n_resolvent_et_verifient() {
    // n = 76 et 80 : clés de la première couche au-delà de 64 bits (n = 80), indices sur 21 bits.
    let mut solveur = solveur();
    for n in [76, 80] {
        let (parts, _) = solveur.prouver(GRAINE, 1, 1, 0, n).expect("preuve");
        assert!(verifier_preuve(GRAINE, 1, 1, &parts, n));
        let parametres = Parametres::new(n).expect("n");
        let (_, solution) = decoder_preuve(&parts, 1, n).expect("preuve")[0];
        assert_eq!(solution.len(), (n / 4 + 1) as usize);
        let indices = equihash::decoder(parametres, solution).expect("solution");
        assert!(indices.iter().all(|&indice| (indice as usize) < parametres.elements()));
        let mut alteree = parts.clone();
        *alteree.last_mut().expect("octet") ^= 1;
        assert!(!verifier_preuve(GRAINE, 1, 1, &alteree, n));
    }
}
