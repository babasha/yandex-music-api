@echo off
chcp 65001 >nul
title Яндекс Музыка

echo ====================================
echo   Яндекс Музыка — Установка
echo ====================================

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo Python не найден. Установите с https://python.org
    pause
    exit /b 1
)

python -c "import flask" 2>nul
if %errorlevel% neq 0 (
    echo Устанавливаю зависимости...
    pip install flask browser_cookie3 requests typing_extensions aiohttp aiofiles
)

echo.
echo ====================================
echo   Запуск сервера...
echo ====================================
echo.

start "" http://127.0.0.1:5000
python gui\app.py
pause
