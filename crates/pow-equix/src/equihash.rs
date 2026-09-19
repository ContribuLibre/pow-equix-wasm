//! Equihash(n, k = 3) sur HashX : paramètres, règles d’une solution, vérification.
//!
//! Equi-X est le cas n = 60 : liste de 2¹⁶ valeurs HashX par défi, solutions
//! de 8 indices. Ce module généralise aux n multiples de 4 de 60 à 80, en
//! gardant pour n = 60 exactement les règles d’Equi-X (crate `equix` d’Arti),
//! que les tests comparent solution par solution.
//!
//! Avec `c = n / 4` bits par étage et `2^(c+1)` indices :
//!
//! - valeur d’un indice `i` : `HashX(i)` sur les n bits de poids faible de la
//!   sortie, prise sur le premier mot de 64 bits (n ≤ 64) ou sur les deux
//!   premiers (`mot0 | mot1 << 64`, n > 64) ;
//! - les sommes (modulo 2ⁿ) des paires d’indices voisins s’annulent sur leurs
//!   c bits de poids faible, celles des quadruplets sur 2c bits et la somme des
//!   huit sur les n bits ;
//! - ordre canonique : à chaque nœud de l’arbre, la moitié gauche, lue de son
//!   dernier élément vers le premier, ne dépasse pas la moitié droite lue de la
//!   même façon (ordre lexicographique inversé, égalité permise, comme Equi-X) ;
//! - tout indice est inférieur à `2^(c+1)`.

use hashx::{HashX, HashXBuilder, RuntimeOption};
use std::cmp::Ordering;

/// n d’Equi-X, et valeur par défaut.
pub const N_EQUIX: u32 = 60;
/// Plus grand n accepté.
pub const N_MAX: u32 = 80;
/// Valeurs de n acceptées : multiples de 4, de 60 à 80.
pub const N_VALIDES: [u32; 6] = [60, 64, 68, 72, 76, 80];
/// Indices par solution (2^k, k = 3).
pub const INDICES: usize = 8;
/// Capacité d’un seau du solveur, comme Equi-X : 336 places pour 256 éléments en moyenne.
pub(crate) const CAPACITE: usize = 336;
/// Seaux et capacité de la table temporaire de recherche de collisions, comme Equi-X.
pub(crate) const SEAUX_TEMP: usize = 128;
pub(crate) const CAPACITE_TEMP: usize = 12;
/// Bits d’un indice d’élément dans un seau : 336 < 2⁹.
pub(crate) const BITS_ELEMENT: u32 = 9;

/// Une solution : 8 indices dans l’ordre canonique.
pub type Solution = [u32; INDICES];

/// Paramètres dérivés de n.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct Parametres {
    n: u32,
}

impl Parametres {
    /// Paramètres pour n, ou `None` si n n’est pas accepté.
    pub fn new(n: u32) -> Option<Self> {
        n_valide(n).then_some(Self { n })
    }

    pub fn n(&self) -> u32 {
        self.n
    }

    /// Bits annulés par étage : c = n / 4.
    pub fn bits_etage(&self) -> u32 {
        self.n / 4
    }

    /// Taille de la liste : 2^(c+1) indices, de 0 à `elements() - 1`.
    pub fn elements(&self) -> usize {
        1 << (self.bits_etage() + 1)
    }

    /// Bits de seau b = c − 7 : 2^b seaux de 256 éléments en moyenne, pour que
    /// la table temporaire (128 seaux) couvre les 7 bits restants de l’étage.
    /// Pour n = 60 : 256 seaux, comme Equi-X.
    pub fn bits_seau(&self) -> u32 {
        self.bits_etage() - 7
    }

    pub fn seaux(&self) -> usize {
        1 << self.bits_seau()
    }

    /// Places d’une couche : seaux × 336.
    pub fn cases(&self) -> usize {
        self.seaux() * CAPACITE
    }

    /// Octets d’une solution sérialisée : 8 × u16 pour n = 60 (format
    /// d’Equi-X), 8 × u32 au-delà.
    pub fn taille_solution(&self) -> usize {
        if self.n == N_EQUIX { 16 } else { 32 }
    }

    /// Les valeurs HashX dépassent-elles 64 bits ?
    pub(crate) fn valeurs_larges(&self) -> bool {
        self.n > 64
    }

    /// Masque des bits de poids fort (au-delà de 64) d’une valeur HashX.
    pub(crate) fn masque_haut(&self) -> u64 {
        if self.valeurs_larges() { (1u64 << (self.n - 64)) - 1 } else { 0 }
    }

    /// Mémoire de travail du solveur, en octets (voir `solveur.rs`).
    pub fn memoire_solveur(&self) -> usize {
        let cases = self.cases();
        // Clés et valeurs des trois couches (la troisième recouvre les clés de la première).
        let mut octets = cases * (8 + 2 + 8 + 4);
        if self.elements() > 1 << 16 {
            octets += cases; // bits hauts des indices
        }
        if self.n - self.bits_seau() > 64 {
            octets += cases; // bits hauts des clés de la première couche
        }
        octets + 3 * self.seaux() * 2 + SEAUX_TEMP * CAPACITE_TEMP * 2 + SEAUX_TEMP
    }
}

pub fn n_valide(n: u32) -> bool {
    N_VALIDES.contains(&n)
}

/// Séparation de domaine du programme HashX pour n > 60.
pub const SEPARATION_N: &[u8] = b"pow-equix/equihash-k3-n";

/// Graine du programme HashX : le défi pour n = 60 (Equi-X), sinon
/// `défi ‖ "pow-equix/equihash-k3-n" ‖ n` (un octet), pour que chaque n tire
/// des programmes à part. C’est aussi le préfixe du hachage de la règle d’effort.
pub fn graine_hashx(defi: &[u8], n: u32) -> Vec<u8> {
    let mut graine = Vec::with_capacity(defi.len() + SEPARATION_N.len() + 1);
    graine.extend_from_slice(defi);
    if n != N_EQUIX {
        graine.extend_from_slice(SEPARATION_N);
        graine.push(n as u8);
    }
    graine
}

/// Programme HashX interprété pour une graine, ou `None` si la graine ne
/// donne aucun programme valide (quelques graines sur plusieurs milliers).
pub fn hashx_interprete(graine: &[u8]) -> Option<HashX> {
    let mut constructeur = HashXBuilder::new();
    constructeur.runtime(RuntimeOption::InterpretOnly);
    constructeur.build(graine).ok()
}

/// Valeur d’un indice. Pour n ≤ 64, le premier mot entier, comme Equi-X : les
/// bits au-delà de n n’influent jamais sur les bits contrôlés.
pub fn valeur(hashx: &HashX, parametres: Parametres, indice: u32) -> u128 {
    if parametres.valeurs_larges() {
        let mot = hashx.hash_to_u128(u64::from(indice));
        mot & ((1u128 << parametres.n()) - 1)
    } else {
        u128::from(hashx.hash_to_u64(u64::from(indice)))
    }
}

fn branches_triees(gauche: &[u32], droite: &[u32]) -> bool {
    gauche.iter().rev().cmp(droite.iter().rev()) != Ordering::Greater
}

/// L’ordre canonique est-il respecté à chaque nœud ?
pub fn ordre_canonique(indices: &[u32]) -> bool {
    let (gauche, droite) = indices.split_at(indices.len() / 2);
    let triees = branches_triees(gauche, droite);
    if indices.len() == 2 { triees } else { triees && ordre_canonique(gauche) && ordre_canonique(droite) }
}

/// Met les indices dans l’ordre canonique, comme le solveur d’Equi-X.
pub(crate) fn trier(indices: &mut [u32]) {
    let longueur = indices.len();
    let (gauche, droite) = indices.split_at_mut(longueur / 2);
    if longueur > 2 {
        trier(gauche);
        trier(droite);
    }
    if !branches_triees(gauche, droite) {
        gauche.swap_with_slice(droite);
    }
}

/// Sommes de l’arbre : c bits pour une paire, 2c pour un quadruplet, n pour les huit.
fn sommes_nulles(valeurs: &[u128], bits: u32) -> Option<u128> {
    let somme = if valeurs.len() == 2 {
        valeurs[0].wrapping_add(valeurs[1])
    } else {
        let (gauche, droite) = valeurs.split_at(valeurs.len() / 2);
        sommes_nulles(gauche, bits / 2)?.wrapping_add(sommes_nulles(droite, bits / 2)?)
    };
    (somme & ((1u128 << bits) - 1) == 0).then_some(somme)
}

/// Vérifie une solution pour un programme HashX déjà construit.
pub fn solution_valide(hashx: &HashX, parametres: Parametres, indices: &Solution) -> bool {
    if indices.iter().any(|&indice| indice as usize >= parametres.elements()) || !ordre_canonique(indices) {
        return false;
    }
    let valeurs = indices.map(|indice| valeur(hashx, parametres, indice));
    sommes_nulles(&valeurs, parametres.n()).is_some()
}

/// Sérialise une solution : u16 petit-boutistes pour n = 60, u32 au-delà.
pub fn encoder(parametres: Parametres, indices: &Solution) -> Vec<u8> {
    let mut octets = Vec::with_capacity(parametres.taille_solution());
    for &indice in indices {
        if parametres.n() == N_EQUIX {
            octets.extend_from_slice(&(indice as u16).to_le_bytes());
        } else {
            octets.extend_from_slice(&indice.to_le_bytes());
        }
    }
    octets
}

/// Lit une solution sérialisée, ou `None` si sa taille ne correspond pas à n.
pub fn decoder(parametres: Parametres, octets: &[u8]) -> Option<Solution> {
    if octets.len() != parametres.taille_solution() {
        return None;
    }
    let largeur = octets.len() / INDICES;
    let mut indices = [0u32; INDICES];
    for (indice, bloc) in indices.iter_mut().zip(octets.chunks_exact(largeur)) {
        *indice = bloc.iter().rev().fold(0u32, |valeur, &octet| (valeur << 8) | u32::from(octet));
    }
    Some(indices)
}
