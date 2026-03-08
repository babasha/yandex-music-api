# Получение токена

**Своё OAuth приложение создать нельзя.** Единственный вариант это использовать приложения официальных клиентов Яндекс.Музыка.

## Основные варианты получения токена

- [Вебсайт](https://music-yandex-bot.ru/) (работает не для всех аккаунтов)
- Android приложение: [APK файл](https://github.com/MarshalX/yandex-music-token/releases)
- Расширение для [Google Chrome](https://chrome.google.com/webstore/detail/yandex-music-token/lcbjeookjibfhjjopieifgjnhlegmkib)
- Расширение для [Mozilla Firefox](https://addons.mozilla.org/en-US/firefox/addon/yandex-music-token/)

Каждый вариант выше позволяет скопировать токен. Код каждого варианта [открыт](https://github.com/MarshalX/yandex-music-token).

## Получение токена через Session_id cookie (актуально на 2025 год)

Яндекс усложнил схему авторизации: OAuth-токен больше не передаётся в заголовках веб-версии и недоступен через JavaScript. Однако его можно получить через Session_id cookie.

### Как это работает

1. Веб-версия Яндекс.Музыки использует cookie-авторизацию вместо OAuth
2. `Session_id` — httpOnly cookie, который нельзя получить через JS
3. Но его можно скопировать вручную из DevTools и обменять на OAuth-токен через Passport API

### Пошаговая инструкция

**Шаг 1: Получить Session_id**

1. Откройте https://music.yandex.ru/ (убедитесь, что вы авторизованы)
2. Откройте DevTools: `F12` (или `Cmd+Option+I` на Mac)
3. Перейдите во вкладку **Application** (Chrome) или **Storage** (Firefox)
4. Слева выберите **Cookies** → `music.yandex.com` или `.yandex.ru`
5. Найдите cookie с именем `Session_id`
6. Дважды кликните на значение и скопируйте его полностью

**Шаг 2: Обменять Session_id на OAuth-токен**

```python
import requests

session_id = 'ваш_Session_id_здесь'

url = 'https://mobileproxy.passport.yandex.net/1/bundle/oauth/token_by_sessionid'
data = {
    'client_id': '23cabbbdc6cd418abb4b39c32c41195d',
    'client_secret': '53bc75238f0c4d08a118e51fe9203300',
}
headers = {
    'Ya-Client-Host': 'passport.yandex.com',
    'Ya-Client-Cookie': f'Session_id={session_id}'
}

response = requests.post(url, data=data, headers=headers)
result = response.json()

if result.get('status') == 'ok':
    token = result['access_token']
    print(f'Ваш токен: {token}')
else:
    print(f'Ошибка: {result}')
```

**Шаг 3: Использовать токен**

```python
from yandex_music import Client

client = Client('полученный_токен').init()
print(f'Привет, {client.me.account.first_name}!')
```

### Технические детали

- **Endpoint**: `POST https://mobileproxy.passport.yandex.net/1/bundle/oauth/token_by_sessionid`
- **client_id**: `23cabbbdc6cd418abb4b39c32c41195d` (Yandex Music)
- **client_secret**: `53bc75238f0c4d08a118e51fe9203300`
- **Заголовок Ya-Client-Host**: `passport.yandex.com`
- **Заголовок Ya-Client-Cookie**: `Session_id=значение_cookie`
- **Токен действителен**: 1 год (`expires_in: 31536000`)

### Почему старые способы перестали работать

1. **Расширения браузера** — токен больше не доступен через JavaScript/localStorage
2. **Network tab** — OAuth-токен не передаётся в заголовках Authorization на веб-версии
3. **Веб-версия использует cookie-авторизацию** — Session_id хранится как httpOnly cookie

## Полезные ссылки

- [Способ вместо расширения для продвинутых](https://github.com/MarshalX/yandex-music-api/discussions/513#discussioncomment-2729781)
- [Скрипт получения токена из другого проекта для Яндекс Станции](https://github.com/AlexxIT/YandexStation/blob/master/custom_components/yandex_station/core/yandex_session.py)

Полученный токен можно передавать в конструктор классов `yandex_music.Client` и `yandex_client.ClientAsync`.
