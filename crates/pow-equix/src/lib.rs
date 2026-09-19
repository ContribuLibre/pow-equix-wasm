//! Preuve de travail Equi-X liée à une graine, à mémoire réglable.
//!
//! L’appelant choisit la graine : en général une séparation de domaine propre à
//! son protocole suivie de l’empreinte de la requête à protéger. Le défi d’un
//! essai vaut :
//!
//! ```text
//! graine (1 à GRAINE_MAX octets) ‖ compteur (u32 petit-boutiste)
//! ```
//!
//! Le paramètre `n` règle la mémoire du solveur : Equihash(n, 3) sur HashX,
//! avec une liste de 2^(n/4+1) valeurs. `n = 60` est exactement Equi-X (≈ 1,8 Mio),
//! et reste la valeur par défaut ; chaque pas de 4 double la mémoire et le temps
//! d’un essai, jusqu’à n = 80 (≈ 63 Mio). Voir `equihash.rs` pour les règles.
//!
//! Un défi donne en moyenne deux solutions, quel que soit n. Une solution n’est
//! retenue que si `blake2b-256(graine HashX ‖ solution)`, lu en u32
//! gros-boutiste sur ses quatre premiers octets, multiplié par l’effort, ne
//! dépasse pas `u32::MAX` : c’est la règle d’effort du protocole Tor (`hs_pow`),
//! une chance sur `effort` par solution. La graine HashX est le défi lui-même
//! pour n = 60.
//!
//! Une preuve complète réunit `nombre` parts, `compteur ‖ solution`, aux
//! compteurs strictement croissants : 20 octets pour n = 60 (format de la 0.2,
//! inchangé), 36 au-delà (indices sur 32 bits).

#![forbid(unsafe_code)]

pub mod equihash;
#[cfg(feature = "solveur")]
pub mod solveur;

use blake2::digest::consts::U32;
use blake2::{Blake2b, Digest};
pub use hashx::{self, RuntimeOption};
pub use equihash::{N_EQUIX, N_MAX, N_VALIDES, Parametres, Solution, graine_hashx, n_valide};

/// Version du format de défi et de preuve : 2 depuis l’ajout de n (les preuves
/// n = 60 de la version 1 restent valides telles quelles).
pub const VERSION_FORMAT: u32 = 2;
/// Taille maximale d’une graine.
pub const GRAINE_MAX: usize = 256;
/// Taille d’une solution Equi-X (n = 60).
pub const TAILLE_SOLUTION: usize = 16;
/// Taille d’une part de preuve Equi-X (n = 60) : compteur puis solution.
pub const TAILLE_PART: usize = 4 + TAILLE_SOLUTION;
/// Taille maximale d’une part, pour n > 60.
pub const TAILLE_PART_MAX: usize = 4 + 32;
/// Nombre maximal de parts accepté par la vérification.
pub const PARTS_MAX: usize = 64;

/// Taille d’une part pour n (0 si n n’est pas accepté).
pub fn taille_part(n: u32) -> usize {
    Parametres::new(n).map_or(0, |parametres| 4 + parametres.taille_solution())
}

/// Défi d’un essai : la graine suivie du compteur.
pub fn defi(graine: &[u8], compteur: u32) -> Vec<u8> {
    let mut sortie = Vec::with_capacity(graine.len() + 4);
    sortie.extend_from_slice(graine);
    sortie.extend_from_slice(&compteur.to_le_bytes());
    sortie
}

/// Règle d’effort : une solution sur `effort` en moyenne est retenue.
/// `graine_hashx` est le défi pour n = 60 (voir [`graine_hashx`]).
pub fn effort_atteint(graine_hashx: &[u8], solution: &[u8], effort: u32) -> bool {
    if effort <= 1 {
        return true;
    }
    let mut hachage = Blake2b::<U32>::new();
    hachage.update(graine_hashx);
    hachage.update(solution);
    let condensat = hachage.finalize();
    let valeur = u32::from_be_bytes([condensat[0], condensat[1], condensat[2], condensat[3]]);
    u64::from(valeur) * u64::from(effort) <= u64::from(u32::MAX)
}

fn graine_valide(graine: &[u8]) -> bool {
    !graine.is_empty() && graine.len() <= GRAINE_MAX
}

/// Vérifie une part de preuve : la solution sérialisée d’un compteur. La
/// vérification interprète HashX : huit évaluations ne justifient aucune compilation.
pub fn verifier_part(graine: &[u8], compteur: u32, solution: &[u8], effort: u32, n: u32) -> bool {
    let Some(parametres) = Parametres::new(n) else { return false };
    if !graine_valide(graine) {
        return false;
    }
    let Some(indices) = equihash::decoder(parametres, solution) else { return false };
    let graine_hashx = graine_hashx(&defi(graine, compteur), n);
    // Règle d’effort d’abord : un hachage Blake2b coûte moins que la génération d’un programme HashX.
    effort_atteint(&graine_hashx, solution, effort)
        && equihash::hashx_interprete(&graine_hashx).is_some_and(|hashx| equihash::solution_valide(&hashx, parametres, &indices))
}

/// Vérifie une preuve complète : exactement `nombre` parts, compteurs strictement croissants.
pub fn verifier_preuve(graine: &[u8], effort: u32, nombre: usize, parts: &[u8], n: u32) -> bool {
    let taille = taille_part(n);
    if taille == 0 || !graine_valide(graine) || nombre == 0 || nombre > PARTS_MAX || parts.len() != nombre * taille {
        return false;
    }
    let mut precedent: Option<u32> = None;
    for part in parts.chunks_exact(taille) {
        let compteur = u32::from_le_bytes([part[0], part[1], part[2], part[3]]);
        if precedent.is_some_and(|valeur| compteur <= valeur) {
            return false;
        }
        precedent = Some(compteur);
        if !verifier_part(graine, compteur, &part[4..], effort, n) {
            return false;
        }
    }
    true
}

/// Solveur réutilisant sa mémoire de travail d’un essai à l’autre (réallouée
/// seulement quand n change).
#[cfg(feature = "solveur")]
pub struct Solveur {
    execution: hashx::RuntimeOption,
    memoire: Option<solveur::MemoireSolveur>,
    /// Programme HashX et graine HashX de l’essai en cours, entre `preparer` et `chercher`.
    courant: Option<(hashx::HashX, Vec<u8>)>,
}

#[cfg(feature = "solveur")]
impl Default for Solveur {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(feature = "solveur")]
impl Solveur {
    /// Nouveau solveur. Avec l’option `compilateur`, HashX tente de produire
    /// du code machine et se rabat sur l’interprète en cas d’échec.
    pub fn new() -> Self {
        Self::avec_execution(if cfg!(feature = "compilateur") { hashx::RuntimeOption::TryCompile } else { hashx::RuntimeOption::InterpretOnly })
    }

    /// Solveur au mode d’exécution de HashX imposé.
    pub fn avec_execution(execution: hashx::RuntimeOption) -> Self {
        Self { execution, memoire: None, courant: None }
    }

    /// Mémoire de travail pour ces paramètres, allouée au premier usage.
    fn memoire(&mut self, parametres: Parametres) -> &mut solveur::MemoireSolveur {
        if self.memoire.as_ref().is_none_or(|memoire| memoire.parametres() != parametres) {
            // Libérer l’ancienne zone avant d’allouer la nouvelle.
            self.memoire = None;
            self.memoire = Some(solveur::MemoireSolveur::new(parametres));
        }
        self.memoire.as_mut().expect("mémoire allouée")
    }

    /// Première moitié d’un essai : construit le programme HashX du défi et
    /// prépare la mémoire. Renvoie le programme, ou `None` si le défi n’en
    /// donne aucun de valide (l’essai échoue alors, comme le prévoit Equi-X).
    pub fn preparer(&mut self, graine: &[u8], compteur: u32, n: u32) -> Option<&hashx::HashX> {
        self.courant = None;
        let parametres = Parametres::new(n)?;
        if !graine_valide(graine) {
            return None;
        }
        let graine_hashx = graine_hashx(&defi(graine, compteur), n);
        let mut constructeur = hashx::HashXBuilder::new();
        constructeur.runtime(self.execution);
        let programme = constructeur.build(&graine_hashx).ok()?;
        self.memoire(parametres);
        self.courant = Some((programme, graine_hashx));
        self.courant.as_ref().map(|(programme, _)| programme)
    }

    /// Mémoire de l’essai préparé, pour qu’un programme compilé ailleurs remplisse la table.
    pub fn memoire_preparee(&mut self) -> Option<&mut solveur::MemoireSolveur> {
        self.courant.as_ref()?;
        self.memoire.as_mut()
    }

    /// Remplit la table de l’essai préparé avec HashX (interprété, ou compilé en natif).
    pub fn remplir(&mut self) {
        if let (Some((programme, _)), Some(memoire)) = (&self.courant, &mut self.memoire) {
            memoire.remplir(programme);
        }
    }

    /// Seconde moitié d’un essai : toutes les solutions de la table remplie.
    pub fn solutions(&mut self) -> Vec<Solution> {
        match (&self.courant, &mut self.memoire) {
            (Some(_), Some(memoire)) => memoire.resoudre(),
            _ => Vec::new(),
        }
    }

    /// Seconde moitié d’un essai : la première solution qui atteint l’effort, sérialisée.
    pub fn chercher(&mut self, effort: u32) -> Option<Vec<u8>> {
        let solutions = self.solutions();
        let (_, graine_hashx) = self.courant.take()?;
        let parametres = self.memoire.as_ref()?.parametres();
        solutions
            .iter()
            .map(|solution| equihash::encoder(parametres, solution))
            .find(|octets| effort_atteint(&graine_hashx, octets, effort))
    }

    /// Un essai complet : la première solution du défi qui atteint l’effort, s’il y en a une.
    pub fn essayer(&mut self, graine: &[u8], compteur: u32, effort: u32, n: u32) -> Option<Vec<u8>> {
        self.preparer(graine, compteur, n)?;
        self.remplir();
        self.chercher(effort)
    }

    /// Preuve complète calculée d’une traite, à partir du compteur `debut`.
    /// Renvoie les parts et le nombre d’essais.
    pub fn prouver(&mut self, graine: &[u8], effort: u32, nombre: usize, debut: u32, n: u32) -> Option<(Vec<u8>, u64)> {
        let taille = taille_part(n);
        if taille == 0 || !graine_valide(graine) || nombre == 0 || nombre > PARTS_MAX {
            return None;
        }
        let mut parts = Vec::with_capacity(nombre * taille);
        let mut essais = 0u64;
        let mut compteur = debut;
        while parts.len() < nombre * taille {
            essais += 1;
            if let Some(solution) = self.essayer(graine, compteur, effort, n) {
                parts.extend_from_slice(&compteur.to_le_bytes());
                parts.extend_from_slice(&solution);
            }
            compteur = compteur.checked_add(1)?;
        }
        Some((parts, essais))
    }
}
