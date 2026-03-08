/* === State === */
let currentTab = 'login';
let searchType = 'track';
let likesPage = 0;
let likesTotal = 0;
let selectedTracks = new Set();
let allLikeIds = [];
let currentPlaylistKind = null;
let playlistPage = 0;
let previousTab = 'search';
let pickerPath = '';

const PAGE_SIZE = 50;

/* === API Helper === */
async function api(url, options = {}) {
    try {
        const res = await fetch(url, options);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
        return data;
    } catch (e) {
        if (e.message === 'Failed to fetch') throw new Error('Сервер недоступен');
        throw e;
    }
}

/* === Toast === */
function toast(message, type = 'info') {
    const container = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

/* === Auto login === */
async function autoLogin() {
    const btn = document.getElementById('autoLoginBtn');
    const hint = document.getElementById('autoLoginHint');
    const errEl = document.getElementById('loginError');

    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/>
        </svg>
        Авторизация...
    `;
    hint.textContent = 'Читаю cookies браузера...';
    errEl.textContent = '';

    try {
        const data = await api('/api/auto-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        hint.textContent = `Токен получен из ${data.browser}`;
        onLoginSuccess(data.user);
    } catch (e) {
        errEl.textContent = e.message;
        hint.textContent = 'Убедитесь, что вы вошли в music.yandex.ru в браузере';
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/>
            </svg>
            Войти автоматически
        `;
    }
}

function onLoginSuccess(user) {
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userLogin').textContent = user.login;
    document.getElementById('userAvatar').textContent = user.name[0].toUpperCase();
    document.getElementById('userInfo').style.display = 'flex';
    document.getElementById('sidebar').classList.add('authenticated');

    switchTab('likes');
    loadLikes(0);
    toast('Добро пожаловать, ' + user.name + '!', 'success');
}

/* === Auth via token === */
async function login() {
    const btn = document.getElementById('loginBtn');
    const errEl = document.getElementById('loginError');
    const token = document.getElementById('tokenInput').value.trim();

    if (!token) {
        errEl.textContent = 'Введите токен';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Вход...';
    errEl.textContent = '';

    try {
        const data = await api('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
        });

        onLoginSuccess(data.user);
    } catch (e) {
        errEl.textContent = e.message;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Войти';
    }
}

async function logout() {
    await api('/api/logout', { method: 'POST' });
    document.getElementById('userInfo').style.display = 'none';
    document.getElementById('sidebar').classList.remove('authenticated');
    switchTab('login');
    toast('Вы вышли из аккаунта');
}

/* === Tab switching === */
function switchTab(tab) {
    // Hide login tab on auth
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.remove('active');
        el.style.display = 'none';
    });

    const target = document.getElementById('tab-' + tab);
    if (target) {
        target.style.display = 'block';
        target.classList.add('active');
    }

    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tab);
    });

    currentTab = tab;

    // Load data when switching
    if (tab === 'playlists') loadPlaylists();
    if (tab === 'downloads') loadDownloads();
    if (tab === 'settings') loadSettings();
}

/* === Likes === */
async function loadLikes(page) {
    const list = document.getElementById('likesList');
    list.innerHTML = '<div class="loading">Загрузка...</div>';
    likesPage = page;

    try {
        const data = await api(`/api/likes/all?page=${page}&page_size=${PAGE_SIZE}`);
        likesTotal = data.total;
        document.getElementById('likesCount').textContent = `${data.total} треков`;
        renderTrackList(list, data.tracks, 'likes');
        renderPagination('likesPagination', page, data.total, loadLikes);
    } catch (e) {
        list.innerHTML = `<div class="empty-state">${e.message}</div>`;
    }
}

/* === Playlists === */
async function loadPlaylists() {
    const grid = document.getElementById('playlistsGrid');
    const tracksList = document.getElementById('playlistTracks');
    grid.innerHTML = '<div class="loading">Загрузка...</div>';
    grid.style.display = 'grid';
    tracksList.style.display = 'none';
    document.getElementById('backToPlaylists').style.display = 'none';
    document.getElementById('playlistsTitle').textContent = 'Плейлисты';
    document.getElementById('playlistPagination').innerHTML = '';

    try {
        const data = await api('/api/playlists');
        grid.innerHTML = '';

        if (!data.playlists.length) {
            grid.innerHTML = '<div class="empty-state">Нет плейлистов</div>';
            return;
        }

        data.playlists.forEach(p => {
            const card = document.createElement('div');
            card.className = 'playlist-card';
            card.onclick = () => openPlaylist(p.kind, p.title);
            card.innerHTML = `
                ${p.cover
                    ? `<img class="playlist-cover" src="${p.cover}" alt="" loading="lazy">`
                    : `<div class="playlist-cover-placeholder">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                        </svg>
                      </div>`}
                <div class="playlist-title">${esc(p.title)}</div>
                <div class="playlist-meta">${p.track_count} треков</div>
            `;
            grid.appendChild(card);
        });
    } catch (e) {
        grid.innerHTML = `<div class="empty-state">${e.message}</div>`;
    }
}

async function openPlaylist(kind, title) {
    currentPlaylistKind = kind;
    playlistPage = 0;
    document.getElementById('playlistsGrid').style.display = 'none';
    document.getElementById('playlistTracks').style.display = 'flex';
    document.getElementById('backToPlaylists').style.display = 'flex';
    document.getElementById('playlistsTitle').textContent = title;

    await loadPlaylistTracks(0);
}

async function loadPlaylistTracks(page) {
    const list = document.getElementById('playlistTracks');
    list.innerHTML = '<div class="loading">Загрузка...</div>';
    playlistPage = page;

    try {
        const data = await api(`/api/playlist/${currentPlaylistKind}?page=${page}&page_size=${PAGE_SIZE}`);
        renderTrackList(list, data.tracks, 'playlist');
        renderPagination('playlistPagination', page, data.total, loadPlaylistTracks);
    } catch (e) {
        list.innerHTML = `<div class="empty-state">${e.message}</div>`;
    }
}

function showPlaylists() {
    document.getElementById('playlistsGrid').style.display = 'grid';
    document.getElementById('playlistTracks').style.display = 'none';
    document.getElementById('backToPlaylists').style.display = 'none';
    document.getElementById('playlistsTitle').textContent = 'Плейлисты';
    document.getElementById('playlistPagination').innerHTML = '';
}

/* === Search === */
function setSearchType(type) {
    searchType = type;
    document.querySelectorAll('.search-type').forEach(el => {
        el.classList.toggle('active', el.dataset.type === type);
    });
}

async function doSearch() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) return;

    const results = document.getElementById('searchResults');
    results.innerHTML = '<div class="loading">Поиск...</div>';

    try {
        const data = await api(`/api/search?q=${encodeURIComponent(query)}&type=${searchType}`);

        if (searchType === 'track') {
            if (!data.tracks || !data.tracks.length) {
                results.innerHTML = '<div class="empty-state">Ничего не найдено</div>';
                return;
            }
            renderTrackList(results, data.tracks, 'search');
        } else if (searchType === 'album') {
            renderAlbumResults(results, data.albums || []);
        } else if (searchType === 'artist') {
            renderArtistResults(results, data.artists || []);
        }
    } catch (e) {
        results.innerHTML = `<div class="empty-state">${e.message}</div>`;
    }
}

function renderAlbumResults(container, albums) {
    if (!albums.length) {
        container.innerHTML = '<div class="empty-state">Ничего не найдено</div>';
        return;
    }
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'albums-grid';

    albums.forEach(a => {
        const card = document.createElement('div');
        card.className = 'album-card';
        card.onclick = () => openAlbum(a.id);
        card.innerHTML = `
            ${a.cover
                ? `<img class="card-cover" src="${a.cover}" alt="" loading="lazy">`
                : `<div class="playlist-cover-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></div>`}
            <div class="card-title">${esc(a.title)}</div>
            <div class="card-meta">${esc(a.artists)}${a.year ? ' · ' + a.year : ''}</div>
        `;
        grid.appendChild(card);
    });
    container.appendChild(grid);
}

function renderArtistResults(container, artists) {
    if (!artists.length) {
        container.innerHTML = '<div class="empty-state">Ничего не найдено</div>';
        return;
    }
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'artists-grid';

    artists.forEach(ar => {
        const card = document.createElement('div');
        card.className = 'artist-card';
        card.onclick = () => openArtistTracks(ar.id, ar.name);
        card.innerHTML = `
            ${ar.cover
                ? `<img class="card-cover" src="${ar.cover}" alt="" loading="lazy">`
                : `<div class="playlist-cover-placeholder" style="border-radius:50%"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>`}
            <div class="card-title">${esc(ar.name)}</div>
        `;
        grid.appendChild(card);
    });
    container.appendChild(grid);
}

/* === Album View === */
async function openAlbum(albumId) {
    previousTab = currentTab;

    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.remove('active');
        el.style.display = 'none';
    });

    const albumTab = document.getElementById('tab-album');
    albumTab.style.display = 'block';
    albumTab.classList.add('active');

    const header = document.getElementById('albumHeader');
    const tracksList = document.getElementById('albumTracks');

    header.innerHTML = '';
    tracksList.innerHTML = '<div class="loading">Загрузка...</div>';

    try {
        const data = await api(`/api/album/${albumId}`);

        header.innerHTML = `
            ${data.cover ? `<img src="${data.cover}" alt="">` : ''}
            <div class="album-meta">
                <h2>${esc(data.title)}</h2>
                <div class="album-artist">${esc(data.artists)}</div>
                ${data.year ? `<div class="album-year">${data.year}</div>` : ''}
            </div>
        `;

        renderTrackList(tracksList, data.tracks, 'album');
    } catch (e) {
        tracksList.innerHTML = `<div class="empty-state">${e.message}</div>`;
    }
}

async function openArtistTracks(artistId, artistName) {
    previousTab = currentTab;

    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.remove('active');
        el.style.display = 'none';
    });

    const albumTab = document.getElementById('tab-album');
    albumTab.style.display = 'block';
    albumTab.classList.add('active');

    const header = document.getElementById('albumHeader');
    const tracksList = document.getElementById('albumTracks');

    header.innerHTML = `<div class="album-meta"><h2>${esc(artistName)}</h2><div class="album-artist">Треки артиста</div></div>`;
    tracksList.innerHTML = '<div class="loading">Загрузка...</div>';

    try {
        const data = await api(`/api/artist/${artistId}/tracks`);
        renderTrackList(tracksList, data.tracks, 'artist');
    } catch (e) {
        tracksList.innerHTML = `<div class="empty-state">${e.message}</div>`;
    }
}

function goBackFromAlbum() {
    switchTab(previousTab);
}

/* === Track list rendering === */
function renderTrackList(container, tracks, context) {
    container.innerHTML = '';

    if (!tracks.length) {
        container.innerHTML = '<div class="empty-state">Нет треков</div>';
        return;
    }

    // Select all
    if (context === 'likes' || context === 'playlist') {
        const selectRow = document.createElement('div');
        selectRow.className = 'select-all-row';
        selectRow.innerHTML = `
            <label>
                <input type="checkbox" onchange="toggleSelectAll(this, '${context}')">
                Выбрать все на странице
            </label>
        `;
        container.appendChild(selectRow);
    }

    tracks.forEach(track => {
        const row = document.createElement('div');
        row.className = 'track-row';
        row.dataset.trackId = track.id;

        const hasCheckbox = context === 'likes' || context === 'playlist' || context === 'search';

        row.innerHTML = `
            <div class="track-checkbox">
                ${hasCheckbox
                    ? `<input type="checkbox" value="${track.id}" onchange="onTrackSelect(this, '${context}')"
                        ${selectedTracks.has(String(track.id)) ? 'checked' : ''}>`
                    : ''}
            </div>
            <div>
                ${track.cover
                    ? `<img class="track-cover" src="${track.cover}" alt="" loading="lazy">`
                    : `<div class="track-cover-placeholder">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                        </svg>
                      </div>`}
            </div>
            <div class="track-info">
                <div class="track-title">${esc(track.title)}</div>
                <div class="track-artist">${esc(track.artists)}</div>
            </div>
            <div class="track-album" onclick="${track.album_id ? `openAlbum(${track.album_id})` : ''}">${esc(track.album)}</div>
            <div class="track-duration">${track.duration}</div>
            <div class="track-actions">
                <button class="btn-download" onclick="downloadOne(${track.id}, this)" title="Скачать">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                    </svg>
                </button>
            </div>
        `;
        container.appendChild(row);
    });
}

function toggleSelectAll(checkbox, context) {
    const list = checkbox.closest('.track-list');
    const checkboxes = list.querySelectorAll('.track-row .track-checkbox input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.checked = checkbox.checked;
        if (checkbox.checked) {
            selectedTracks.add(cb.value);
        } else {
            selectedTracks.delete(cb.value);
        }
    });
    updateDownloadBtn(context);
}

function onTrackSelect(checkbox, context) {
    if (checkbox.checked) {
        selectedTracks.add(checkbox.value);
    } else {
        selectedTracks.delete(checkbox.value);
    }
    updateDownloadBtn(context);
}

function updateDownloadBtn(context) {
    if (context === 'likes') {
        const btn = document.getElementById('downloadLikesBtn');
        btn.disabled = selectedTracks.size === 0;
        btn.querySelector('svg').nextSibling.textContent = ` Скачать выбранные (${selectedTracks.size})`;
    }
}

/* === Download === */
async function downloadOne(trackId, btn) {
    btn.classList.add('downloading');
    btn.disabled = true;

    try {
        await api('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ track_id: trackId }),
        });
        btn.classList.remove('downloading');
        btn.classList.add('downloaded');
        toast('Трек скачан!', 'success');
    } catch (e) {
        btn.classList.remove('downloading');
        toast('Ошибка: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

async function downloadSelected(context) {
    if (selectedTracks.size === 0) return;

    const ids = Array.from(selectedTracks);

    try {
        const data = await api('/api/download/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ track_ids: ids }),
        });

        toast(`Загрузка ${ids.length} треков начата`, 'success');
        selectedTracks.clear();
        updateDownloadBtn(context);

        // Show progress
        pollProgress(data.batch_id);
    } catch (e) {
        toast('Ошибка: ' + e.message, 'error');
    }
}

async function downloadAll(context) {
    if (context !== 'likes') return;

    try {
        // Get all liked track IDs
        const data = await api('/api/likes');
        const ids = data.tracks.map(t => t.id);

        const batchData = await api('/api/download/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ track_ids: ids }),
        });

        toast(`Загрузка ${ids.length} треков начата`, 'success');
        pollProgress(batchData.batch_id);
    } catch (e) {
        toast('Ошибка: ' + e.message, 'error');
    }
}

async function pollProgress(batchId) {
    const el = document.getElementById('batchProgress');
    const currentEl = document.getElementById('batchCurrent');
    const statsEl = document.getElementById('batchStats');
    const fillEl = document.getElementById('batchFill');

    el.style.display = 'block';

    const poll = async () => {
        try {
            const data = await api(`/api/download/progress/${batchId}`);
            const pct = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;

            currentEl.textContent = data.current || 'Загрузка...';
            statsEl.textContent = `${data.completed}/${data.total} (${pct}%)`;
            fillEl.style.width = pct + '%';

            if (data.status === 'done') {
                currentEl.textContent = 'Загрузка завершена!';
                fillEl.style.width = '100%';
                if (data.errors > 0) {
                    statsEl.textContent += ` (ошибок: ${data.errors})`;
                }
                toast(`Загрузка завершена! ${data.completed - data.errors} из ${data.total}`, 'success');
                setTimeout(() => { el.style.display = 'none'; }, 5000);
                return;
            }

            if (data.status === 'error') {
                currentEl.textContent = 'Ошибка: ' + (data.error || 'неизвестная');
                toast('Ошибка загрузки', 'error');
                setTimeout(() => { el.style.display = 'none'; }, 5000);
                return;
            }

            setTimeout(poll, 1000);
        } catch {
            setTimeout(poll, 2000);
        }
    };

    poll();
}

/* === Downloads === */
async function loadDownloads() {
    const list = document.getElementById('downloadsList');
    list.innerHTML = '<div class="loading">Загрузка...</div>';

    try {
        const data = await api('/api/downloads');
        document.getElementById('downloadsCount').textContent = `${data.total} файлов`;
        list.innerHTML = '';

        if (!data.files.length) {
            list.innerHTML = '<div class="empty-state">Нет загруженных файлов</div>';
            return;
        }

        data.files.forEach(f => {
            const row = document.createElement('div');
            row.className = 'download-row';
            row.innerHTML = `
                <div class="download-name">${esc(f.name)}</div>
                <div class="download-size">${f.size_mb} МБ</div>
                <div>
                    <a href="/api/downloads/file/${encodeURIComponent(f.filename)}" class="btn-icon" title="Скачать" download>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                        </svg>
                    </a>
                </div>
            `;
            list.appendChild(row);
        });
    } catch (e) {
        list.innerHTML = `<div class="empty-state">${e.message}</div>`;
    }
}

/* === Pagination === */
function renderPagination(containerId, currentPage, total, loadFn) {
    const container = document.getElementById(containerId);
    const totalPages = Math.ceil(total / PAGE_SIZE);

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    html += `<button ${currentPage === 0 ? 'disabled' : ''} onclick="(${loadFn.name})(${currentPage - 1})">Назад</button>`;
    html += `<span style="padding:8px;font-size:13px;color:var(--text-secondary)">${currentPage + 1} / ${totalPages}</span>`;
    html += `<button ${currentPage >= totalPages - 1 ? 'disabled' : ''} onclick="(${loadFn.name})(${currentPage + 1})">Далее</button>`;
    container.innerHTML = html;
}

/* === Utils === */
/* === Settings / Folder Picker === */
async function loadSettings() {
    try {
        const data = await api('/api/settings');
        document.getElementById('currentPath').textContent = data.downloads_dir;
        document.getElementById('manualPathInput').value = data.downloads_dir;
    } catch {}
}

async function setPathManual() {
    const input = document.getElementById('manualPathInput');
    const newPath = input.value.trim();
    if (!newPath) return;

    try {
        const data = await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ downloads_dir: newPath }),
        });
        document.getElementById('currentPath').textContent = data.downloads_dir;
        input.value = data.downloads_dir;
        toast('Папка загрузок изменена', 'success');
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function openFolderPicker() {
    const current = document.getElementById('currentPath').textContent;
    document.getElementById('folderPicker').style.display = 'flex';
    await loadPickerDir(current);
}

function closeFolderPicker() {
    document.getElementById('folderPicker').style.display = 'none';
}

async function loadPickerDir(path) {
    const list = document.getElementById('pickerList');
    list.innerHTML = '<div class="loading">Загрузка...</div>';

    try {
        const data = await api('/api/browse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });

        pickerPath = data.current;
        document.getElementById('pickerCurrent').textContent = data.current;
        document.getElementById('pickerUpBtn').disabled = !data.parent;

        list.innerHTML = '';

        if (!data.dirs.length) {
            list.innerHTML = '<div style="padding:16px;color:var(--text-secondary);font-size:13px">Нет подпапок</div>';
            return;
        }

        data.dirs.forEach(d => {
            const item = document.createElement('button');
            item.className = 'picker-item';
            item.onclick = () => loadPickerDir(d.path);
            item.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
                ${esc(d.name)}
            `;
            list.appendChild(item);
        });
    } catch (e) {
        list.innerHTML = `<div style="padding:16px;color:var(--danger);font-size:13px">${e.message}</div>`;
    }
}

async function pickerUp() {
    const current = document.getElementById('pickerCurrent').textContent;
    // Go to parent
    const data = await api('/api/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: current }),
    });
    if (data.parent) {
        await loadPickerDir(data.parent);
    }
}

async function pickerSelect() {
    const path = pickerPath;
    try {
        const data = await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ downloads_dir: path }),
        });
        document.getElementById('currentPath').textContent = data.downloads_dir;
        document.getElementById('manualPathInput').value = data.downloads_dir;
        closeFolderPicker();
        toast('Папка загрузок: ' + data.downloads_dir, 'success');
    } catch (e) {
        toast(e.message, 'error');
    }
}

function esc(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}
