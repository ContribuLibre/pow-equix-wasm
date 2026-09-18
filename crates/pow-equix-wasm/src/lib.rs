//! Interface C minimale de `pow-equix` pour WebAssembly.
//!
//! Un seul module résout et vérifie : le navigateur n’appelle que `essayer`, un
//! serveur que `verifier`. Aucune allocation n’est demandée à JavaScript : le
//! module expose un tampon statique organisé ainsi :
//!
//! ```text
//! [0, GRAINE_MAX)                      graine, écrite par l’appelant
//! [GRAINE_MAX, + PARTS_MAX × 20)       parts à vérifier, ou solution trouvée par `essayer`
//! ```

use pow_equix::{GRAINE_MAX, PARTS_MAX, Solveur, TAILLE_PART, TAILLE_SOLUTION, VERSION_FORMAT, verifier_preuve};
use std::cell::RefCell;

const TAILLE_TAMPON: usize = GRAINE_MAX + PARTS_MAX * TAILLE_PART;

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

/// Version du format de défi, pour qu’un module d’une autre version soit détecté au chargement.
#[unsafe(no_mangle)]
pub extern "C" fn version_format() -> u32 {
    VERSION_FORMAT
}

/// Vérifie `nombre` parts écrites après la graine. Renvoie 1 si la preuve est valide.
#[unsafe(no_mangle)]
pub extern "C" fn verifier(longueur_graine: u32, effort: u32, nombre: u32) -> u32 {
    let nombre = nombre as usize;
    let Some(graine) = graine(longueur_graine) else { return 0 };
    if nombre == 0 || nombre > PARTS_MAX {
        return 0;
    }
    let parts = &tampon()[GRAINE_MAX..GRAINE_MAX + nombre * TAILLE_PART];
    u32::from(verifier_preuve(&graine, effort, nombre, parts))
}

/// Un essai sur le compteur donné. Renvoie 1 et écrit la solution (16 octets)
/// au début de la zone des parts si elle atteint l’effort, 0 sinon.
#[unsafe(no_mangle)]
pub extern "C" fn essayer(longueur_graine: u32, effort: u32, compteur: u32) -> u32 {
    let Some(graine) = graine(longueur_graine) else { return 0 };
    match SOLVEUR.with(|solveur| solveur.borrow_mut().essayer(&graine, compteur, effort)) {
        Some(solution) => {
            tampon()[GRAINE_MAX..GRAINE_MAX + TAILLE_SOLUTION].copy_from_slice(&solution);
            1
        }
        None => 0,
    }
}
