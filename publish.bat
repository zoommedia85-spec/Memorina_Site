@echo off
setlocal
cd /d "%~dp0"

echo ==================================================
echo  Memorina - publish site to GitHub
echo ==================================================
echo.
echo Folder: %CD%
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo Git is not installed or not in PATH.
  pause
  exit /b 1
)

echo [1/5] Removing the saved GitHub login...
cmdkey /delete:git:https://github.com >nul 2>&1
cmdkey /delete:LegacyGeneric:target=git:https://github.com >nul 2>&1

echo [2/5] Setting the repository address...
git remote remove origin >nul 2>&1
git remote add origin https://github.com/zoommedia85-spec/Memorina_Site.git

echo [3/5] Adding files...
git add .

echo [4/5] Saving changes...
git commit -m "update site"
git branch -M main

echo.
echo [5/5] Uploading...
echo A sign-in window will open. Sign in with the account:  zoommedia85-spec
echo (If your browser is already signed in with another GitHub account, sign out first or use a private window.)
echo.
git push -u origin main

echo.
if errorlevel 1 (
  echo ================ FAILED ================
  echo Take a photo of this window and send it.
) else (
  echo ================ DONE ================
  echo The site is uploaded. Cloudflare will publish it in about a minute.
)
echo.
pause
