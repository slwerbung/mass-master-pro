# =============================================================================
# Mass Master Pro - Batch A+B Deploy Script
# =============================================================================
# Anleitung:
#   1. Die ZIP (mass-master-pro-fixes.zip) VOR Ausführung entpacken und die
#      Dateien in Dein lokales Repo kopieren (überschreiben).
#   2. Dann dieses Script im Repo-Root ausführen:
#        cd C:\Users\info\OneDrive\Dokumente\GitHub\mass-master-pro
#        powershell -ExecutionPolicy Bypass -File .\deploy-batch-ab.ps1
#
#   Falls powershell.exe erst die Policy will:
#        Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#
# Voraussetzungen:
#   - supabase CLI installiert und eingeloggt (supabase login)
#   - Projekt verlinkt (supabase link --project-ref tocukaqhclkskpvvxmrr)
#   - git, GitHub-Zugang
# =============================================================================

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "    OK: $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
    Write-Host "    WARNUNG: $msg" -ForegroundColor Yellow
}

# -----------------------------------------------------------------------------
# 0. Sanity-Checks
# -----------------------------------------------------------------------------
Write-Step "Sanity-Check: richtiges Verzeichnis?"
if (-not (Test-Path ".\supabase\config.toml")) {
    Write-Host "FEHLER: supabase\config.toml nicht gefunden." -ForegroundColor Red
    Write-Host "Bitte im Repo-Root ausfuehren: C:\Users\info\OneDrive\Dokumente\GitHub\mass-master-pro" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path ".\supabase\functions\validate-customer\index.ts")) {
    Write-Host "FEHLER: validate-customer/index.ts fehlt." -ForegroundColor Red
    Write-Host "Hast Du die ZIP ins Repo entpackt?" -ForegroundColor Red
    exit 1
}
Write-OK "Repo sieht gut aus"

# -----------------------------------------------------------------------------
# 1. SESSION_SIGNING_SECRET pruefen / setzen
# -----------------------------------------------------------------------------
Write-Step "SESSION_SIGNING_SECRET in Supabase pruefen"
$existingSecrets = supabase secrets list 2>&1 | Out-String
if ($existingSecrets -match "SESSION_SIGNING_SECRET") {
    Write-OK "SESSION_SIGNING_SECRET ist bereits gesetzt"
    Write-Warn "Falls weniger als 32 Zeichen: jetzt neu setzen! (alte Tokens werden dadurch invalidiert)"
    $setNew = Read-Host "Neu setzen? (j/N)"
} else {
    Write-Warn "SESSION_SIGNING_SECRET ist NICHT gesetzt"
    $setNew = "j"
}

if ($setNew -eq "j" -or $setNew -eq "J") {
    # 32 zufaellige Bytes in Hex - in PowerShell ohne openssl
    $bytes = New-Object Byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
    Write-Host "    Generiertes Secret (64 Hex-Zeichen): $secret" -ForegroundColor Gray
    Write-Host "    Setze in Supabase..." -ForegroundColor Gray
    supabase secrets set "SESSION_SIGNING_SECRET=$secret"
    if ($LASTEXITCODE -ne 0) { throw "supabase secrets set fehlgeschlagen" }
    Write-OK "SESSION_SIGNING_SECRET gesetzt"
    Write-Warn "ACHTUNG: Bestehende Admin/Employee/Customer-Sessions sind damit ungueltig. Alle muessen sich neu einloggen."
}

# -----------------------------------------------------------------------------
# 2. DB-Migration anwenden
# -----------------------------------------------------------------------------
Write-Step "DB-Migration anwenden (drop_anon_read_employees_policy)"
supabase db push
if ($LASTEXITCODE -ne 0) { throw "supabase db push fehlgeschlagen" }
Write-OK "Migration eingespielt"

# -----------------------------------------------------------------------------
# 3. Edge Functions deployen
# -----------------------------------------------------------------------------
Write-Step "Edge Functions deployen"
$functions = @(
    "admin-manage",
    "customer-data",
    "hero-integration",
    "validate-customer",
    "validate-guest",
    "validate-session"
)
foreach ($fn in $functions) {
    Write-Host "    -> $fn" -ForegroundColor Gray
    supabase functions deploy $fn
    if ($LASTEXITCODE -ne 0) { throw "Deploy von $fn fehlgeschlagen" }
}
Write-OK "Alle 6 Edge Functions deployed"

# -----------------------------------------------------------------------------
# 4. Git commit + push (Vercel deployed automatisch)
# -----------------------------------------------------------------------------
Write-Step "Git status pruefen"
git status --short
$doCommit = Read-Host "Jetzt committen und pushen? (j/N)"
if ($doCommit -eq "j" -or $doCommit -eq "J") {
    git add .
    git commit -m "sec: batch A+B - auth hardening, guestInfo wipe fix, hash cache SHA-256, customer token"
    if ($LASTEXITCODE -ne 0) { throw "git commit fehlgeschlagen" }
    git push
    if ($LASTEXITCODE -ne 0) { throw "git push fehlgeschlagen" }
    Write-OK "Push erfolgt - Vercel baut jetzt"
} else {
    Write-Warn "Commit ausgelassen. Manuell pushen, wenn bereit."
}

# -----------------------------------------------------------------------------
# Fertig
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "=============================================================" -ForegroundColor Green
Write-Host "  Batch A+B Deploy abgeschlossen." -ForegroundColor Green
Write-Host "=============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Naechste Schritte - in dieser Reihenfolge testen:" -ForegroundColor White
Write-Host "  1. Admin-Login" -ForegroundColor White
Write-Host "  2. Mitarbeiter-Login + Projekt bearbeiten" -ForegroundColor White
Write-Host "  3. Kunden-Login (Name tippen) + Feedback schreiben" -ForegroundColor White
Write-Host "  4. Gastzugang ueber Projekt-Link" -ForegroundColor White
Write-Host "  5. Sync: Projekt doppelt oeffnen und speichern - keine Re-Uploads" -ForegroundColor White
Write-Host ""
Write-Host "Vollstaendiger Test-Plan: siehe DEPLOYMENT_CHECKLIST.md" -ForegroundColor White
Write-Host ""
