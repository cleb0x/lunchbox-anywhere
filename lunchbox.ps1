# Starts Lunchbox on this Windows computer with the agents already signed in here (Claude Code and
# others), and connects it to the Lunchbox website so you can use it from anywhere, for example a
# Chromebook at school. Run it in PowerShell:
#   irm https://raw.githubusercontent.com/cleb0x/lunchbox-anywhere/main/lunchbox.ps1 | iex
# To start it whenever you log in to Windows, or to undo that:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/cleb0x/lunchbox-anywhere/main/lunchbox.ps1))) -AtLogin
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/cleb0x/lunchbox-anywhere/main/lunchbox.ps1))) -NotAtLogin
param([switch]$AtLogin, [switch]$NotAtLogin, [switch]$Update)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Version = '6'
$Repo = if ($env:LUNCHBOX_REPO) { $env:LUNCHBOX_REPO } else { 'cleb0x/lunchbox-anywhere' }
$App = Join-Path $HOME '.lunchbox-app'
$Conf = Join-Path $HOME '.config\Lunchbox'
$Port = if ($env:PORT) { $env:PORT } else { '8080' }
$Raw = "https://raw.githubusercontent.com/$Repo/main/lunchbox.ps1"
New-Item -ItemType Directory -Force -Path $Conf | Out-Null

function Say($t) { Write-Host ''; Write-Host $t -ForegroundColor White }
Write-Host "Lunchbox launcher $Version (Windows)"

# Start at login: a small file in the Startup folder that runs this launcher, minimized.
$Startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Lunchbox.cmd'
if ($AtLogin) {
  Set-Content -Path $Startup -Encoding ASCII -Value "@echo off`r`nstart `"Lunchbox`" /min powershell -NoProfile -ExecutionPolicy Bypass -Command `"irm $Raw | iex`""
  Write-Host 'Lunchbox now starts when you log in to Windows. Starting it now.'
}
if ($NotAtLogin) {
  Remove-Item -Force -ErrorAction SilentlyContinue $Startup
  Write-Host 'Lunchbox no longer starts when you log in.'
  return
}

# Node.js 20 or newer.
function Get-NodeMajor { try { [int]((& node -p 'process.versions.node.split(".")[0]') 2>$null) } catch { 0 } }
if ((Get-NodeMajor) -lt 20) {
  Say 'Installing Node.js…'
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements | Out-Host
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if ((Get-NodeMajor) -lt 20) { throw 'Lunchbox needs Node.js 20 or newer. Install it from https://nodejs.org and run this again.' }
}

# Lunchbox itself, the ready-made build from the project's releases. Refreshed once a day.
$Main = Join-Path $App 'main.cjs'
if ($Update -or -not (Test-Path $Main) -or ((Get-Item $Main).LastWriteTime -lt (Get-Date).AddDays(-1))) {
  Say 'Getting Lunchbox…'
  $tgz = Join-Path $env:TEMP 'lunchbox-server.tar.gz'
  try {
    Invoke-WebRequest "https://github.com/$Repo/releases/download/server-latest/lunchbox-server.tar.gz" -OutFile $tgz
    $new = "$App.new"
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $new
    New-Item -ItemType Directory -Force -Path $new | Out-Null
    tar -xzf $tgz -C $new
    if (Test-Path (Join-Path $App 'cloudflared.exe')) { Copy-Item (Join-Path $App 'cloudflared.exe') $new }
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $App
    Move-Item $new $App
  } catch {
    if (-not (Test-Path $Main)) { throw "Could not download Lunchbox: $($_.Exception.Message)" }
    Write-Host 'Could not check for a newer Lunchbox; starting the one already here.'
  }
}

# Claude Code: the one already installed and signed in on this computer is used as it is.
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  $local = Join-Path $HOME '.local\bin'
  if (Test-Path (Join-Path $local 'claude.exe')) { $env:Path = "$local;$env:Path" }
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Say 'Claude Code is not installed on this computer. Installing it…'
  Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
  $env:Path = (Join-Path $HOME '.local\bin') + ';' + $env:Path
}
if (-not (Test-Path (Join-Path $HOME '.claude\.credentials.json')) -and -not $env:CLAUDE_CODE_OAUTH_TOKEN -and -not $env:ANTHROPIC_API_KEY) {
  Say 'Sign in to Claude'
  Write-Host 'Claude Code opens now. Choose "Claude account with subscription", sign in, then type /exit.'
  & claude
}

# The desktop app keeps its rooms in the same place; two at once would write over each other.
if (Get-Process -Name Lunchbox -ErrorAction SilentlyContinue) {
  throw 'The Lunchbox desktop app is open. Quit it first (also from the tray): both use the same rooms and would get in each other''s way.'
}

# The key for this computer, kept between runs.
$KeyFile = Join-Path $Conf 'server-key'
if (-not (Test-Path $KeyFile) -or -not (Get-Content $KeyFile -Raw)) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  Set-Content -Path $KeyFile -NoNewline -Value (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}
$Key = (Get-Content $KeyFile -Raw).Trim()

# A free Cloudflare quick tunnel, so the website can reach this computer. No account.
$Cf = Join-Path $App 'cloudflared.exe'
if (-not (Test-Path $Cf)) {
  Say 'Getting the tunnel (cloudflared)…'
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
  try { Invoke-WebRequest "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-$arch.exe" -OutFile $Cf } catch { Write-Host 'Could not download cloudflared.' }
}

$Site = if ($env:LUNCHBOX_SITE) { $env:LUNCHBOX_SITE } else { "https://$($Repo.Split('/')[0]).github.io/$($Repo.Split('/')[1])/" }
$Log = Join-Path $env:TEMP "lunchbox-tunnel-$PID.log"
$Tunnel = ''
$tp = $null
if (Test-Path $Cf) {
  Write-Host 'Opening the tunnel…'
  $tp = Start-Process -FilePath $Cf -ArgumentList @('tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$Port") -RedirectStandardError $Log -RedirectStandardOutput "$Log.out" -WindowStyle Hidden -PassThru
  for ($i = 0; $i -lt 120 -and -not $Tunnel; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $Log) { $m = Select-String -Path $Log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1; if ($m) { $Tunnel = $m.Matches[0].Value } }
  }
}

$env:PORT = $Port
$env:LUNCHBOX_HOST = '127.0.0.1'
$env:LUNCHBOX_KEY = $Key
$env:LUNCHBOX_QUIET = '1'
$env:LUNCHBOX_PUBLIC_URL = if ($Tunnel) { "$Tunnel/" } else { '' }
$sp = Start-Process -FilePath 'node' -ArgumentList @("`"$Main`"") -NoNewWindow -PassThru

try {
  if ($Tunnel) {
    Write-Host 'Waiting for the tunnel to answer…'
    for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest "$Tunnel/health?key=$Key" -TimeoutSec 4 -UseBasicParsing | Out-Null; break } catch { Start-Sleep 1 } }
    $Link = "$Site#connect=$Tunnel&key=$Key"
    Set-Content -Path (Join-Path $Conf 'pair-link.txt') -Value "$Site#pair=$Key"
    Say 'Lunchbox is ready. Open this link:'
    Write-Host ''
    Write-Host "    $Link" -ForegroundColor Cyan
    Write-Host ''
    Write-Host 'Open it once on your Chromebook (send it to yourself). After that the Chromebook finds this'
    Write-Host "computer by itself: just go to $Site"
    Write-Host 'Keep the link to yourself: it opens your Lunchbox.'
  } else {
    Write-Host 'The tunnel did not start, so Lunchbox only works on this computer for now:'
    Write-Host "    http://localhost:$Port/#key=$Key"
  }
  Write-Host 'Keep this window open while you use Lunchbox. Close it or press Ctrl+C to stop.'
  $sp.WaitForExit()
} finally {
  if ($tp -and -not $tp.HasExited) { Stop-Process -Id $tp.Id -Force -ErrorAction SilentlyContinue }
  if ($sp -and -not $sp.HasExited) { Stop-Process -Id $sp.Id -Force -ErrorAction SilentlyContinue }
}
