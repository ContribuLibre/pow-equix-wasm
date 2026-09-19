# Fiche machine pour le banc pow-equix-wasm — Windows (PowerShell 5 ou 7). Écrit
# config-machine.json dans le dossier courant et l’affiche. Rien n’est envoyé sur le réseau.
& {
  $processeurs = @(Get-CimInstance Win32_Processor)
  $machine = Get-CimInstance Win32_ComputerSystem
  $systeme = Get-CimInstance Win32_OperatingSystem
  $fiche = [ordered]@{
    format = 'pow-equix-wasm/config-machine'
    version = 1
    source = 'windows'
    date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    machine = [ordered]@{ fabricant = "$($machine.Manufacturer)".Trim(); modele = "$($machine.Model)".Trim() }
    processeur = [ordered]@{
      modele = "$($processeurs[0].Name)".Trim()
      frequenceMaxMHz = [int]$processeurs[0].MaxClockSpeed
      turbo = $null
      coeursPhysiques = [int]($processeurs | Measure-Object -Property NumberOfCores -Sum).Sum
      coeursLogiques = [int]($processeurs | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
      architecture = "$env:PROCESSOR_ARCHITECTURE"
    }
    memoire = [ordered]@{ totaleOctets = [long]$machine.TotalPhysicalMemory }
    gpu = @(Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name)".Trim() })
    systeme = [ordered]@{ nom = "$($systeme.Caption) $($systeme.Version)".Trim(); noyau = "$($systeme.BuildNumber)" }
  }
  $json = $fiche | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) 'config-machine.json'), $json, (New-Object System.Text.UTF8Encoding $false))
  $json
}
