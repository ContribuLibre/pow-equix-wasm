//! Interface C minimale de `pow-equix` pour WebAssembly.
//!
//! Un seul module résout et vérifie : le navigateur n’appelle que `essayer`
//! (ou `preparer` puis `chercher`), un serveur que `verifier`. Aucune allocation
//! n’est demandée à JavaScript : le module expose un tampon statique organisé ainsi :
//!
//! ```text
//! [0, GRAINE_MAX)                          graine, écrite par l’appelant
//! [GRAINE_MAX, + PARTS_MAX × 26)           preuve à vérifier, ou solution trouvée
//! [ZONE_PROGRAMME, + 48)                   en-tête de l’essai préparé (voir `preparer`)
//! [ZONE_PROGRAMME + 48, + 512 × 8)         programme HashX encodé (hashx::expose)
//! ```
//!
//! Deux façons de faire un essai :
//!
//! - `essayer` : tout dans le module, HashX interprété ;
//! - `preparer`, puis le remplissage de la table par un programme compilé en
//!   WebAssembly par le chargeur JavaScript (qui importe la mémoire de ce
//!   module), puis `chercher`. Le résultat est le même, octet pour octet.

use pow_equix::hashx::expose::TAILLE_PROGRAMME;
use pow_equix::{GRAINE_MAX, PARTS_MAX, Parametres, Solveur, TAILLE_PART_MAX, VERSION_FORMAT, decoder_preuve, taille_max_preuve, verifier_preuve};
use std::cell::RefCell;

const ZONE_PARTS: usize = GRAINE_MAX;
const ZONE_PROGRAMME: usize = ZONE_PARTS + PARTS_MAX * TAILLE_PART_MAX;
const TAILLE_ENTETE: usize = 48;
const TAILLE_TAMPON: usize = ZONE_PROGRAMME + TAILLE_ENTETE + TAILLE_PROGRAMME;

struct Tampon(core::cell::UnsafeCell<[u8; TAILLE_TAMPON]>);

// WebAssembly sans threads : un seul fil d’exécution touche le tampon.
unsafe impl Sync for Tampon {}

static TAMPON: Tampon = Tampon(core::cell::UnsafeCell::new([0; TAILLE_TAMPON]));

fn tampon() -> &'static mut [u8; TAILLE_TAMPON] {
    // SAFETY : module mono-fil, et aucune référence ne survit à l’appel exporté.
    unsafe { &mut *TAMPON.0.get() }
}

/// Copie de la graine, pour ne pas garder d’emprunt sur le tampon pendant l’écriture.
fn graine(longueur: u32) -> Option<Vec<u8>> {
    let longueur = longueur as usize;
    (1..=GRAINE_MAX).contains(&longueur).then(|| tampon()[..longueur].to_vec())
}

thread_local! {
    static SOLVEUR: RefCell<Solveur> = RefCell::new(Solveur::new());
}

fn ecrire_solution(solution: Option<Vec<u8>>) -> u32 {
    match solution {
        Some(solution) => {
            tampon()[ZONE_PARTS..ZONE_PARTS + solution.len()].copy_from_slice(&solution);
            1
        }
        None => 0,
    }
}

/// Adresse du tampon d’échange dans la mémoire du module.
#[unsafe(no_mangle)]
pub extern "C" fn tampon_adresse() -> *mut u8 {
    TAMPON.0.get().cast()
}

/// Taille du tampon d’échange.
#[unsafe(no_mangle)]
pub extern "C" fn tampon_taille() -> u32 {
    TAILLE_TAMPON as u32
}

/// Taille maximale de la graine, début de la zone des parts.
#[unsafe(no_mangle)]
pub extern "C" fn graine_max() -> u32 {
    GRAINE_MAX as u32
}

/// Début de l’en-tête de l’essai préparé, relatif au tampon.
#[unsafe(no_mangle)]
pub extern "C" fn zone_programme() -> u32 {
    ZONE_PROGRAMME as u32
}

/// Version du format de défi, pour qu’un module d’une autre version soit détecté au chargement.
#[unsafe(no_mangle)]
pub extern "C" fn version_format() -> u32 {
    VERSION_FORMAT
}

/// Preuve de `longueur` octets écrite après la graine, si sa taille est possible pour `nombre` et n.
fn preuve(nombre: u32, n: u32, longueur: u32) -> Option<&'static [u8]> {
    let longueur = longueur as usize;
    (longueur <= taille_max_preuve(n, nombre as usize)).then(|| &tampon()[ZONE_PARTS..ZONE_PARTS + longueur])
}

/// Vérifie la preuve de `longueur` octets écrite après la graine (`nombre`
/// parts, paramètre n). Renvoie 1 si elle est valide.
#[unsafe(no_mangle)]
pub extern "C" fn verifier(longueur_graine: u32, effort: u32, nombre: u32, n: u32, longueur: u32) -> u32 {
    let Some(graine) = graine(longueur_graine) else { return 0 };
    let Some(preuve) = preuve(nombre, n, longueur) else { return 0 };
    u32::from(verifier_preuve(&graine, effort, nombre as usize, preuve, n))
}

/// Décode la preuve de `longueur` octets écrite après la graine, sans la
/// vérifier : écrit ses `nombre` compteurs (u32 petit-boutistes) au début de la
/// zone du programme et renvoie 1, ou 0 si sa forme n’est pas la forme unique.
#[unsafe(no_mangle)]
pub extern "C" fn compteurs(nombre: u32, n: u32, longueur: u32) -> u32 {
    let Some(parts) = preuve(nombre, n, longueur).and_then(|preuve| decoder_preuve(preuve, nombre as usize, n)) else { return 0 };
    let compteurs: Vec<u32> = parts.iter().map(|&(compteur, _)| compteur).collect();
    for (rang, compteur) in compteurs.into_iter().enumerate() {
        tampon()[ZONE_PROGRAMME + rang * 4..ZONE_PROGRAMME + rang * 4 + 4].copy_from_slice(&compteur.to_le_bytes());
    }
    1
}

/// Un essai complet sur le compteur donné, HashX interprété. Renvoie 1 et écrit
/// la solution rangée (n/4 + 1 octets) au début de la zone des
/// parts si elle atteint l’effort, 0 sinon.
#[unsafe(no_mangle)]
pub extern "C" fn essayer(longueur_graine: u32, effort: u32, compteur: u32, n: u32) -> u32 {
    let Some(graine) = graine(longueur_graine) else { return 0 };
    ecrire_solution(SOLVEUR.with(|solveur| solveur.borrow_mut().essayer(&graine, compteur, effort, n)))
}

/// Première moitié d’un essai : construit le programme HashX et prépare la
/// mémoire du solveur. Renvoie 0 si le défi n’a pas de programme valide (l’essai
/// échoue), sinon 1 après avoir écrit l’en-tête, en u32 petit-boutistes :
///
/// ```text
/// +0   n
/// +4   nombre d’éléments de la table, 2^(n/4+1)
/// +8   adresse des mots bas de la table (u64 par élément)
/// +12  adresse des bits hauts de la table (u32 par élément, n > 64), sinon 0
/// +16  clé des registres HashX, 4 × u64
/// +48  programme encodé, 512 × 8 octets
/// ```
///
/// Il reste à écrire la table, puis à appeler `chercher`.
#[unsafe(no_mangle)]
pub extern "C" fn preparer(longueur_graine: u32, compteur: u32, n: u32) -> u32 {
    let Some(graine) = graine(longueur_graine) else { return 0 };
    SOLVEUR.with(|solveur| {
        let mut solveur = solveur.borrow_mut();
        let Some(programme) = solveur.preparer(&graine, compteur, n) else { return 0 };
        let (Some(encode), cle) = (programme.programme_encode(), programme.cle_registres()) else { return 0 };
        let Some(memoire) = solveur.memoire_preparee() else { return 0 };
        let parametres: Parametres = memoire.parametres();
        let basse = memoire.table_basse().as_mut_ptr() as u32;
        let haute = if n > 64 { memoire.table_haute().as_mut_ptr() as u32 } else { 0 };
        let entete = &mut tampon()[ZONE_PROGRAMME..];
        for (rang, valeur) in [n, parametres.elements() as u32, basse, haute].into_iter().enumerate() {
            entete[rang * 4..rang * 4 + 4].copy_from_slice(&valeur.to_le_bytes());
        }
        for (rang, mot) in cle.into_iter().enumerate() {
            entete[16 + rang * 8..24 + rang * 8].copy_from_slice(&mot.to_le_bytes());
        }
        entete[TAILLE_ENTETE..TAILLE_ENTETE + TAILLE_PROGRAMME].copy_from_slice(&encode);
        1
    })
}

/// Remplit la table de l’essai préparé avec l’interprète : ce que fait `essayer`,
/// en deux temps (repli quand la compilation échoue en cours de route).
#[unsafe(no_mangle)]
pub extern "C" fn remplir() {
    SOLVEUR.with(|solveur| solveur.borrow_mut().remplir());
}

/// Seconde moitié d’un essai, une fois la table remplie. Renvoie 1 et écrit la
/// solution au début de la zone des parts si l’une atteint l’effort, 0 sinon.
#[unsafe(no_mangle)]
pub extern "C" fn chercher(effort: u32) -> u32 {
    ecrire_solution(SOLVEUR.with(|solveur| solveur.borrow_mut().chercher(effort)))
}
