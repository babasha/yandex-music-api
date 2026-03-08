"""Веб-интерфейс для Яндекс Музыки."""

import os
import sys
import json
import threading
from pathlib import Path

import requests as http_requests
import browser_cookie3
from flask import Flask, render_template, request, jsonify, send_file

# Add parent directory to path so we can import yandex_music
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from yandex_music import Client

app = Flask(__name__)
app.secret_key = os.urandom(24)


@app.after_request
def add_cors(response):
    """Allow requests from Chrome extensions."""
    origin = request.headers.get('Origin', '')
    if origin.startswith('chrome-extension://') or origin.startswith('http://127.0.0.1'):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

# Global state
client_storage = {}
download_progress = {}
CONFIG_FILE = Path(__file__).resolve().parent / '.gui_config.json'
DEFAULT_DOWNLOADS = str(Path(__file__).resolve().parent.parent / 'downloads')


def load_config():
    """Load saved config from disk."""
    try:
        return json.loads(CONFIG_FILE.read_text())
    except Exception:
        return {}


def save_config(data):
    """Save config to disk."""
    cfg = load_config()
    cfg.update(data)
    CONFIG_FILE.write_text(json.dumps(cfg))


def get_downloads_dir():
    """Get current downloads directory, creating it if needed."""
    cfg = load_config()
    d = Path(cfg.get('downloads_dir', DEFAULT_DOWNLOADS))
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_client():
    """Get the current authenticated client."""
    return client_storage.get('client')


def restore_session():
    """Try to restore client from saved token."""
    if get_client():
        return
    cfg = load_config()
    token = cfg.get('token')
    if token:
        try:
            cl = Client(token, report_unknown_fields=False).init()
            client_storage['client'] = cl
        except Exception:
            pass


# Restore session on startup
restore_session()


def get_downloaded_files():
    """Get a set of sanitized filenames (without extension) in downloads dir."""
    dl = get_downloads_dir()
    try:
        return {f.stem for f in dl.iterdir() if f.is_file() and f.suffix == '.mp3'}
    except Exception:
        return set()


def track_to_dict(track):
    """Convert a Track object to a JSON-serializable dict."""
    artists = ', '.join(a.name for a in track.artists) if track.artists else 'Неизвестный'
    album = track.albums[0].title if track.albums else 'Неизвестный альбом'
    album_id = track.albums[0].id if track.albums else None
    cover = None
    if track.cover_uri:
        cover = 'https://' + track.cover_uri.replace('%%', '200x200')
    elif track.albums and track.albums[0].cover_uri:
        cover = 'https://' + track.albums[0].cover_uri.replace('%%', '200x200')

    duration_ms = track.duration_ms or 0
    minutes = duration_ms // 60000
    seconds = (duration_ms % 60000) // 1000

    # Check if already downloaded
    safe_name = "".join(c for c in f'{artists} - {track.title}' if c not in r'\/:*?"<>|').strip()
    downloaded = safe_name in get_downloaded_files()

    return {
        'id': track.id,
        'title': track.title,
        'artists': artists,
        'album': album,
        'album_id': album_id,
        'cover': cover,
        'duration': f'{minutes}:{seconds:02d}',
        'duration_ms': duration_ms,
        'downloaded': downloaded,
    }


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/settings', methods=['GET'])
def get_settings():
    """Get current app settings."""
    return jsonify({'downloads_dir': str(get_downloads_dir())})


@app.route('/api/settings', methods=['POST'])
def update_settings():
    """Update app settings."""
    data = request.get_json()
    new_dir = data.get('downloads_dir', '').strip()
    if not new_dir:
        return jsonify({'error': 'Путь не указан'}), 400

    path = Path(new_dir)
    try:
        path.mkdir(parents=True, exist_ok=True)
        if not os.access(str(path), os.W_OK):
            return jsonify({'error': 'Нет прав на запись в эту папку'}), 400
        resolved = str(path.resolve())
        save_config({'downloads_dir': resolved})
        return jsonify({'success': True, 'downloads_dir': resolved})
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/browse', methods=['POST'])
def browse_directory():
    """List subdirectories for folder picker."""
    data = request.get_json()
    current = data.get('path', '').strip()

    if not current:
        current = str(Path.home())

    path = Path(current)
    if not path.exists() or not path.is_dir():
        return jsonify({'error': 'Папка не существует'}), 400

    dirs = []
    try:
        for item in sorted(path.iterdir()):
            if item.is_dir() and not item.name.startswith('.'):
                dirs.append({
                    'name': item.name,
                    'path': str(item),
                })
    except PermissionError:
        return jsonify({'error': 'Нет доступа к папке'}), 403

    parent = str(path.parent) if path.parent != path else None

    return jsonify({
        'current': str(path),
        'parent': parent,
        'dirs': dirs,
    })


@app.route('/api/auth-status')
def auth_status():
    """Check if user is authenticated."""
    cl = get_client()
    if cl:
        account = cl.me.account
        return jsonify({
            'authenticated': True,
            'user': {
                'name': account.first_name or account.login or 'Пользователь',
                'login': account.login,
            }
        })
    return jsonify({'authenticated': False})


@app.route('/api/auto-login', methods=['POST'])
def auto_login():
    """Fully automatic login: read Session_id from browser cookies, exchange for token, authenticate."""
    BROWSERS = [
        ('Chrome', browser_cookie3.chrome),
        ('Firefox', browser_cookie3.firefox),
        ('Edge', browser_cookie3.edge),
        ('Opera', browser_cookie3.opera),
    ]
    DOMAINS = ['.yandex.com', '.yandex.ru']

    browser_name = None
    token = None

    for name, browser_fn in BROWSERS:
        try:
            cj = browser_fn(domain_name='yandex')
        except Exception:
            continue

        # Collect cookies per domain
        for domain in DOMAINS:
            session_id = None
            session_id2 = None
            for c in cj:
                if c.domain == domain:
                    if c.name == 'Session_id' and c.value:
                        session_id = c.value
                    elif c.name == 'sessionid2' and c.value:
                        session_id2 = c.value

            if not session_id:
                continue

            cookie_header = f'Session_id={session_id}'
            if session_id2:
                cookie_header += f'; sessionid2={session_id2}'

            try:
                resp = http_requests.post(
                    'https://mobileproxy.passport.yandex.net/1/bundle/oauth/token_by_sessionid',
                    data={
                        'client_id': '23cabbbdc6cd418abb4b39c32c41195d',
                        'client_secret': '53bc75238f0c4d08a118e51fe9203300',
                    },
                    headers={
                        'Ya-Client-Host': 'passport.yandex.com',
                        'Ya-Client-Cookie': cookie_header,
                    },
                )
                result = resp.json()
                if result.get('status') == 'ok':
                    token = result['access_token']
                    browser_name = name
                    break
            except Exception:
                continue

        if token:
            break

    if not token:
        return jsonify({
            'error': 'Не удалось получить токен. Откройте music.yandex.ru в браузере и войдите в аккаунт.'
        }), 400

    # Authenticate with the token
    try:
        cl = Client(token, report_unknown_fields=False).init()
        client_storage['client'] = cl
        save_config({'token': token})
        account = cl.me.account
        return jsonify({
            'success': True,
            'browser': browser_name,
            'user': {
                'name': account.first_name or account.login or 'Пользователь',
                'login': account.login,
                'has_plus': cl.me.plus.has_plus if cl.me.plus else False,
            }
        })
    except Exception as e:
        return jsonify({'error': f'Ошибка авторизации: {str(e)}'}), 401


@app.route('/api/token_by_session', methods=['POST'])
def token_by_session():
    """Exchange Session_id cookie for OAuth token."""
    data = request.get_json()
    session_id = data.get('session_id', '').strip()
    if not session_id:
        return jsonify({'error': 'Session_id не указан'}), 400

    try:
        resp = http_requests.post(
            'https://mobileproxy.passport.yandex.net/1/bundle/oauth/token_by_sessionid',
            data={
                'client_id': '23cabbbdc6cd418abb4b39c32c41195d',
                'client_secret': '53bc75238f0c4d08a118e51fe9203300',
            },
            headers={
                'Ya-Client-Host': 'passport.yandex.com',
                'Ya-Client-Cookie': f'Session_id={session_id}',
            },
        )
        result = resp.json()
        if result.get('status') == 'ok':
            return jsonify({'token': result['access_token']})
        else:
            error_msg = result.get('errors', ['Неизвестная ошибка'])
            return jsonify({'error': f'Ошибка Passport API: {error_msg}'}), 400
    except Exception as e:
        return jsonify({'error': f'Ошибка запроса: {str(e)}'}), 500


@app.route('/api/login', methods=['POST'])
def login():
    """Authenticate with token."""
    data = request.get_json()
    token = data.get('token', '').strip()
    if not token:
        return jsonify({'error': 'Токен не указан'}), 400

    try:
        cl = Client(token, report_unknown_fields=False).init()
        client_storage['client'] = cl
        save_config({'token': token})
        account = cl.me.account
        return jsonify({
            'success': True,
            'user': {
                'name': account.first_name or account.login or 'Пользователь',
                'login': account.login,
                'has_plus': cl.me.plus.has_plus if cl.me.plus else False,
            }
        })
    except Exception as e:
        return jsonify({'error': f'Ошибка авторизации: {str(e)}'}), 401


@app.route('/api/logout', methods=['POST'])
def logout():
    """Logout."""
    client_storage.pop('client', None)
    save_config({'token': ''})
    return jsonify({'success': True})


@app.route('/api/likes')
def get_likes():
    """Get liked tracks."""
    cl = get_client()
    if not cl:
        return jsonify({'error': 'Не авторизован'}), 401

    try:
        likes = cl.users_likes_tracks()
        # Fetch tracks in batches
        track_ids = [f'{t.track_id}' for t in likes[:100]]
        tracks = cl.tracks(track_ids)
        result = [track_to_dict(t) for t in tracks]
        return jsonify({
            'tracks': result,
            'total': len(likes.tracks) if likes.tracks else 0,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/likes/all')
def get_all_likes():
    """Get all liked tracks (paginated)."""
    cl = get_client()
    if not cl:
        return jsonify({'error': 'Не авторизован'}), 401

    page = int(request.args.get('page', 0))
    page_size = int(request.args.get('page_size', 50))

    try:
        likes = cl.users_likes_tracks()
        total = len(likes.tracks) if likes.tracks else 0
        start = page * page_size
        end = start + page_size
        batch = likes[start:end]

        track_ids = [f'{t.track_id}' for t in batch]
        if not track_ids:
            return jsonify({'tracks': [], 'total': total, 'page': page})

        tracks = cl.tracks(track_ids)
        result = [track_to_dict(t) for t in tracks]
        return jsonify({
            'tracks': result,
            'total': total,
            'page': page,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/playlists')
def get_playlists():
    """Get user playlists."""
    cl = get_client()
    if not cl:
        return jsonify({'error': 'Не авторизован'}), 401

    try:
        playlists = cl.users_playlists_list()
        result = []
        for p in playlists:
            cover = None
            if p.cover and p.cover.uri:
                cover = 'https://' + p.cover.uri.replace('%%', '200x200')
            elif p.og_image:
                cover = 'https://' + p.og_image.replace('%%', '200x200')
            result.append({
                'kind': p.kind,
                'title': p.title,
                'track_count': p.track_count,
                'cover': cover,
                'owner': p.owner.login if p.owner else None,
            })
        return jsonify({'playlists': result})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/playlist/<int:kind>')
def get_playlist_tracks(kind):
    """Get tracks from a playlist."""
    cl = get_client()
    if not cl:
        return jsonify({'error': 'Не авторизован'}), 401

    page = int(request.args.get('page', 0))
    page_size = int(request.args.get('page_size', 50))

    try:
        uid = cl.me.account.uid
        playlist = cl.users_playlists(kind, uid)
        tracks_short = playlist.tracks or []
        total = len(tracks_short)

        start = page * page_size
        end = start + page_size
        batch = tracks_short[start:end]

        track_ids = [f'{t.track_id}' for t in batch]
        if not track_ids:
            return jsonify({'tracks': [], 'total': total, 'page': page})

        tracks = cl.tracks(track_ids)
        result = [track_to_dict(t) for t in tracks]
        return jsonify({
            'tracks': result,
            'total': total,
            'page': page,
            'title': playlist.title,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/search')
def search():
    """Search for tracks."""
    cl = get_client()
    if not cl:
        return jsonify({'error': 'Не авторизован'}), 401

    query = request.args.get('q', '').strip()
    search_type = request.args.get('type', 'track')
    page = int(request.args.get('page', 0))

    if not query:
        return jsonify({'error': 'Пустой запрос'}), 400

    try:
        results = cl.search(query, type_=search_type, page=page)

        if search_type == 'track' and results.tracks:
            tracks = [track_to_dict(t) for t in results.tracks.results]
            return jsonify({
                'tracks': tracks,
                'total': results.tracks.total,
                'page': page,
            })
        elif search_type == 'album' and results.albums:
            albums = []
            for a in results.albums.results:
                cover = None
                if a.cover_uri:
                    cover = 'https://' + a.cover_uri.replace('%%', '200x200')
                albums.append({
                    'id': a.id,
                    'title': a.title,
                    'artists': ', '.join(ar.name for ar in a.artists) if a.artists else '',
                    'year': a.year,
                    'track_count': a.track_count,
                    'cover': cover,
                })
            return jsonify({
                'albums': albums,
                'total': results.albums.total,
                'page': page,
            })
        elif search_type == 'artist' and results.artists:
            artists = []
            for ar in results.artists.results:
                cover = None
                if ar.cover and ar.cover.uri:
                    cover = 'https://' + ar.cover.uri.replace('%%', '200x200')
                elif ar.og_image:
                    cover = 'https://' + ar.og_image.replace('%%', '200x200')
                artists.append({
                    'id': ar.id,
                    'name': ar.name,
                    'cover': cover,
                })
            return jsonify({
                'artists': artists,
                'total': results.artists.total,
                'page': page,
            })

        return jsonify({'tracks': [], 'total': 0, 'page': page})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/album/<int:album_id>')
def get_album(album_id):
    """Get album with tracks."""
    cl = get_client()
    if not cl:
        return jsonify({'error': 'Не авторизован'}), 401

    try:
        album = cl.albums_with_tracks(album_id)
        tracks = []
        if album.volumes:
            for volume in album.volumes:
                for t in volume:
                    tracks.append(track_to_dict(t))

        cover = None
        if album.cover_uri:
            cover = 'https://' + album.cover_uri.replace('%%', '400x400')

        return jsonify({
            'id': album.id,
            'title': album.title,
            'artists': ', '.join(a.name for a in album.artists) if album.artists else '',
            'year': album.year,
            'cover': cover,
            'tracks': tracks,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/artist/<int:artist_id>/tracks')
def get_artist_tracks(artist_id):
    """Get artist tracks."""
    cl = get_client()
    if not cl:
        return jsonify({'error': 'Не авторизован'}), 401

    page = int(request.args.get('page', 0))

    try:
        result = cl.artists_tracks(artist_id, page=page, page_size=50)
        tracks = [track_to_dict(t) for t in result.tracks]
        return jsonify({
            'tracks': tracks,
            'total': result.pager.total if result.pager else len(tracks),
            'page': page,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/download', methods=['POST'])
def download_track():
    """Download a single track."""
    cl = get_client()
    if not cl:
        return jsonify({'error': 'Не авторизован'}), 401

    data = request.get_json()
    track_id = data.get('track_id')
    if not track_id:
        return jsonify({'error': 'track_id не указан'}), 400

    try:
        tracks = cl.tracks([str(track_id)])
        if not tracks:
            return jsonify({'error': 'Трек не найден'}), 404

        track = tracks[0]
        artists = ', '.join(a.name for a in track.artists) if track.artists else 'Unknown'
        # Sanitize filename
        safe_name = "".join(c for c in f'{artists} - {track.title}' if c not in r'\/:*?"<>|').strip()
        filename = f'{safe_name}.mp3'
        filepath = get_downloads_dir() / filename

        if not filepath.exists():
            download_progress[str(track_id)] = {'status': 'downloading', 'filename': filename}
            track.download(str(filepath))

        download_progress[str(track_id)] = {'status': 'done', 'filename': filename}
        return jsonify({'success': True, 'filename': filename})
    except Exception as e:
        download_progress[str(track_id)] = {'status': 'error', 'error': str(e)}
        return jsonify({'error': str(e)}), 500


@app.route('/api/download/batch', methods=['POST'])
def download_batch():
    """Start batch download in background."""
    cl = get_client()
    if not cl:
        return jsonify({'error': 'Не авторизован'}), 401

    data = request.get_json()
    track_ids = data.get('track_ids', [])
    if not track_ids:
        return jsonify({'error': 'Список треков пуст'}), 400

    batch_id = f'batch_{threading.get_ident()}_{len(track_ids)}'
    download_progress[batch_id] = {
        'status': 'started',
        'total': len(track_ids),
        'completed': 0,
        'errors': 0,
        'current': '',
    }

    def do_download():
        try:
            tracks = cl.tracks([str(tid) for tid in track_ids])
            for i, track in enumerate(tracks):
                try:
                    artists = ', '.join(a.name for a in track.artists) if track.artists else 'Unknown'
                    safe_name = "".join(c for c in f'{artists} - {track.title}' if c not in r'\/:*?"<>|').strip()
                    filename = f'{safe_name}.mp3'
                    filepath = get_downloads_dir() / filename

                    download_progress[batch_id]['current'] = f'{artists} - {track.title}'

                    if not filepath.exists():
                        track.download(str(filepath))

                    download_progress[batch_id]['completed'] = i + 1
                except Exception:
                    download_progress[batch_id]['errors'] += 1
                    download_progress[batch_id]['completed'] = i + 1

            download_progress[batch_id]['status'] = 'done'
        except Exception as e:
            download_progress[batch_id]['status'] = 'error'
            download_progress[batch_id]['error'] = str(e)

    thread = threading.Thread(target=do_download, daemon=True)
    thread.start()

    return jsonify({'success': True, 'batch_id': batch_id})


@app.route('/api/download/progress/<batch_id>')
def get_download_progress(batch_id):
    """Get batch download progress."""
    progress = download_progress.get(batch_id)
    if not progress:
        return jsonify({'error': 'Загрузка не найдена'}), 404
    return jsonify(progress)


@app.route('/api/downloads')
def list_downloads():
    """List downloaded files."""
    files = []
    for f in sorted(get_downloads_dir().iterdir()):
        if f.is_file() and f.suffix == '.mp3':
            files.append({
                'name': f.stem,
                'filename': f.name,
                'size_mb': round(f.stat().st_size / (1024 * 1024), 1),
            })
    return jsonify({'files': files, 'total': len(files)})


@app.route('/api/downloads/file/<path:filename>')
def serve_download(filename):
    """Serve a downloaded file."""
    filepath = get_downloads_dir() / filename
    if not filepath.exists():
        return jsonify({'error': 'Файл не найден'}), 404
    return send_file(filepath, as_attachment=True)


if __name__ == '__main__':
    print('=' * 50)
    print('  Яндекс Музыка — Веб-интерфейс')
    print('  Откройте http://127.0.0.1:5000')
    print('=' * 50)
    app.run(debug=True, port=5000)
