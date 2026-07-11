@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-and-push-images.ps1" %*
exit /b %ERRORLEVEL%
