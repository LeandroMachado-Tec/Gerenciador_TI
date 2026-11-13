@echo off
title Gerenciador de TI - Gerar Instalador
cd /d "%~dp0"
echo Gerando o instalador (.exe)...
npm run dist
echo.
echo Concluido! Veja a pasta release\.
pause
