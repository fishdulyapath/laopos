#Requires -Version 5.1
<#
.SYNOPSIS
    Build and push BizSuit Docker images (Windows PowerShell equivalent of build-and-push-images.sh)
.PARAMETER Tag
    Image tag to use. Defaults to $env:IMAGE_TAG or "latest".
.EXAMPLE
    .\build-and-push-images.ps1
    .\build-and-push-images.ps1 v1.2.3
    $env:PUSH_LATEST = "1"; .\build-and-push-images.ps1 v1.2.3
#>
param(
    [string]$Tag = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$BizSuitDir  = (Resolve-Path (Join-Path $ScriptDir "..\..\")).Path.TrimEnd('\')
$WorkspaceDir = (Resolve-Path (Join-Path $BizSuitDir "..")).Path.TrimEnd('\')

$ApiDir = if ($env:API_DIR) { $env:API_DIR } else { Join-Path $WorkspaceDir "MarketPlaceWebServiceExpress" }

if (-not $Tag) {
    $Tag = if ($env:IMAGE_TAG) { $env:IMAGE_TAG } else { "latest" }
}

$Platforms       = if ($env:PLATFORMS)            { $env:PLATFORMS }            else { "linux/amd64" }
$ApiImage        = if ($env:BIZSUIT_API_IMAGE)     { $env:BIZSUIT_API_IMAGE }    else { "minorsoft/bizsuit-api" }
$AppImage        = if ($env:BIZSUIT_APP_IMAGE)     { $env:BIZSUIT_APP_IMAGE }    else { "minorsoft/bizsuit-app" }
$Builder         = if ($env:BUILDER)               { $env:BUILDER }              else { "bizsuit-builder" }
$PushLatest      = $env:PUSH_LATEST -eq "1"

$ViteApiBaseUrl  = if ($env:VITE_API_BASE_URL)     { $env:VITE_API_BASE_URL }    else { "/service/v1" }
$ViteBasePath    = if ($env:VITE_BASE_PATH)        { $env:VITE_BASE_PATH }       else { "/bizsuit/" }
$ViteTigerMock   = if ($env:VITE_TIGER_MOCK)       { $env:VITE_TIGER_MOCK }      else { "false" }
$ViteChangeCurrencyCode = if ($env:VITE_CHANGE_CURRENCY_CODE) { $env:VITE_CHANGE_CURRENCY_CODE } else { "KIP" }
$ViteChangeRoundingStep = if ($env:VITE_CHANGE_ROUNDING_STEP) { $env:VITE_CHANGE_ROUNDING_STEP } else { "500" }
$ViteChangeRoundingMode = if ($env:VITE_CHANGE_ROUNDING_MODE) { $env:VITE_CHANGE_ROUNDING_MODE } else { "down" }
$ViteChangeRoundingIncomeCode = if ($env:VITE_CHANGE_ROUNDING_INCOME_CODE) { $env:VITE_CHANGE_ROUNDING_INCOME_CODE } else { "RD-002" }

# Validate API directory
if (-not (Test-Path $ApiDir -PathType Container)) {
    Write-Error "Missing backend directory: $ApiDir`nSet `$env:API_DIR if it is not beside BizSuit."
    exit 1
}

# Check Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker is not installed or not in PATH."
    exit 1
}

# Check Docker buildx
$null = docker buildx version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker buildx is not available."
    exit 1
}

# Create or use buildx builder
$builderExists = docker buildx inspect $Builder 2>&1
if ($LASTEXITCODE -ne 0) {
    docker buildx create --name $Builder --use | Out-Null
} else {
    docker buildx use $Builder | Out-Null
}

# Bootstrap builder
docker buildx inspect --bootstrap | Out-Null

# Build tag lists
$ApiTags = @("-t", "${ApiImage}:${Tag}")
$AppTags = @("-t", "${AppImage}:${Tag}")

if ($PushLatest -and $Tag -ne "latest") {
    $ApiTags += @("-t", "${ApiImage}:latest")
    $AppTags += @("-t", "${AppImage}:latest")
}

# Build and push API image
Write-Host "Building and pushing API image: $($ApiTags -join ' ')"
docker buildx build `
    --platform $Platforms `
    --push `
    @ApiTags `
    $ApiDir
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Build and push app image
Write-Host "Building and pushing app image: $($AppTags -join ' ')"
docker buildx build `
    --platform $Platforms `
    --push `
    "--build-arg=VITE_API_BASE_URL=$ViteApiBaseUrl" `
    "--build-arg=VITE_BASE_PATH=$ViteBasePath" `
    "--build-arg=VITE_TIGER_MOCK=$ViteTigerMock" `
    "--build-arg=VITE_CHANGE_CURRENCY_CODE=$ViteChangeCurrencyCode" `
    "--build-arg=VITE_CHANGE_ROUNDING_STEP=$ViteChangeRoundingStep" `
    "--build-arg=VITE_CHANGE_ROUNDING_MODE=$ViteChangeRoundingMode" `
    "--build-arg=VITE_CHANGE_ROUNDING_INCOME_CODE=$ViteChangeRoundingIncomeCode" `
    @AppTags `
    $BizSuitDir
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Pushed:"
Write-Host "- ${ApiImage}:${Tag}"
Write-Host "- ${AppImage}:${Tag}"

if ($PushLatest -and $Tag -ne "latest") {
    Write-Host "- ${ApiImage}:latest"
    Write-Host "- ${AppImage}:latest"
}
