@echo off
echo Running Publication Uploader Test
echo ================================
echo.

echo Using test-publication.json in dry-run mode
echo.

node uploader.js . --dry-run

echo.
echo Test complete. If no errors were shown, the tool is working correctly.
echo.
echo Press any key to exit
pause > nul 