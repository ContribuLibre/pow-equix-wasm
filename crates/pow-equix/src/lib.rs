//! Preuve de travail Equi-X liée à une graine.
//!
//! L’appelant choisit la graine : en général une séparation de domaine propre à
//! son protocole suivie de l’empreinte de la requête à protéger. Le défi Equi-X
//! d’un essai vaut :
//!
//! ```text
//! graine (1 à GRAINE_MAX octets) ‖ compteur (u32 petit-boutiste)
//! ```
//!
//! Equi-X trouve en moyenne deux solutions par défi. Une solution n’est retenue
//! que si `blake2b-256(défi ‖ solution)`, lu en u32 gros-boutiste sur ses quatre
//! premiers octets, multiplié par l’effort, ne dépasse pas `u32::MAX` : c’est la
//! règle d’effort du protocole Tor (`hs_pow`), une chance sur `effort` par
//! solution.
//!
//! Une preuve complète réunit `nombre` parts de 20 octets, `compteur ‖ solution`,
//! aux compteurs strictement croissants. Plusieurs petites preuves plutôt qu’une
//! grande régularisent le temps d’attente : l’écart type relatif décroît comme
//! `1/√nombre`, alors que chaque part se vérifie en quelques centaines de
//! microsecondes.

#![forbid(unsafe_code)]

use blake2::digest::consts::U32;
use blake2::{Blake2b, Digest};
use equix::{EquiXBuilder, RuntimeOption, SolutionByteArray};

/// Version du format de défi et de preuve.
pub const VERSION_FORMAT: u32 = 1;
/// Taille maximale d’une graine.
pub const GRAINE_MAX: usize = 256;
/// Taille d’une solution Equi-X.
pub const TAILLE_SOLUTION: usize = equix::Solution::NUM_BYTES;
/// Taille d’une part de preuve : compteur puis solution.
pub const TAILLE_PART: usize = 4 + TAILLE_SOLUTION;
/// Nombre maximal de parts accepté par la vérification.
pub const PARTS_MAX: usize = 64;

/// Défi Equi-X d’un essai : la graine suivie du compteur.
pub fn defi(graine: &[u8], compteur: u32) -> Vec<u8> {
    let mut sortie = Vec::with_capacity(graine.len() + 4);
    sortie.extend_from_slice(graine);
    sortie.extend_from_slice(&compteur.to_le_bytes());
    sortie
}

/// Règle d’effort : une solution sur `effort` en moyenne est retenue.
pub fn effort_atteint(defi: &[u8], solution: &SolutionByteArray, effort: u32) -> bool {
    if effort <= 1 {
        return true;
    }
    let mut hachage = Blake2b::<U32>::new();
    hachage.update(defi);
    hachage.update(solution);
    let condensat = hachage.finalize();
    let valeur = u32::from_be_bytes([condensat[0], condensat[1], condensat[2], condensat[3]]);
    u64::from(valeur) * u64::from(effort) <= u64::from(u32::MAX)
}

fn graine_valide(graine: &[u8]) -> bool {
    !graine.is_empty() && graine.len() <= GRAINE_MAX
}

/// La vérification interprète HashX : quelques évaluations ne justifient aucune compilation.
fn constructeur_verification() -> EquiXBuilder {
    let mut constructeur = EquiXBuilder::new();
    constructeur.runtime(RuntimeOption::InterpretOnly);
    constructeur
}

/// Vérifie une part de preuve.
pub fn verifier_part(graine: &[u8], compteur: u32, solution: &SolutionByteArray, effort: u32) -> bool {
    if !graine_valide(graine) {
        return false;
    }
    let defi = defi(graine, compteur);
    effort_atteint(&defi, solution, effort) && constructeur_verification().verify_bytes(&defi, solution).is_ok()
}

/// Vérifie une preuve complète : exactement `nombre` parts, compteurs strictement croissants.
pub fn verifier_preuve(graine: &[u8], effort: u32, nombre: usize, parts: &[u8]) -> bool {
    if !graine_valide(graine) || nombre == 0 || nombre > PARTS_MAX || parts.len() != nombre * TAILLE_PART {
        return false;
    }
    let mut precedent: Option<u32> = None;
    for part in parts.chunks_exact(TAILLE_PART) {
        let compteur = u32::from_le_bytes([part[0], part[1], part[2], part[3]]);
        if precedent.is_some_and(|valeur| compteur <= valeur) {
            return false;
        }
        precedent = Some(compteur);
        let mut solution: SolutionByteArray = [0; TAILLE_SOLUTION];
        solution.copy_from_slice(&part[4..]);
        if !verifier_part(graine, compteur, &solution, effort) {
            return false;
        }
    }
    true
}

/// Solveur réutilisant sa mémoire de travail (≈ 1,8 Mo) d’un essai à l’autre.
#[cfg(feature = "solveur")]
pub struct Solveur {
    memoire: Box<equix::SolverMemory>,
    constructeur: EquiXBuilder,
}

#[cfg(feature = "solveur")]
impl Default for Solveur {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(feature = "solveur")]
impl Solveur {
    /// Nouveau solveur. Avec `compilateur`, HashX tente de produire du code
    /// machine et se rabat sur l’interpréteur en cas d’échec.
    pub fn new() -> Self {
        let mut constructeur = EquiXBuilder::new();
        constructeur.runtime(if cfg!(feature = "compilateur") { RuntimeOption::TryCompile } else { RuntimeOption::InterpretOnly });
        Self { memoire: Box::new(equix::SolverMemory::new()), constructeur }
    }

    /// Un essai : la première solution du défi qui atteint l’effort, s’il y en a une.
    /// Une petite part des défis ne produit aucun programme HashX valide : l’essai
    /// échoue alors simplement, comme le prévoit Equi-X.
    pub fn essayer(&mut self, graine: &[u8], compteur: u32, effort: u32) -> Option<SolutionByteArray> {
        if !graine_valide(graine) {
            return None;
        }
        let defi = defi(graine, compteur);
        let instance = self.constructeur.build(&defi).ok()?;
        instance
            .solve_with_memory(&mut self.memoire)
            .iter()
            .map(equix::Solution::to_bytes)
            .find(|solution| effort_atteint(&defi, solution, effort))
    }

    /// Preuve complète calculée d’une traite, à partir du compteur `debut`.
    /// Renvoie les parts et le nombre d’essais.
    pub fn prouver(&mut self, graine: &[u8], effort: u32, nombre: usize, debut: u32) -> Option<(Vec<u8>, u64)> {
        if !graine_valide(graine) || nombre == 0 || nombre > PARTS_MAX {
            return None;
        }
        let mut parts = Vec::with_capacity(nombre * TAILLE_PART);
        let mut essais = 0u64;
        let mut compteur = debut;
        while parts.len() < nombre * TAILLE_PART {
            essais += 1;
            if let Some(solution) = self.essayer(graine, compteur, effort) {
                parts.extend_from_slice(&compteur.to_le_bytes());
                parts.extend_from_slice(&solution);
            }
            compteur = compteur.checked_add(1)?;
        }
        Some((parts, essais))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GRAINE: &[u8] = b"exemple/1\0graine-de-test";

    #[test]
    fn le_defi_suit_le_format_documente() {
        let defi = defi(GRAINE, 0x0102_0304);
        assert_eq!(&defi[..GRAINE.len()], GRAINE);
        assert_eq!(&defi[GRAINE.len()..], &[4, 3, 2, 1]);
    }

    #[test]
    fn un_effort_de_un_accepte_toute_solution() {
        assert!(effort_atteint(&defi(GRAINE, 0), &[0; 16], 1));
    }

    #[test]
    fn une_graine_vide_ou_trop_longue_est_refusee() {
        assert!(!verifier_preuve(&[], 1, 1, &[0; TAILLE_PART]));
        assert!(!verifier_preuve(&[1; GRAINE_MAX + 1], 1, 1, &[0; TAILLE_PART]));
    }

    #[cfg(feature = "solveur")]
    #[test]
    fn une_preuve_resolue_se_verifie_et_une_alteration_la_refuse() {
        let mut solveur = Solveur::new();
        let (parts, essais) = solveur.prouver(GRAINE, 4, 3, 0).expect("preuve");
        assert!(essais >= 3);
        assert!(verifier_preuve(GRAINE, 4, 3, &parts));
        // Autre graine, autre nombre de parts, compteurs réordonnés, solution altérée, doublon.
        assert!(!verifier_preuve(b"autre graine", 4, 3, &parts));
        assert!(!verifier_preuve(GRAINE, 4, 4, &parts));
        let mut inverse = parts[TAILLE_PART..2 * TAILLE_PART].to_vec();
        inverse.extend_from_slice(&parts[..TAILLE_PART]);
        inverse.extend_from_slice(&parts[2 * TAILLE_PART..]);
        assert!(!verifier_preuve(GRAINE, 4, 3, &inverse));
        let mut alteree = parts.clone();
        alteree[5] ^= 1;
        assert!(!verifier_preuve(GRAINE, 4, 3, &alteree));
        let mut doublon = parts[..TAILLE_PART].to_vec();
        doublon.extend_from_slice(&parts[..TAILLE_PART]);
        assert!(!verifier_preuve(GRAINE, 4, 2, &doublon));
    }
}
