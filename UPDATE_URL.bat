@echo off
chcp 65001 >nul 2>&1
title Update API URL & Push
set "MYDIR=%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -Command ^
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $env:MYDIR='%MYDIR%'; $s = [System.IO.File]::ReadAllText('%~dp0update_url.ps1', [System.Text.Encoding]::UTF8); Invoke-Expression $s"
echo.
pause
