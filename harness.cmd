@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Run from the repository root. Prefer the ignored machine-local configuration.
set "HARNESS_CONFIG=%~dp0harness.config.json"
if exist "%~dp0harness.local.json" set "HARNESS_CONFIG=%~dp0harness.local.json"
rem Finish on the same parsed line even if Git switches to a branch without this file.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run.ps1" --config "%HARNESS_CONFIG%" %* & if errorlevel 1 (exit /b 1) else if not errorlevel 0 (exit /b 1) else (exit /b 0)
