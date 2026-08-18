@echo off
cd /d "%~dp0public"
start "" cmd /c "timeout /t 1 >nul && start http://localhost:8123/"
echo Dashboard wird gestartet - dieses Fenster bitte offen lassen.
echo Zum Beenden einfach dieses Fenster schliessen.
python server.py
