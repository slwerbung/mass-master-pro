# =============================================================================
# Mass Master Pro - Neukunden-Formular Deploy
# =============================================================================
# Was dieser Deploy aendert:
#   - Neue Edge Function submit-new-customer (oeffentlich, mit Rate-Limit)
#   - Neue Route /neukunde in der App
#   - Formular schreibt in HERO und schickt Mail an info@slwerbung.de
#
# Der Link fuer Neukunden nach dem Deploy:
#   https://mass-master-pro.vercel.app/neukunde
# =============================================================================

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "    OK: $msg"   -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    WARNUNG: $msg" -ForegroundColor Yellow }

# Sanity
Write-Step "Sanity-Check"
if (-not (Test-Path ".\supabase\config.toml")) {
    Write-Host "FEHLER: supabase\config.toml nicht gefunden." -ForegroundColor Red
    exit 1
}
$requiredFiles = @(
    ".\src\App.tsx",
    ".\src\pages\NewCustomerSignup.tsx",
    ".\supabase\functions\submit-new-customer\index.ts"
)
foreach ($f in $requiredFiles) {
    if (-not (Test-Path $f)) {
        Write-Host "FEHLER: $f fehlt. Hast Du die ZIP entpackt?" -ForegroundColor Red
        exit 1
    }
}
Write-OK "Alle Dateien am Platz"

# Optional: RESEND_API_KEY pruefen
Write-Step "Resend-Konfiguration pruefen"
$secrets = supabase secrets list 2>&1 | Out-String
if ($secrets -notmatch "RESEND_API_KEY") {
    Write-Warn "RESEND_API_KEY ist nicht gesetzt - Neukunden-Benachrichtigungs-Mails funktionieren nicht"
    Write-Host "    Setzen mit: supabase secrets set RESEND_API_KEY=<dein-key>" -ForegroundColor Yellow
} else {
    Write-OK "RESEND_API_KEY ist gesetzt"
}

# Edge Function deployen
Write-Step "Edge Function submit-new-customer deployen"
supabase functions deploy submit-new-customer
if ($LASTEXITCODE -ne 0) { throw "Deploy fehlgeschlagen" }
Write-OK "submit-new-customer deployed"

# Wichtig: Diese Function muss oeffentlich aufrufbar sein (kein JWT-Check).
# Supabase setzt per Default verify_jwt=true. Wir muessen es auf false setzen.
Write-Step "verify_jwt=false setzen (Function muss oeffentlich sein)"
Write-Host "    HINWEIS: Falls nicht schon in supabase/config.toml:" -ForegroundColor Yellow
Write-Host "    Im Dashboard -> Edge Functions -> submit-new-customer -> verify_jwt auf 'No'" -ForegroundColor Yellow
Write-Host "    (Alle anderen Functions haben das auch schon so.)" -ForegroundColor Yellow

# Git
Write-Step "Git status"
git status --short
$doCommit = Read-Host "Jetzt committen und pushen? (j/N)"
if ($doCommit -eq "j" -or $doCommit -eq "J") {
    git add .
    git commit -m "feat: public /neukunde signup form with HERO integration and email notification"
    if ($LASTEXITCODE -ne 0) { throw "git commit fehlgeschlagen" }
    git push
    if ($LASTEXITCODE -ne 0) { throw "git push fehlgeschlagen" }
    Write-OK "Push erfolgt"
} else {
    Write-Warn "Commit ausgelassen"
}

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Green
Write-Host "  Neukunden-Formular Deploy abgeschlossen." -ForegroundColor Green
Write-Host "=============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Der Link fuer Neukunden:" -ForegroundColor White
Write-Host "  https://mass-master-pro.vercel.app/neukunde" -ForegroundColor Cyan
Write-Host ""
Write-Host "Test-Plan:" -ForegroundColor White
Write-Host "  1. Link oeffnen, Formular ausfuellen, absenden" -ForegroundColor White
Write-Host "  2. Mail an info@slwerbung.de pruefen" -ForegroundColor White
Write-Host "  3. In HERO pruefen ob Kontakt angelegt wurde" -ForegroundColor White
Write-Host "     Falls NEIN: die Mail enthaelt die HERO-Fehlermeldung -" -ForegroundColor White
Write-Host "     die schickst Du mir, dann justieren wir die Mutation nach." -ForegroundColor White
Write-Host ""
Write-Host "Adress-Autocomplete: Nominatim (OSM) - kostenlos, maessig schnell" -ForegroundColor White
Write-Host "Rate-Limit: 5 Anmeldungen / Stunde / IP" -ForegroundColor White
Write-Host ""
