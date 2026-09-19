//! Solveur Equihash(n, 3) sur HashX, fidèle à celui d’Equi-X pour n = 60.
//!
//! L’algorithme reprend celui de la crate `equix` (lui-même celui de tevador) :
//! trois couches de seaux à capacité fixe, une petite table temporaire pour
//! apparier deux seaux complémentaires, et les mêmes règles d’abandon quand un
//! seau déborde. L’ordre des parcours est identique, si bien que pour n = 60 les
//! solutions trouvées, et leur ordre, sont celles d’Equi-X. Pour n > 60, seul le
//! nombre de seaux change (2^(c−7)) : chaque seau garde 256 éléments en moyenne
//! pour 336 places, et la table temporaire ses 128 seaux de 12 places.
//!
//! Le travail se fait en deux temps, pour que le calcul des valeurs HashX
//! puisse venir d’ailleurs (programme compilé en WebAssembly côté JavaScript) :
//!
//! 1. la **table** des 2^(c+1) valeurs HashX, écrite à plat : mots bas dans
//!    `cles1`, bits hauts (n > 64) dans `valeurs1`, deux zones libres à ce
//!    moment-là ;
//! 2. la **recherche**, qui range la table dans la première couche puis
//!    cherche les collisions étage par étage.
//!
//! Mémoire : clés (u64) et valeurs (u16, plus un octet haut au-delà de 2¹⁶
//! indices) de la première couche, clés (u64) et valeurs (u32) de la
//! deuxième ; la troisième (clé u32 et valeur u32 réunies dans un u64) recouvre
//! les clés de la première, devenues inutiles. Pour n = 60 : 1 892 352 octets
//! plus la table temporaire, soit la taille de `equix::SolverMemory`.

use crate::equihash::{BITS_ELEMENT, CAPACITE, CAPACITE_TEMP, INDICES, Parametres, SEAUX_TEMP, Solution, trier};

/// Au plus 8 solutions par défi sont gardées, comme Equi-X.
pub const SOLUTIONS_MAX: usize = 8;

/// Clé complète d’une couche : u64, ou u128 pour la première couche au-delà de n = 64.
trait Cle: Copy {
    fn plus(self, autre: Self) -> Self;
    fn oppose(self) -> Self;
    /// Bits de poids faible, assez pour un seau et un seau temporaire (< 32 bits).
    fn bas(self) -> usize;
    fn bits_nuls(self, bits: u32) -> bool;
    /// `(self >> bits)` ramené à 64 bits : jamais tronqué sur les bits utiles.
    fn decaler(self, bits: u32) -> u64;
}

impl Cle for u64 {
    #[inline(always)]
    fn plus(self, autre: Self) -> Self {
        self.wrapping_add(autre)
    }
    #[inline(always)]
    fn oppose(self) -> Self {
        self.wrapping_neg()
    }
    #[inline(always)]
    fn bas(self) -> usize {
        self as u32 as usize
    }
    #[inline(always)]
    fn bits_nuls(self, bits: u32) -> bool {
        self & ((1u64 << bits) - 1) == 0
    }
    #[inline(always)]
    fn decaler(self, bits: u32) -> u64 {
        self >> bits
    }
}

impl Cle for u128 {
    #[inline(always)]
    fn plus(self, autre: Self) -> Self {
        self.wrapping_add(autre)
    }
    #[inline(always)]
    fn oppose(self) -> Self {
        self.wrapping_neg()
    }
    #[inline(always)]
    fn bas(self) -> usize {
        self as u32 as usize
    }
    #[inline(always)]
    fn bits_nuls(self, bits: u32) -> bool {
        self & ((1u128 << bits) - 1) == 0
    }
    #[inline(always)]
    fn decaler(self, bits: u32) -> u64 {
        (self >> bits) as u64
    }
}

/// Table temporaire : pour un seau, indices d’éléments rangés selon les 7 bits suivants de leur clé.
struct Temporaire {
    comptes: [u8; SEAUX_TEMP],
    elements: [u16; SEAUX_TEMP * CAPACITE_TEMP],
}

/// Collision entre l’élément `premier_element` du seau `premier_seau` et
/// l’élément `second_element` du seau complémentaire, empaquetée sur 32 bits.
#[inline(always)]
fn empaqueter(premier_seau: usize, premier_element: usize, second_element: usize) -> u32 {
    ((premier_seau << (2 * BITS_ELEMENT)) | (premier_element << BITS_ELEMENT) | second_element) as u32
}

#[inline(always)]
fn depaqueter(collision: u32, seaux: usize) -> [usize; 2] {
    let collision = collision as usize;
    let masque = (1 << BITS_ELEMENT) - 1;
    let premier_seau = collision >> (2 * BITS_ELEMENT);
    let second_seau = premier_seau.wrapping_neg() & (seaux - 1);
    [premier_seau * CAPACITE + ((collision >> BITS_ELEMENT) & masque), second_seau * CAPACITE + (collision & masque)]
}

/// Cherche les paires de clés dont la somme s’annule sur `bits` bits de poids
/// faible, en appariant chaque seau à son complémentaire, dans l’ordre d’Equi-X
/// (`collision::search`). `rapporter` reçoit la somme décalée de `bits` et la collision.
#[inline(always)]
fn chercher<K: Cle>(
    parametres: Parametres,
    comptes: &[u16],
    temporaire: &mut Temporaire,
    bits: u32,
    cle: impl Fn(usize, usize) -> K,
    mut rapporter: impl FnMut(u64, u32),
) {
    let seaux = parametres.seaux();
    let bits_seau = parametres.bits_seau();
    for premier_seau in 0..=seaux / 2 {
        let second_seau = premier_seau.wrapping_neg() & (seaux - 1);
        temporaire.comptes = [0; SEAUX_TEMP];
        for premier_element in 0..usize::from(comptes[premier_seau]) {
            let seau_temp = (cle(premier_seau, premier_element).bas() >> bits_seau) & (SEAUX_TEMP - 1);
            let compte = usize::from(temporaire.comptes[seau_temp]);
            if compte < CAPACITE_TEMP {
                temporaire.elements[seau_temp * CAPACITE_TEMP + compte] = premier_element as u16;
                temporaire.comptes[seau_temp] += 1;
            }
        }
        for second_element in 0..usize::from(comptes[second_seau]) {
            let seconde = cle(second_seau, second_element);
            let seau_temp = (seconde.oppose().bas() >> bits_seau) & (SEAUX_TEMP - 1);
            let debut = seau_temp * CAPACITE_TEMP;
            for &premier_element in &temporaire.elements[debut..debut + usize::from(temporaire.comptes[seau_temp])] {
                let premier_element = usize::from(premier_element);
                let somme = cle(premier_seau, premier_element).plus(seconde);
                if somme.bits_nuls(bits) {
                    rapporter(somme.decaler(bits), empaqueter(premier_seau, premier_element, second_element));
                }
            }
        }
    }
}

/// Mémoire de travail du solveur pour un n donné, réutilisée d’un essai à l’autre.
pub struct MemoireSolveur {
    parametres: Parametres,
    /// Couche 0 : clé sans ses bits de seau ; puis couche 2 : `clé (u32) | valeur << 32`.
    cles0: Vec<u64>,
    /// Couche 0 : bits de clé au-delà de 64 (n = 80 seulement).
    cles0_haut: Vec<u8>,
    /// Couche 0 : indice de l’élément (16 bits bas).
    valeurs0: Vec<u16>,
    /// Couche 0 : bits hauts de l’indice (au-delà de 2¹⁶ éléments).
    valeurs0_haut: Vec<u8>,
    /// Couche 1 : clé sans ses bits de seau ; avant la recherche, mots bas de la table.
    cles1: Vec<u64>,
    /// Couche 1 : collision de la couche 0 ; avant la recherche, bits hauts de la table (n > 64).
    valeurs1: Vec<u32>,
    comptes0: Vec<u16>,
    comptes1: Vec<u16>,
    comptes2: Vec<u16>,
    temporaire: Box<Temporaire>,
}

impl MemoireSolveur {
    pub fn new(parametres: Parametres) -> Self {
        let cases = parametres.cases();
        let seaux = parametres.seaux();
        Self {
            parametres,
            cles0: vec![0; cases],
            cles0_haut: if parametres.n() - parametres.bits_seau() > 64 { vec![0; cases] } else { Vec::new() },
            valeurs0: vec![0; cases],
            valeurs0_haut: if parametres.elements() > 1 << 16 { vec![0; cases] } else { Vec::new() },
            cles1: vec![0; cases],
            valeurs1: vec![0; cases],
            comptes0: vec![0; seaux],
            comptes1: vec![0; seaux],
            comptes2: vec![0; seaux],
            temporaire: Box::new(Temporaire { comptes: [0; SEAUX_TEMP], elements: [0; SEAUX_TEMP * CAPACITE_TEMP] }),
        }
    }

    pub fn parametres(&self) -> Parametres {
        self.parametres
    }

    /// Mots bas (64 bits) de la table des valeurs HashX, un par indice.
    pub fn table_basse(&mut self) -> &mut [u64] {
        let elements = self.parametres.elements();
        &mut self.cles1[..elements]
    }

    /// Bits hauts de la table (au-delà de 64, n > 64), un u32 par indice.
    pub fn table_haute(&mut self) -> &mut [u32] {
        let elements = self.parametres.elements();
        &mut self.valeurs1[..elements]
    }

    /// Remplit la table avec l’interprète HashX.
    pub fn remplir(&mut self, hashx: &hashx::HashX) {
        let parametres = self.parametres;
        if parametres.valeurs_larges() {
            let masque = parametres.masque_haut();
            let elements = parametres.elements();
            for indice in 0..elements {
                let mot = hashx.hash_to_u128(indice as u64);
                self.cles1[indice] = mot as u64;
                self.valeurs1[indice] = ((mot >> 64) as u64 & masque) as u32;
            }
        } else {
            for (indice, case) in self.table_basse().iter_mut().enumerate() {
                *case = hashx.hash_to_u64(indice as u64);
            }
        }
    }

    /// Cherche les solutions d’après la table remplie, dans l’ordre d’Equi-X.
    pub fn resoudre(&mut self) -> Vec<Solution> {
        let parametres = self.parametres;
        if parametres.valeurs_larges() {
            self.ranger_premiere_couche();
            self.premier_etage::<u128>();
        } else {
            self.ranger_premiere_couche();
            self.premier_etage::<u64>();
        }
        self.deuxieme_etage();
        self.dernier_etage()
    }

    /// Range la table dans la couche 0, dans l’ordre des indices.
    fn ranger_premiere_couche(&mut self) {
        let parametres = self.parametres;
        let bits_seau = parametres.bits_seau();
        let masque_seau = parametres.seaux() - 1;
        let large = parametres.valeurs_larges();
        self.comptes0.fill(0);
        for indice in 0..parametres.elements() {
            let valeur = u128::from(self.cles1[indice]) | if large { u128::from(self.valeurs1[indice]) << 64 } else { 0 };
            let seau = valeur as usize & masque_seau;
            let compte = usize::from(self.comptes0[seau]);
            if compte < CAPACITE {
                let case = seau * CAPACITE + compte;
                let reste = valeur >> bits_seau;
                self.cles0[case] = reste as u64;
                if !self.cles0_haut.is_empty() {
                    self.cles0_haut[case] = (reste >> 64) as u8;
                }
                self.valeurs0[case] = indice as u16;
                if !self.valeurs0_haut.is_empty() {
                    self.valeurs0_haut[case] = (indice >> 16) as u8;
                }
                self.comptes0[seau] += 1;
            }
        }
    }

    /// Paires de valeurs nulles sur c bits : couche 0 → couche 1.
    fn premier_etage<K: Cle + CleLarge>(&mut self) {
        let parametres = self.parametres;
        let bits_seau = parametres.bits_seau();
        let masque_seau = parametres.seaux() - 1;
        let (cles0, cles0_haut) = (&self.cles0, &self.cles0_haut);
        let (cles1, valeurs1, comptes1) = (&mut self.cles1, &mut self.valeurs1, &mut self.comptes1);
        comptes1.fill(0);
        let cle = |seau: usize, element: usize| -> K {
            let case = seau * CAPACITE + element;
            K::assembler(cles0[case], cles0_haut.get(case).copied().unwrap_or(0), bits_seau, seau)
        };
        chercher(parametres, &self.comptes0, &mut self.temporaire, parametres.bits_etage(), cle, |somme, collision| {
            let seau = somme as usize & masque_seau;
            let compte = usize::from(comptes1[seau]);
            if compte < CAPACITE {
                cles1[seau * CAPACITE + compte] = somme >> bits_seau;
                valeurs1[seau * CAPACITE + compte] = collision;
                comptes1[seau] += 1;
            }
        });
    }

    /// Quadruplets nuls sur 2c bits : couche 1 → couche 2 (qui recouvre les clés de la couche 0).
    fn deuxieme_etage(&mut self) {
        let parametres = self.parametres;
        let bits_seau = parametres.bits_seau();
        let masque_seau = parametres.seaux() - 1;
        let cles1 = &self.cles1;
        let (couche2, comptes2) = (&mut self.cles0, &mut self.comptes2);
        comptes2.fill(0);
        let cle = |seau: usize, element: usize| -> u64 { (cles1[seau * CAPACITE + element] << bits_seau) | seau as u64 };
        chercher(parametres, &self.comptes1, &mut self.temporaire, parametres.bits_etage(), cle, |somme, collision| {
            let seau = somme as usize & masque_seau;
            let compte = usize::from(comptes2[seau]);
            if compte < CAPACITE {
                couche2[seau * CAPACITE + compte] = u64::from((somme >> bits_seau) as u32) | (u64::from(collision) << 32);
                comptes2[seau] += 1;
            }
        });
    }

    /// Octuplets nuls sur n bits : remonte l’arbre des collisions jusqu’aux indices.
    fn dernier_etage(&mut self) -> Vec<Solution> {
        let parametres = self.parametres;
        let seaux = parametres.seaux();
        let bits_seau = parametres.bits_seau();
        let (couche2, valeurs1, valeurs0, valeurs0_haut) = (&self.cles0, &self.valeurs1, &self.valeurs0, &self.valeurs0_haut);
        let cle = |seau: usize, element: usize| -> u64 { (u64::from(couche2[seau * CAPACITE + element] as u32) << bits_seau) | seau as u64 };
        let indice = |case: usize| -> u32 { u32::from(valeurs0[case]) | u32::from(valeurs0_haut.get(case).copied().unwrap_or(0)) << 16 };
        let mut solutions: Vec<Solution> = Vec::new();
        chercher(parametres, &self.comptes2, &mut self.temporaire, 2 * parametres.bits_etage(), cle, |_somme, collision| {
            let mut indices = [0u32; INDICES];
            let mut position = 0;
            for case2 in depaqueter(collision, seaux) {
                for case1 in depaqueter((couche2[case2] >> 32) as u32, seaux) {
                    for case0 in depaqueter(valeurs1[case1], seaux) {
                        indices[position] = indice(case0);
                        position += 1;
                    }
                }
            }
            trier(&mut indices);
            if solutions.last() != Some(&indices) && solutions.len() < SOLUTIONS_MAX {
                solutions.push(indices);
            }
        });
        solutions
    }
}

/// Reconstitue une clé de la couche 0 depuis son stockage.
trait CleLarge {
    fn assembler(bas: u64, haut: u8, bits_seau: u32, seau: usize) -> Self;
}

impl CleLarge for u64 {
    #[inline(always)]
    fn assembler(bas: u64, _haut: u8, bits_seau: u32, seau: usize) -> Self {
        (bas << bits_seau) | seau as u64
    }
}

impl CleLarge for u128 {
    #[inline(always)]
    fn assembler(bas: u64, haut: u8, bits_seau: u32, seau: usize) -> Self {
        ((u128::from(bas) | (u128::from(haut) << 64)) << bits_seau) | seau as u128
    }
}
