# Fiche machine pour le banc pow-equix-wasm — Linux (bash). Écrit config-machine.json
# dans le dossier courant et l’affiche. Rien n’est envoyé sur le réseau.
(
j() { printf '%s' "$1" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/'; }
lire() { [ -r "$1" ] && tr -d '\n' < "$1" | sed 's/[[:space:]]*$//' | grep -viE '^(not applicable|to be filled.*|system (product name|version)|default string|none|0123456789|)$'; }
nb() { case "$1" in ''|*[!0-9]*) printf 'null' ;; *) printf '%s' "$1" ;; esac; }
fabricant=$(lire /sys/class/dmi/id/sys_vendor)
modele=$(lire /sys/class/dmi/id/product_name)
version=$(lire /sys/class/dmi/id/product_version)
[ -z "$modele" ] && modele=$(tr -d '\000' < /proc/device-tree/model 2>/dev/null)
processeur=$(grep -m1 -E '^(model name|Hardware|Processor)[[:space:]]*:' /proc/cpuinfo | cut -d: -f2- | sed 's/^[[:space:]]*//')
[ -z "$processeur" ] && processeur=$(LC_ALL=C lscpu 2>/dev/null | grep -m1 '^Model name' | cut -d: -f2- | sed 's/^[[:space:]]*//')
logiques=$(grep -c '^processor' /proc/cpuinfo)
physiques=$(lscpu -p=CORE,SOCKET 2>/dev/null | grep -v '^#' | sort -u | wc -l)
[ "$physiques" = 0 ] && physiques=''
khz=$(cat /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq 2>/dev/null | sort -n | tail -1)
mhz=''; [ -n "$khz" ] && mhz=$((khz / 1000))
[ -z "$mhz" ] && mhz=$(LC_ALL=C lscpu 2>/dev/null | grep -m1 'CPU max MHz' | awk -F: '{printf "%d", $2}')
# Turbo : désactivé, la fréquence maximale ci-dessus est la fréquence de base.
turbo=null
if [ -r /sys/devices/system/cpu/cpufreq/boost ]; then [ "$(cat /sys/devices/system/cpu/cpufreq/boost)" = 1 ] && turbo=true || turbo=false
elif [ -r /sys/devices/system/cpu/intel_pstate/no_turbo ]; then [ "$(cat /sys/devices/system/cpu/intel_pstate/no_turbo)" = 0 ] && turbo=true || turbo=false
fi
ram=$(awk '/^MemTotal:/ {print $2 * 1024}' /proc/meminfo)
gpus=''
if command -v lspci >/dev/null 2>&1; then
  while IFS= read -r ligne; do [ -n "$ligne" ] && gpus="$gpus${gpus:+, }$(j "$ligne")"; done <<GPU
$(lspci 2>/dev/null | grep -Ei 'vga|3d|display' | cut -d: -f3- | sed 's/^[[:space:]]*//')
GPU
fi
systeme=$(. /etc/os-release 2>/dev/null; printf '%s' "${PRETTY_NAME:-Linux}")
cat > config-machine.json <<JSON
{
  "format": "pow-equix-wasm/config-machine",
  "version": 1,
  "source": "linux",
  "date": $(j "$(date -u +%Y-%m-%dT%H:%M:%SZ)"),
  "machine": { "fabricant": $(j "$fabricant"), "modele": $(j "$modele${version:+ ($version)}") },
  "processeur": { "modele": $(j "$processeur"), "frequenceMaxMHz": $(nb "$mhz"), "turbo": $turbo, "coeursPhysiques": $(nb "$physiques"), "coeursLogiques": $(nb "$logiques"), "architecture": $(j "$(uname -m)") },
  "memoire": { "totaleOctets": $(nb "$ram") },
  "gpu": [$gpus],
  "systeme": { "nom": $(j "$systeme"), "noyau": $(j "$(uname -sr)") }
}
JSON
cat config-machine.json
)
