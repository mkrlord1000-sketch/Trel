<#
.SYNOPSIS
  Создаёт ОДИН новый GitHub Release с артефактами из release/.
  В отличие от publish.ps1 — НЕ удаляет существующие релизы и теги,
  безопасен для повторных публикаций.

.PARAMETER Token
  GitHub Personal Access Token. Нужен write-доступ к репозиторию:
  Classic PAT со scope "repo", или fine-grained с "Contents: Read and write".

.PARAMETER NotesFile
  Опционально: путь к файлу с release notes (markdown). По умолчанию
  берётся `RELEASE_NOTES.md` из корня репо, если есть; иначе — короткий
  текст из package.json.version.

.EXAMPLE
  .\scripts\publish-release.ps1 -Token ghp_xxxxxxxxxxxxxxxxxxxx

.NOTES
  Owner/repo и version читаются из package.json. Тег: "v" + version.
  Если тег уже существует на GitHub — релиз будет привязан к нему.
  Если релиз с этим тегом уже существует — выйдет с ошибкой (без удаления).
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

# ---------- 1. Проверить, что тег существует и релиза с ним пока нет ----
Write-Host "`n[1/3] Checking tag and existing release..."
try {
  $existing = Invoke-RestMethod -Method Get -Uri "$apiBase/releases/tags/$([uri]::EscapeDataString($tag))" -Headers $headers
  if ($existing) {
    throw "Release for $tag already exists: $($existing.html_url). Aborting to avoid overwriting it."
  }
} catch {
  if ($_.Exception.Response.StatusCode.Value__ -ne 404) { throw }
  # 404 — релиза нет, это нормально
}

# Проверяем что тег как ref существует на сервере
try {
  Invoke-RestMethod -Method Get -Uri "$apiBase/git/ref/tags/$([uri]::EscapeDataString($tag))" -Headers $headers | Out-Null
  Write-Host "  Tag exists on remote."
} catch {
  if ($_.Exception.Response.StatusCode.Value__ -eq 404) {
    throw "Tag $tag not found on remote. Push it first: git push origin $tag"
  }
  throw
}

# ---------- 2. Создать релиз ------------------------------------------
Write-Host "`n[2/3] Creating release $tag..."

$notes = ''
if ($NotesFile -and (Test-Path $NotesFile)) {
  $notes = Get-Content $NotesFile -Raw
} elseif (Test-Path (Join-Path $repoRoot 'RELEASE_NOTES.md')) {
  $notes = Get-Content (Join-Path $repoRoot 'RELEASE_NOTES.md') -Raw
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

$release = Invoke-RestMethod -Method Post -Uri "$apiBase/releases" -Headers $headers -Body $body -ContentType 'application/json'
Write-Host "  Release created: $($release.html_url)"

# ---------- 3. Загрузить артефакты ------------------------------------
Write-Host "`n[3/3] Uploading artifacts..."
$releaseDir = Join-Path $repoRoot 'release'
$assetFiles = @(
  "Trel-$version-x64.exe",
  "Trel-$version-x64.exe.blockmap",
  "Trel.exe",
  "latest.yml"
)

# upload_url приходит как ".../assets{?name,label}" — убираем шаблон
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
