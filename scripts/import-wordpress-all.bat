@echo off
setlocal
cd /d "%~dp0.."

set SQL=%~1
if "%SQL%"=="" set SQL=C:\Users\User\Downloads\database.sql

set UPLOADS=%~2
if "%UPLOADS%"=="" set UPLOADS=%~dp0..\data\wp-uploads

echo.
echo === WordPress live import (users, businesses, reviews, logos) ===
echo SQL:      %SQL%
echo Uploads:  %UPLOADS%
echo.

node scripts/import-wordpress-sql.js "%SQL%"
if errorlevel 1 exit /b 1

node scripts/import-wordpress-logos.js "%UPLOADS%" "%SQL%"
exit /b %errorlevel%
