# Fiche machine pour le banc pow-equix-wasm — macOS (bash ou zsh). Écrit
# config-machine.json dans le dossier courant et l’affiche. Rien n’est envoyé sur le réseau.
(
j() { printf '%s' "$1" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/'; }
nb() { case "$1" in ''|*[!0-9]*) printf 'null' ;; *) printf '%s' "$1" ;; esac; }
materiel=$(system_profiler SPHardwareDataType 2>/dev/null)
champ() { printf '%s\n' "$materiel" | awk -F': ' -v cle="$1" '$1 ~ cle {print $2; exit}'; }
modele="$(champ 'Model Name') ($(champ 'Model Identifier'))"
processeur=$(sysctl -n machdep.cpu.brand_string 2>/dev/null)
[ -z "$processeur" ] && processeur=$(champ 'Chip')
hz=$(sysctl -n hw.cpufrequency_max 2>/dev/null)
mhz=''; [ -n "$hz" ] && mhz=$((hz / 1000000))
gpus=''
while IFS= read -r ligne; do [ -n "$ligne" ] && gpus="$gpus${gpus:+, }$(j "$ligne")"; done <<GPU
$(system_profiler SPDisplaysDataType 2>/dev/null | awk -F': ' '/Chipset Model/ {print $2}')
GPU
cat > config-machine.json <<JSON
{
  "format": "pow-equix-wasm/config-machine",
  "version": 1,
  "source": "macos",
  "date": $(j "$(date -u +%Y-%m-%dT%H:%M:%SZ)"),
  "machine": { "fabricant": "Apple", "modele": $(j "$modele") },
  "processeur": { "modele": $(j "$processeur"), "frequenceMaxMHz": $(nb "$mhz"), "turbo": null, "coeursPhysiques": $(nb "$(sysctl -n hw.physicalcpu)"), "coeursLogiques": $(nb "$(sysctl -n hw.logicalcpu)"), "architecture": $(j "$(uname -m)") },
  "memoire": { "totaleOctets": $(nb "$(sysctl -n hw.memsize)") },
  "gpu": [$gpus],
  "systeme": { "nom": $(j "macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion))"), "noyau": $(j "$(uname -sr)") }
}
JSON
cat config-machine.json
)
