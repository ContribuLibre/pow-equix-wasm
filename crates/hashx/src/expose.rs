//! Ajout de pow-equix-wasm, absent de hashx 0.9.1 : exposer le programme généré.
//!
//! En natif, hashx compile chaque programme en code machine. Pour faire de même
//! en WebAssembly, le chargeur JavaScript de pow-equix-wasm a besoin de la liste
//! d’instructions et de la clé qui initialise puis condense les registres.
//! Cette interface les donne sous une forme encodée, fixe et documentée, sans
//! rien changer au reste de la crate : le programme reste celui de hashx.
//!
//! Encodage d’une instruction, sur [`TAILLE_INSTRUCTION`] octets :
//!
//! ```text
//! [0] code (voir les constantes CODE_*)
//! [1] registre de destination (0 à 7)
//! [2] registre source (0 à 7)
//! [3] décalage à gauche (AddShift, 0 à 3) ou rotation à droite (Rotate, 0 à 63)
//! [4..8] constante u32 petit-boutiste : i32 étendu en signe pour AddConst et
//!        XorConst, masque pour Branch
//! ```
//!
//! Les champs sans objet valent zéro.

use crate::program::{Instruction, NUM_INSTRUCTIONS};
use crate::register::RegisterFile;
use crate::{HashX, RuntimeProgram};

/// Nombre d’instructions d’un programme HashX valide.
pub const NOMBRE_INSTRUCTIONS: usize = NUM_INSTRUCTIONS;
/// Taille d’une instruction encodée.
pub const TAILLE_INSTRUCTION: usize = 8;
/// Taille d’un programme encodé.
pub const TAILLE_PROGRAMME: usize = NOMBRE_INSTRUCTIONS * TAILLE_INSTRUCTION;

/// Multiplication 64 bits, dépassement ignoré.
pub const CODE_MUL: u8 = 0;
/// Moitié haute de la multiplication non signée 64 × 64 → 128 bits.
pub const CODE_UMULH: u8 = 1;
/// Moitié haute de la multiplication signée 64 × 64 → 128 bits.
pub const CODE_SMULH: u8 = 2;
/// `dst += src << décalage`.
pub const CODE_ADD_SHIFT: u8 = 3;
/// `dst += constante` (i32 étendu en signe).
pub const CODE_ADD_CONST: u8 = 4;
/// `dst -= src`.
pub const CODE_SUB: u8 = 5;
/// `dst ^= src`.
pub const CODE_XOR: u8 = 6;
/// `dst ^= constante` (i32 étendu en signe).
pub const CODE_XOR_CONST: u8 = 7;
/// `dst = dst.rotate_right(rotation)`.
pub const CODE_ROTATE: u8 = 8;
/// Cible du prochain branchement pris.
pub const CODE_TARGET: u8 = 9;
/// Branchement unique vers la dernière cible si `masque & mulh == 0`.
pub const CODE_BRANCH: u8 = 10;

fn encoder_instruction(instruction: &Instruction) -> [u8; TAILLE_INSTRUCTION] {
    let (code, dst, src, parametre, constante): (u8, u8, u8, u8, u32) = match instruction {
        Instruction::Mul { dst, src } => (CODE_MUL, dst.as_u8(), src.as_u8(), 0, 0),
        Instruction::UMulH { dst, src } => (CODE_UMULH, dst.as_u8(), src.as_u8(), 0, 0),
        Instruction::SMulH { dst, src } => (CODE_SMULH, dst.as_u8(), src.as_u8(), 0, 0),
        Instruction::AddShift { dst, src, left_shift } => (CODE_ADD_SHIFT, dst.as_u8(), src.as_u8(), *left_shift, 0),
        Instruction::AddConst { dst, src } => (CODE_ADD_CONST, dst.as_u8(), 0, 0, *src as u32),
        Instruction::Sub { dst, src } => (CODE_SUB, dst.as_u8(), src.as_u8(), 0, 0),
        Instruction::Xor { dst, src } => (CODE_XOR, dst.as_u8(), src.as_u8(), 0, 0),
        Instruction::XorConst { dst, src } => (CODE_XOR_CONST, dst.as_u8(), 0, 0, *src as u32),
        Instruction::Rotate { dst, right_rotate } => (CODE_ROTATE, dst.as_u8(), 0, *right_rotate, 0),
        Instruction::Target => (CODE_TARGET, 0, 0, 0, 0),
        Instruction::Branch { mask } => (CODE_BRANCH, 0, 0, 0, *mask),
    };
    let c = constante.to_le_bytes();
    [code, dst, src, parametre, c[0], c[1], c[2], c[3]]
}

impl HashX {
    /// Clé SipHash qui initialise les registres depuis l’entrée, puis les
    /// condense en sortie : `[v0, v1, v2, v3]`.
    pub fn cle_registres(&self) -> [u64; 4] {
        self.register_key.into()
    }

    /// Programme encodé (voir l’en-tête du module), ou `None` si ce HashX a
    /// été compilé en code machine : seul le programme interprété est conservé.
    pub fn programme_encode(&self) -> Option<[u8; TAILLE_PROGRAMME]> {
        let RuntimeProgram::Interpret(programme) = &self.program else { return None };
        let instructions: &[Instruction; NUM_INSTRUCTIONS] = programme.into();
        let mut sortie = [0u8; TAILLE_PROGRAMME];
        for (bloc, instruction) in sortie.chunks_exact_mut(TAILLE_INSTRUCTION).zip(instructions.iter()) {
            bloc.copy_from_slice(&encoder_instruction(instruction));
        }
        Some(sortie)
    }

    /// Les deux premiers mots de la sortie, `mot0 | mot1 << 64` : la sortie
    /// étendue au-delà de 64 bits, au même coût que [`HashX::hash_to_u64`].
    pub fn hash_to_u128(&self, input: u64) -> u128 {
        let mots = self.hash_to_regs(input).digest(self.register_key);
        u128::from(mots[0]) | (u128::from(mots[1]) << 64)
    }

    /// Registres initiaux pour une entrée, avant exécution du programme :
    /// SipHash 2-4 en mode compteur, comme dans hashx.
    pub fn registres_initiaux(&self, input: u64) -> [u64; 8] {
        RegisterFile::new(self.register_key, input).into()
    }
}
