@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Run from the target repository, not the plugin installation directory.
set "HARNESS_CONFIG=%CD%\harness.config.json"
if exist "%CD%\harness.local.json" set "HARNESS_CONFIG=%CD%\harness.local.json"
rem Finish on the same parsed line even if Git switches to a branch without this file.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run.ps1" --config "%HARNESS_CONFIG%" %* & if errorlevel 1 (exit /b 1) else if not errorlevel 0 (exit /b 1) else (exit /b 0)
