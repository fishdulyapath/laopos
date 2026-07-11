# Windows Docker Image Build and Push

Use this script from Windows PowerShell when you need to build and push the
Santiparb POS backend and frontend Docker images.

## Basic Usage

```powershell
cd D:\FishSoft\Santiparb_POS\frontend\deploy\windows
.\build-and-push-images.ps1 -Tag 1.1.10
```

Or use the CMD wrapper, which bypasses local PowerShell execution policy:

```cmd
cd D:\FishSoft\Santiparb_POS\frontend\deploy\windows
build-and-push-images.cmd -Tag 1.1.10
```

Push the same version plus `latest`:

```powershell
.\build-and-push-images.ps1 -Tag 1.2.27 -PushLatest
```

If PowerShell blocks local scripts:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-and-push-images.ps1 -Tag 1.1.10
```

## Optional Docker Login

If Docker is already logged in, no extra environment variables are needed.
Otherwise set:

```powershell
$env:DOCKER_USERNAME = "docker-user"
$env:DOCKER_PASSWORD = "docker-token-or-password"
```

For a private registry:

```powershell
$env:DOCKER_REGISTRY = "registry.example.com"
```

## Image Settings

```powershell
$env:IMAGE_TAG = "1.1.10"
$env:BIZSUIT_API_IMAGE = "minorsoft/bizsuit-api"
$env:BIZSUIT_APP_IMAGE = "minorsoft/bizsuit-app"
$env:PUSH_LATEST = "1"
$env:PLATFORMS = "linux/amd64"
$env:BUILDER = "santiparb-pos-builder"
```

`-Tag` overrides `IMAGE_TAG`.

## Path Overrides

By default:

- API image context: `D:\FishSoft\Santiparb_POS\backend`
- App image context: `D:\FishSoft\Santiparb_POS\frontend`

Override only when needed:

```powershell
$env:API_DIR = "D:\FishSoft\Santiparb_POS\backend"
$env:APP_DIR = "D:\FishSoft\Santiparb_POS\frontend"
```

## Frontend Build Args

These are optional and default to the production Docker values:

```powershell
$env:VITE_API_BASE_URL = "/service/v1"
$env:VITE_BASE_PATH = "/bizsuit/"
$env:VITE_TIGER_MOCK = "false"
$env:VITE_CHANGE_CURRENCY_CODE = "KIP"
$env:VITE_CHANGE_ROUNDING_STEP = "500"
$env:VITE_CHANGE_ROUNDING_MODE = "down"
$env:VITE_CHANGE_ROUNDING_INCOME_CODE = "RD-002"
```
