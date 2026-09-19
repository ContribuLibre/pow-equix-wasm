# Fiche machine pour le banc pow-equix-wasm — Android, dans Termux. Écrit
# config-machine.json dans le dossier courant et l’affiche. Rien n’est envoyé sur le réseau.
(
j() { printf '%s' "$1" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/'; }
nb() { case "$1" in ''|*[!0-9]*) printf 'null' ;; *) printf '%s' "$1" ;; esac; }
prop() { getprop "$1" 2>/dev/null; }
soc="$(prop ro.soc.manufacturer) $(prop ro.soc.model)"
materiel=$(grep -m1 -E '^Hardware' /proc/cpuinfo | cut -d: -f2- | sed 's/^[[:space:]]*//')
processeur=$(printf '%s' "${soc# }${materiel:+ / $materiel}" | sed 's/^[[:space:]]*//')
khz=$(cat /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq 2>/dev/null | sort -n | tail -1)
mhz=''; [ -n "$khz" ] && mhz=$((khz / 1000))
logiques=$(grep -c '^processor' /proc/cpuinfo)
ram=$(awk '/^MemTotal:/ {print $2 * 1024}' /proc/meminfo)
gpu=$(prop ro.hardware.egl)
cat > config-machine.json <<JSON
{
  "format": "pow-equix-wasm/config-machine",
  "version": 1,
  "source": "android-termux",
  "date": $(j "$(date -u +%Y-%m-%dT%H:%M:%SZ)"),
  "machine": { "fabricant": $(j "$(prop ro.product.manufacturer)"), "modele": $(j "$(prop ro.product.model) ($(prop ro.product.device))") },
  "processeur": { "modele": $(j "$processeur"), "frequenceMaxMHz": $(nb "$mhz"), "turbo": null, "coeursPhysiques": $(nb "$logiques"), "coeursLogiques": $(nb "$logiques"), "architecture": $(j "$(uname -m)") },
  "memoire": { "totaleOctets": $(nb "$ram") },
  "gpu": [$( [ -n "$gpu" ] && j "$gpu")],
  "systeme": { "nom": $(j "Android $(prop ro.build.version.release) (API $(prop ro.build.version.sdk))"), "noyau": $(j "$(uname -sr)") }
}
JSON
cat config-machine.json
)
