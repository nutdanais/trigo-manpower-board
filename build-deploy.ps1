# Rebuilds the clean "deploy" folder that gets dragged onto Netlify.
# Run this after any change to the app, then re-drag the deploy folder to Netlify.
$root = $PSScriptRoot
$deploy = Join-Path $root "deploy"
$vendor = Join-Path $deploy "vendor"
if (Test-Path $deploy) {
  # remove stale files but tolerate locks (OneDrive sync / open shell); overwrites below still refresh content
  Get-ChildItem -Recurse -File $deploy | ForEach-Object { try { Remove-Item -Force $_.FullName } catch {} }
}
New-Item -ItemType Directory -Force $vendor | Out-Null
Copy-Item (Join-Path $root "index.html") $deploy -Force
Copy-Item (Join-Path $root "styles.css") $deploy -Force
Copy-Item (Join-Path $root "app.js") $deploy -Force
Copy-Item (Join-Path $root "cloud.js") $deploy -Force
Copy-Item (Join-Path $root "charts.js") $deploy -Force
Copy-Item (Join-Path $root "config.js") $deploy -Force
Copy-Item (Join-Path $root "logo.svg") $deploy -Force
if (Test-Path (Join-Path $root "logo.png")) { Copy-Item (Join-Path $root "logo.png") $deploy -Force }
if (Test-Path (Join-Path $root "logo-on-navy.png")) { Copy-Item (Join-Path $root "logo-on-navy.png") $deploy -Force }
Copy-Item (Join-Path $root "vendor\html2canvas.min.js") $vendor -Force
Write-Host "deploy/ folder rebuilt. Drag it onto Netlify to publish." -ForegroundColor Green
