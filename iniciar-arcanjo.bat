@echo off
title ARCANJO INTELLIGENCE — Central de Seguranca Patrimonial
cd /d "%~dp0"
start "" "http://localhost:8000"
".venv\Scripts\python.exe" app.py
pause
