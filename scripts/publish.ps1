<#
.SYNOPSIS
  Deletes ALL existing GitHub releases and tags, then uploads a fresh
  release built from artifacts in release/.

.PARAMETER Token
  GitHub Personal Access Token. Needs write access to the repository:
  Classic PAT with the "repo" scope, OR a fine-grained token with
  "Contents: Read and write" on this specific repo.

.EXAMPLE
  .\scripts\publish.ps1 -Token ghp_xxxxxxxxxxxxxxxxxxxx

.NOTES
  Owner/repo are taken from package.json (build.publish[0].owner/repo).
  Version is taken from package.json.version, tag is "v" + version.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Token
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$pkgPath  = Join-Path $repoRoot 'package.json'
if (-not (Test-Path $pkgPath)) { throw "package.json not found: $pkgPath" }

$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$version = $pkg.version
$tag     = "v$version"
$owner   = $pkg.build.publish[0].owner
$repo    = $pkg.build.publish[0].repo

if (-not $owner -or -not $repo) {
  throw "package.json must have build.publish[0].owner and .repo"
}

Write-Host "Repo:    $owner/$repo"
Write-Host "Version: $version (tag $tag)"

$apiBase = "https://api.github.com/repos/$owner/$repo"
$headers = @{
  Authorization          = "Bearer $Token"
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'           = 'trel-publish-script'
}

# ---------- 1. Delete every existing release ----------
Write-Host "`n[1/4] Listing releases..."
$releases = @()
$page = 1
while ($true) {
  $batch = Invoke-RestMethod -Method Get -Uri "$apiBase/releases?per_page=100&page=$page" -Headers $headers
  if (-not $batch -or $batch.Count -eq 0) { break }
  $releases += $batch
  if ($batch.Count -lt 100) { break }
  $page++
}
Write-Host "Found releases: $($releases.Count)"

foreach ($r in $releases) {
  Write-Host "  Deleting release: $($r.tag_name) (id=$($r.id))"
  Invoke-RestMethod -Method Delete -Uri "$apiBase/releases/$($r.id)" -Headers $headers | Out-Null
}

# ---------- 2. Delete every tag ----------
Write-Host "`n[2/4] Listing tags..."
$tags = @()
$page = 1
while ($true) {
  $batch = Invoke-RestMethod -Method Get -Uri "$apiBase/tags?per_page=100&page=$page" -Headers $headers
  if (-not $batch -or $batch.Count -eq 0) { break }
  $tags += $batch
  if ($batch.Count -lt 100) { break }
  $page++
}
Write-Host "Found tags: $($tags.Count)"

foreach ($t in $tags) {
  Write-Host "  Deleting tag: $($t.name)"
  $refUrl = "$apiBase/git/refs/tags/$([uri]::EscapeDataString($t.name))"
  try {
    Invoke-RestMethod -Method Delete -Uri $refUrl -Headers $headers | Out-Null
  } catch {
    Write-Warning "  Failed to delete tag '$($t.name)': $($_.Exception.Message)"
  }
}

# ---------- 3. Create the new release ----------
Write-Host "`n[3/4] Creating release $tag..."

$notes = @(
  "First public release under the Trel name.",
  "",
  "* Full rebrand from Aurora",
  "* Automatic AppData migration (AuroraLauncher -> Trel)",
  "* Self-contained loader profiles (Fabric / Forge / NeoForge / Quilt)",
  "* Per-version mods/shaders/resourcepacks via NTFS junctions",
  "* 'Revert to vanilla' button",
  "* New icon"
) -join "`n"

$body = @{
  tag_name   = $tag
  name       = "Trel $version"
  body       = $notes
  draft      = $false
  prerelease = $false
} | ConvertTo-Json -Depth 4

$release = Invoke-RestMethod -Method Post -Uri "$apiBase/releases" -Headers $headers -Body $body -ContentType 'application/json'
Write-Host "  Release created: $($release.html_url)"

# ---------- 4. Upload artifacts ----------
Write-Host "`n[4/4] Uploading artifacts..."
$releaseDir = Join-Path $repoRoot 'release'
$assetFiles = @(
  "Trel-$version-x64.exe",
  "Trel-$version-x64.exe.blockmap",
  "Trel.exe",
  "latest.yml"
)

# upload_url comes back as ".../assets{?name,label}" - strip the template
$uploadBase = $release.upload_url -replace '\{.*\}$', ''

foreach ($name in $assetFiles) {
  $path = Join-Path $releaseDir $name
  if (-not (Test-Path $path)) {
    Write-Warning "  File missing, skipped: $name"
    continue
  }
  $size = (Get-Item $path).Length
  Write-Host "  Uploading $name ($([math]::Round($size / 1MB, 1)) MB)..."

  $uploadUrl = "${uploadBase}?name=$([uri]::EscapeDataString($name))"
  $bytes = [System.IO.File]::ReadAllBytes($path)

  $uploadHeaders = $headers.Clone()
  $uploadHeaders['Content-Type'] = 'application/octet-stream'

  $resp = Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $uploadHeaders -Body $bytes
  Write-Host "    OK: $($resp.browser_download_url)"
}

Write-Host "`nDone. Release URL: $($release.html_url)"
