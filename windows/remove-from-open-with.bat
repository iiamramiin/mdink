@echo off
rem Removes the registry entries added by add-to-open-with.bat
reg delete "HKCU\Software\Classes\Applications\mdink.exe" /f >nul 2>&1
reg delete "HKCU\Software\Classes\mdink.md" /f >nul 2>&1
for %%E in (.md .markdown .mdown .mkd) do reg delete "HKCU\Software\Classes\%%E\OpenWithProgids" /v mdink.md /f >nul 2>&1
echo mdink was removed from "Open with".
pause
