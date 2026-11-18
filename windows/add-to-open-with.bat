@echo off
rem Adds mdink to the "Open with" menu for Markdown files (current user only, no admin needed).
rem Keep this file next to mdink.exe. Run it again if you move the folder.
setlocal
set "EXE=%~dp0mdink.exe"
if not exist "%EXE%" (
  echo mdink.exe was not found next to this script.
  pause & exit /b 1
)
reg add "HKCU\Software\Classes\Applications\mdink.exe\shell\open\command" /ve /d "\"%EXE%\" \"%%1\"" /f >nul
reg add "HKCU\Software\Classes\Applications\mdink.exe" /v FriendlyAppName /d "mdink" /f >nul
reg add "HKCU\Software\Classes\mdink.md" /ve /d "Markdown document" /f >nul
reg add "HKCU\Software\Classes\mdink.md\DefaultIcon" /ve /d "\"%EXE%\",0" /f >nul
reg add "HKCU\Software\Classes\mdink.md\shell\open\command" /ve /d "\"%EXE%\" \"%%1\"" /f >nul
for %%E in (.md .markdown .mdown .mkd) do (
  reg add "HKCU\Software\Classes\Applications\mdink.exe\SupportedTypes" /v %%E /d "" /f >nul
  reg add "HKCU\Software\Classes\%%E\OpenWithProgids" /v mdink.md /t REG_NONE /f >nul
)
echo.
echo Done. Right-click any .md file ^> Open with ^> Choose another app ^> mdink,
echo and tick "Always" to make it the default viewer.
echo.
pause
