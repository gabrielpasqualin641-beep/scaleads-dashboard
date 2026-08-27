@echo off
REM Sobe o painel ScaleAds num processo unico na porta 3001 (API + interface).
REM Usado pelo atalho de inicializacao do Windows e tambem pela coleta agendada.

cd /d "%~dp0.."

REM Se ja houver algo escutando na 3001, nao sobe outra instancia.
netstat -ano | findstr /R /C:"LISTENING" | findstr /C:":3001 " >nul 2>&1
if %ERRORLEVEL%==0 (
  echo [ScaleAds] Ja existe um servidor na porta 3001. Nada a fazer.
  exit /b 0
)

REM Garante que o painel compilado existe antes de servir.
if not exist "dist\client\index.html" (
  echo [ScaleAds] Build do painel ausente. Compilando...
  call npm run build
)

echo [ScaleAds] Iniciando servidor em http://localhost:3001
call npx tsx server/index.ts
