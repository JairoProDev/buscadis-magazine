@echo off
echo Publication Uploader Tool
echo ================================

REM Check if path argument is provided
if "%~1"=="" (
  echo Error: Please provide the path to JSON files directory.
  echo.
  echo Usage: run-uploader.bat [path/to/json/files] [options]
  echo Options:
  echo   --dry-run   Test without making changes
  echo   --force     Skip confirmation prompts
  echo.
  echo Example: run-uploader.bat C:\path\to\files
  exit /b 1
)

REM Get full arguments string
set args=%*

REM Print information
echo Source directory: %1
echo.
echo Starting uploader...
echo.

REM Run the uploader script with all arguments
node uploader.js %args%

echo.
echo Press any key to exit
pause > nul 