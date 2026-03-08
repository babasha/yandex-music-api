#!/bin/bash
# Яндекс Музыка — запуск в один клик
# Просто дважды кликните по этому файлу в Finder

cd "$(dirname "$0")"

echo "===================================="
echo "  Яндекс Музыка — Установка"
echo "===================================="

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "Python 3 не найден. Установите с https://python.org"
    echo "Нажмите Enter для выхода..."
    read
    exit 1
fi

# Install dependencies if needed
if ! python3 -c "import flask" 2>/dev/null; then
    echo "Устанавливаю зависимости..."
    pip3 install --break-system-packages flask browser_cookie3 requests typing_extensions aiohttp aiofiles 2>/dev/null || \
    pip3 install flask browser_cookie3 requests typing_extensions aiohttp aiofiles 2>/dev/null || \
    python3 -m pip install flask browser_cookie3 requests typing_extensions aiohttp aiofiles
fi

echo ""
echo "===================================="
echo "  Запуск сервера..."
echo "  Открываю браузер..."
echo "===================================="
echo ""

# Open browser after short delay
(sleep 2 && open "http://127.0.0.1:5000") &

# Start server
python3 gui/app.py
