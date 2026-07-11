#Requires -Version 5.1
<#
.SYNOPSIS
    Build and push Santiparb POS Docker images from Windows.

.DESCRIPTION
    Builds the backend image from the repository backend folder and the frontend
    image from the frontend folder, then pushes both images with docker buildx.

.PARAMETER Tag
    Image tag to publish. Defaults to $env:IMAGE_TAG or "latest".

.PARAMETER PushLatest
    Also push the latest tag when Tag is not "latest".

.PARAMETER NoLogin
    Skip optional docker login even when DOCKER_USERNAME and DOCKER_PASSWORD are set.

.EXAMPLE
    .\build-and-push-images.ps1 -Tag 1.1.10

.EXAMPLE
    $env:DOCKER_USERNAME = "my-user"
    $env:DOCKER_PASSWORD = "my-token"
    .\build-and-push-images.ps1 -Tag 1.1.10 -PushLatest
#>
param(
    [string]$Tag = "",
    [switch]$PushLatest,
    [switch]$NoLogin
)

$ErrorActionPreference = "Stop"

function EnvOrDefault([string]$Name, [string]$DefaultValue) {
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) { return $DefaultValue }
    return $value
}

function Invoke-NativeCommand([string]$Command, [string[]]$Arguments) {
    Write-Host ""
    Write-Host "> $Command $($Arguments -join ' ')" -ForegroundColor Cyan
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE"
    }
}

function Assert-DockerDaemonReady() {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & docker info *> $null
        if ($LASTEXITCODE -eq 0) { return }
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    throw @"
Docker is installed, but the Docker engine is not ready.

Please check:
- Docker Desktop is open and fully started.
- Docker Desktop is using Linux containers.
- Run this command successfully before retrying: docker info

If Docker Desktop shows Windows containers, switch it to Linux containers and run this script again.
"@
}

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$FrontendDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$RepoRoot = (Resolve-Path (Join-Path $FrontendDir "..")).Path

$ApiDir = EnvOrDefault "API_DIR" (Join-Path $RepoRoot "backend")
$AppDir = EnvOrDefault "APP_DIR" $FrontendDir

if ([string]::IsNullOrWhiteSpace($Tag)) {
    $Tag = EnvOrDefault "IMAGE_TAG" "latest"
}

$Platforms = EnvOrDefault "PLATFORMS" "linux/amd64"
$ApiImage = EnvOrDefault "BIZSUIT_API_IMAGE" "minorsoft/bizsuit-api"
$AppImage = EnvOrDefault "BIZSUIT_APP_IMAGE" "minorsoft/bizsuit-app"
$Builder = EnvOrDefault "BUILDER" "santiparb-pos-builder"
$PushLatest = $PushLatest -or ((EnvOrDefault "PUSH_LATEST" "0") -eq "1")

$ViteApiBaseUrl = EnvOrDefault "VITE_API_BASE_URL" "/service/v1"
$ViteBasePath = EnvOrDefault "VITE_BASE_PATH" "/bizsuit/"
$ViteTigerMock = EnvOrDefault "VITE_TIGER_MOCK" "false"
$ViteChangeCurrencyCode = EnvOrDefault "VITE_CHANGE_CURRENCY_CODE" "KIP"
$ViteChangeRoundingStep = EnvOrDefault "VITE_CHANGE_ROUNDING_STEP" "500"
$ViteChangeRoundingMode = EnvOrDefault "VITE_CHANGE_ROUNDING_MODE" "down"
$ViteChangeRoundingIncomeCode = EnvOrDefault "VITE_CHANGE_ROUNDING_INCOME_CODE" "RD-002"

if (-not (Test-Path $ApiDir -PathType Container)) {
    throw "Missing backend directory: $ApiDir. Set `$env:API_DIR to the backend folder."
}

if (-not (Test-Path (Join-Path $ApiDir "Dockerfile") -PathType Leaf)) {
    throw "Missing backend Dockerfile: $(Join-Path $ApiDir "Dockerfile")"
}

if (-not (Test-Path $AppDir -PathType Container)) {
    throw "Missing frontend directory: $AppDir. Set `$env:APP_DIR to the frontend folder."
}

if (-not (Test-Path (Join-Path $AppDir "Dockerfile") -PathType Leaf)) {
    throw "Missing frontend Dockerfile: $(Join-Path $AppDir "Dockerfile")"
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not installed or is not in PATH."
}

Assert-DockerDaemonReady
Invoke-NativeCommand "docker" @("buildx", "version")

if (-not $NoLogin) {
    $DockerUsername = [Environment]::GetEnvironmentVariable("DOCKER_USERNAME")
    $DockerPassword = [Environment]::GetEnvironmentVariable("DOCKER_PASSWORD")
    $DockerRegistry = EnvOrDefault "DOCKER_REGISTRY" ""

    if (-not [string]::IsNullOrWhiteSpace($DockerUsername) -and -not [string]::IsNullOrWhiteSpace($DockerPassword)) {
        $LoginArgs = @("login", "--username", $DockerUsername, "--password-stdin")
        if (-not [string]::IsNullOrWhiteSpace($DockerRegistry)) {
            $LoginArgs += $DockerRegistry
        }

        Write-Host ""
        Write-Host "> docker login" -ForegroundColor Cyan
        $DockerPassword | docker @LoginArgs
        if ($LASTEXITCODE -ne 0) {
            throw "docker login failed with exit code $LASTEXITCODE"
        }
    }
}

function Test-BuildxBuilder([string]$Name) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & docker buildx inspect $Name *> $null
        return $LASTEXITCODE -eq 0
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

if (-not (Test-BuildxBuilder $Builder)) {
    Invoke-NativeCommand "docker" @("buildx", "create", "--name", $Builder, "--use")
} else {
    Invoke-NativeCommand "docker" @("buildx", "use", $Builder)
}

Invoke-NativeCommand "docker" @("buildx", "inspect", "--bootstrap")

$ApiTags = @("-t", "${ApiImage}:${Tag}")
$AppTags = @("-t", "${AppImage}:${Tag}")

if ($PushLatest -and $Tag -ne "latest") {
    $ApiTags += @("-t", "${ApiImage}:latest")
    $AppTags += @("-t", "${AppImage}:latest")
}

$ApiBuildArgs = @(
    "buildx", "build",
    "--platform", $Platforms,
    "--push"
) + $ApiTags + @($ApiDir)

$AppBuildArgs = @(
    "buildx", "build",
    "--platform", $Platforms,
    "--push",
    "--build-arg", "VITE_API_BASE_URL=$ViteApiBaseUrl",
    "--build-arg", "VITE_BASE_PATH=$ViteBasePath",
    "--build-arg", "VITE_TIGER_MOCK=$ViteTigerMock",
    "--build-arg", "VITE_CHANGE_CURRENCY_CODE=$ViteChangeCurrencyCode",
    "--build-arg", "VITE_CHANGE_ROUNDING_STEP=$ViteChangeRoundingStep",
    "--build-arg", "VITE_CHANGE_ROUNDING_MODE=$ViteChangeRoundingMode",
    "--build-arg", "VITE_CHANGE_ROUNDING_INCOME_CODE=$ViteChangeRoundingIncomeCode"
) + $AppTags + @($AppDir)

Write-Host ""
Write-Host "Building and pushing API image..." -ForegroundColor Green
Invoke-NativeCommand "docker" $ApiBuildArgs

Write-Host ""
Write-Host "Building and pushing app image..." -ForegroundColor Green
Invoke-NativeCommand "docker" $AppBuildArgs

Write-Host ""
Write-Host "Pushed:" -ForegroundColor Green
Write-Host "- ${ApiImage}:${Tag}"
Write-Host "- ${AppImage}:${Tag}"

if ($PushLatest -and $Tag -ne "latest") {
    Write-Host "- ${ApiImage}:latest"
    Write-Host "- ${AppImage}:latest"
}
