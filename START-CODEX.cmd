@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\agent\start-agent.ps1" -Agent codex
if errorlevel 1 pause
