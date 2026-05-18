<#
.SYNOPSIS
  Creates ONE GitHub Release with artifacts from release/.
  Unlike publish.ps1 it does NOT delete existing releases or tags.

.PARAMETER Token
  GitHub Personal Access Token. Needs write access to the repository:
  Classic PAT with the "repo" scope, or a fine-grained token with
  "Contents: Read and write" on this repo.

.PARAMETER NotesFile
  Optional path to a markdown file with release notes. By default
  RELEASE_NOTES.md from the repo root is used; otherwise a short
  fallback string built from package.json.version.

.EXAMPLE
  .\scripts\publish-release.ps1 -Token ghp_xxxxxxxxxxxxxxxxxxxx

.NOTES
  Owner/repo and version are read from package.json. Tag is "v" + version.
  If a release with that tag already exists, the script aborts without
  changing anything (so re-running is safe).
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Token,

  [string]$NotesFile = ''
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
  'User-Agent'           = 'trel-publish-release'
}

# ---------- 1. Verify the tag exists and no release uses it yet ----------
Write-Host ""
Write-Host "[1/3] Checking tag and existing release..."
try {
  $existing = Invoke-RestMethod -Method Get -Uri "$apiBase/releases/tags/$([uri]::EscapeDataString($tag))" -Headers $headers
  if ($existing) {
    throw "Release for $tag already exists: $($existing.html_url). Aborting to avoid overwriting it."
  }
} catch {
  $code = $_.Exception.Response.StatusCode.Value__
  if ($code -ne 404) {
    if ($code -eq 401) {
      Write-Host ""
      Write-Host "[ERROR 401] Token rejected by GitHub." -ForegroundColor Red
      Write-Host "Possible reasons:"
      Write-Host "  1. Token expired or revoked."
      Write-Host "  2. Token lacks 'repo' scope (classic PAT) or 'Contents: write' (fine-grained)."
      Write-Host "  3. Token belongs to a different account that has no access to $owner/$repo."
      Write-Host ""
      Write-Host "Check:"
      Write-Host "  https://github.com/settings/tokens"
      Write-Host "  That repo $owner/$repo exists and the token's account can write to it."
      throw "401 Unauthorized"
    }
    throw
  }
  # 404 means no release yet, which is fine for us
}

try {
  Invoke-RestMethod -Method Get -Uri "$apiBase/git/ref/tags/$([uri]::EscapeDataString($tag))" -Headers $headers | Out-Null
  Write-Host "  Tag exists on remote."
} catch {
  if ($_.Exception.Response.StatusCode.Value__ -eq 404) {
    throw "Tag $tag not found on remote. Push it first: git push origin $tag"
  }
  throw
}

# ---------- 2. Create the release ----------
Write-Host ""
Write-Host "[2/3] Creating release $tag..."

$notes = ''
if ($NotesFile -and (Test-Path $NotesFile)) {
  # Force UTF-8 read: PowerShell 5.1 default encoding is Windows-1251 here,
  # which would mangle Cyrillic in release notes.
  $notes = [System.IO.File]::ReadAllText((Resolve-Path $NotesFile), [System.Text.UTF8Encoding]::new($false))
} elseif (Test-Path (Join-Path $repoRoot 'RELEASE_NOTES.md')) {
  $notes = [System.IO.File]::ReadAllText((Resolve-Path (Join-Path $repoRoot 'RELEASE_NOTES.md')), [System.Text.UTF8Encoding]::new($false))
} else {
  $notes = "Trel $version"
}

$body = @{
  tag_name   = $tag
  name       = "Trel $version"
  body       = $notes
  draft      = $false
  prerelease = $false
} | ConvertTo-Json -Depth 4

# PowerShell 5.1 by default sends body in Windows-1251 if it contains non-ASCII.
# GitHub then fails to parse JSON. Encode to UTF-8 bytes manually so the
# Content-Type charset matches what we actually send.
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)

try {
  $release = Invoke-RestMethod -Method Post -Uri "$apiBase/releases" -Headers $headers -Body $bodyBytes -ContentType 'application/json; charset=utf-8'
} catch {
  $code = $_.Exception.Response.StatusCode.Value__
  if ($code -eq 401) {
    Write-Host ""
    Write-Host "[ERROR 401] Token rejected when creating release." -ForegroundColor Red
    Write-Host "Make sure the token has 'repo' scope (classic) or 'Contents: write' (fine-grained)."
    throw "401 Unauthorized"
  }
  if ($code -eq 404) {
    Write-Host ""
    Write-Host "[ERROR 404] Repository $owner/$repo not found or token has no access." -ForegroundColor Red
    Write-Host "If the repo was renamed, update package.json (build.publish[0].repo)."
    throw "404 Not Found"
  }
  throw
}
Write-Host "  Release created: $($release.html_url)"

# ---------- 3. Upload artifacts ----------
Write-Host ""
Write-Host "[3/3] Uploading artifacts..."
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
  $sizeMb = [math]::Round($size / 1MB, 1)
  Write-Host "  Uploading $name ($sizeMb MB)..."

  $uploadUrl = "${uploadBase}?name=$([uri]::EscapeDataString($name))"
  $bytes = [System.IO.File]::ReadAllBytes($path)

  $uploadHeaders = $headers.Clone()
  $uploadHeaders['Content-Type'] = 'application/octet-stream'

  $resp = Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $uploadHeaders -Body $bytes
  Write-Host "    OK: $($resp.browser_download_url)"
}

Write-Host ""
Write-Host "Done. Release URL: $($release.html_url)"
