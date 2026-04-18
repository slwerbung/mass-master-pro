# =============================================================================
# Mass Master Pro - Projektfelder & HERO-Import Deploy Script
# =============================================================================
# Anleitung:
#   1. ZIP (mass-master-pro-projectfields.zip) entpacken und Dateien ins Repo
#      kopieren (ueberschreiben).
#   2. Dann dieses Script im Repo-Root ausfuehren:
#        cd C:\Users\info\OneDrive\Dokumente\GitHub\mass-master-pro
#        powershell -ExecutionPolicy Bypass -File .\deploy-projectfields.ps1
#
# Was dieser Deploy aendert:
#   - Migration: Seed "projectNumber" als Standardfeld in project_field_config
#   - Edge Function admin-manage: Project-Field-CRUD + Protection-Logik
#   - Frontend: Praefix raus, HERO-Import schreibt vollen String,
#     Projektfelder von Mitarbeiter-Tab in Einstellungen-Tab umgezogen
# =============================================================================

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}
function Write-OK($msg) { Write-Host "    OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    WARNUNG: $msg" -ForegroundColor Yellow }

# -----------------------------------------------------------------------------
# 0. Sanity-Checks
# -----------------------------------------------------------------------------
Write-Step "Sanity-Check: richtiges Verzeichnis und Dateien da?"
if (-not (Test-Path ".\supabase\config.toml")) {
    Write-Host "FEHLER: supabase\config.toml nicht gefunden." -ForegroundColor Red
    Write-Host "Bitte im Repo-Root ausfuehren: C:\Users\info\OneDrive\Dokumente\GitHub\mass-master-pro" -ForegroundColor Red
    exit 1
}
$requiredFiles = @(
    ".\supabase\migrations\20260419100000_seed_project_standard_fields.sql",
    ".\src\lib\projectFields.ts",
    ".\src\pages\NewProject.tsx",
    ".\src\pages\Admin.tsx",
    ".\supabase\functions\admin-manage\index.ts"
)
foreach ($f in $requiredFiles) {
    if (-not (Test-Path $f)) {
        Write-Host "FEHLER: $f fehlt. Hast Du die ZIP entpackt?" -ForegroundColor Red
        exit 1
    }
}
Write-OK "Alle Dateien am richtigen Platz"

# -----------------------------------------------------------------------------
# 1. Migration einspielen
# -----------------------------------------------------------------------------
Write-Step "DB-Migration anwenden (seed projectNumber standard field)"
supabase db push
if ($LASTEXITCODE -ne 0) { throw "supabase db push fehlgeschlagen" }
Write-OK "Migration eingespielt"

# -----------------------------------------------------------------------------
# 2. admin-manage Edge Function deployen (ist die einzige geaenderte Function)
# -----------------------------------------------------------------------------
Write-Step "Edge Function admin-manage deployen"
supabase functions deploy admin-manage
if ($LASTEXITCODE -ne 0) { throw "Deploy von admin-manage fehlgeschlagen" }
Write-OK "admin-manage deployed"

# -----------------------------------------------------------------------------
# 3. Git commit + push (Vercel deployed automatisch)
# -----------------------------------------------------------------------------
Write-Step "Git status pruefen"
git status --short
$doCommit = Read-Host "Jetzt committen und pushen? (j/N)"
if ($doCommit -eq "j" -or $doCommit -eq "J") {
    git add .
    git commit -m "feat: project standard fields + HERO full-number import, remove prefix"
    if ($LASTEXITCODE -ne 0) { throw "git commit fehlgeschlagen" }
    git push
    if ($LASTEXITCODE -ne 0) { throw "git push fehlgeschlagen" }
    Write-OK "Push erfolgt - Vercel baut jetzt"
} else {
    Write-Warn "Commit ausgelassen. Manuell pushen, wenn bereit."
}

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Green
Write-Host "  Projektfelder-Deploy abgeschlossen." -ForegroundColor Green
Write-Host "=============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Kurzer Test-Plan nach Vercel-Build (~1 Min):" -ForegroundColor White
Write-Host "  1. Admin -> Einstellungen: Projektfelder-Karte muss jetzt hier sein" -ForegroundColor White
Write-Host "     Oben stehen 'Projektnummer / Projektname' und 'Kunde' als" -ForegroundColor White
Write-Host "     Standardfelder (grau, ohne Edit/Delete Buttons)" -ForegroundColor White
Write-Host "  2. Admin -> Mitarbeiter: keine Projektfelder-Karte mehr" -ForegroundColor White
Write-Host "  3. Admin -> Einstellungen: keine Praefix-Karte mehr" -ForegroundColor White
Write-Host "  4. Neues Projekt anlegen:" -ForegroundColor White
Write-Host "     - Kein 'WER-' Praefix-Badge mehr vor dem Input" -ForegroundColor White
Write-Host "     - HERO-Projekt auswaehlen: volle Nummer + Name wird eingetragen" -ForegroundColor White
Write-Host "       z.B. 'WER-1234 Mustermann GmbH'" -ForegroundColor White
Write-Host "  5. Bestehendes Projekt oeffnen: Titel und Projektinfos stimmen" -ForegroundColor White
Write-Host ""
