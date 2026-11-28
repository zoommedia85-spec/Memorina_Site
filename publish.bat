@echo off
setlocal
cd /d "%~dp0"

echo ==================================================
echo  Publish this folder to GitHub
echo ==================================================
echo Folder: %CD%
echo.

where git >nul 2>&1
if errorlevel 1 goto nogit

if not exist ".git" (
  git init
  git branch -M main
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  set /p REPO=Paste the GitHub repository address and press Enter: 
  git remote add origin %REPO%
)
git branch -M main

rem deploy settings for the Cloudflare worker (only for the Memorina site folder)
if exist "admin.html" if exist "app.js" if not exist "wrangler.jsonc" (
  (
  echo {
  echo   "name": "memorina-site",
  echo   "compatibility_date": "2025-06-01",
  echo   "assets": {
  echo     "directory": "./"
  echo   }
  echo }
  )> wrangler.jsonc
  (
  echo wrangler.jsonc
  echo .assetsignore
  echo .gitignore
  echo .git
  echo node_modules
  echo README.md
  echo supabase
  echo import
  echo *.bat
  )> .assetsignore
)

echo [1/4] Checking what is already on GitHub...
git rebase --abort >nul 2>&1
git fetch origin main
if errorlevel 1 goto nofetch
goto fetched
:nofetch
echo (nothing on GitHub yet, or no access - continuing)
:fetched

rem keep the real keys that were saved in config.js on GitHub
if exist "config.js" (
  findstr /c:"YOUR-" config.js >nul 2>&1
  if not errorlevel 1 git checkout origin/main -- config.js >nul 2>&1
)

echo [2/4] Saving your changes...
git add .
git commit -m "update site"

echo [3/4] Merging with GitHub...
git pull --rebase --autostash -X theirs origin main
if errorlevel 1 goto failed

echo [4/4] Uploading...
git push -u origin main
if errorlevel 1 goto failed

echo.
echo ================ DONE ================
echo Uploaded. The site updates in about a minute.
goto end

:nogit
echo Git is not installed or not in PATH.
goto end

:failed
echo.
echo ================ FAILED ================
echo Take a photo of this window and send it.

:end
echo.
pause
