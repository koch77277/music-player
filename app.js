// ============================================
// НАСТРОЙКИ — вставьте свои данные из Supabase
// ============================================
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
const STORAGE_BUCKET = 'tracks';

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let tracks = [];
let albums = [];
let playlists = [];
let currentTrack = null;
let audio = new Audio();
let isPlaying = false;
let queue = [];
let queueIndex = 0;

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    currentUser = session.user;
    showApp();
    await loadData();
  } else {
    showAuth();
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      currentUser = session.user;
      showApp();
      loadData();
    } else {
      showAuth();
    }
  });

  setupAudio();
  setupMediaSession();
}

function setupAudio() {
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('ended', playNext);
  audio.addEventListener('play', () => { isPlaying = true; updateMiniPlayer(); });
  audio.addEventListener('pause', () => { isPlaying = false; updateMiniPlayer(); savePosition(); });
}

function setupMediaSession() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', playPrevious);
    navigator.mediaSession.setActionHandler('nexttrack', playNext);
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime) audio.currentTime = details.seekTime;
    });
  }
}

function showAuth() {
  document.getElementById('tabBar').style.display = 'none';
  document.getElementById('miniPlayer').classList.remove('visible');
  document.getElementById('app').innerHTML = `
    <div class="auth">
      <div style="font-size:70px;margin-bottom:20px">🎵</div>
      <h1>Music</h1>
      <p style="color:#8e8e93;margin-bottom:32px">Ваш личный плеер</p>
      <input id="email" type="email" placeholder="Email" autocomplete="username">
      <input id="password" type="password" placeholder="Пароль" autocomplete="current-password">
      <button class="primary" onclick="signIn()">Войти</button>
      <button class="primary" style="background:#2c2c2e" onclick="signUp()">Зарегистрироваться</button>
      <p id="authMsg" style="color:#ff453a;margin-top:16px;font-size:14px"></p>
    </div>
  `;
}

window.signIn = async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) document.getElementById('authMsg').textContent = error.message;
};

window.signUp = async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) document.getElementById('authMsg').textContent = error.message;
  else document.getElementById('authMsg').textContent = 'Проверьте почту (если включено подтверждение)';
};

function showApp() {
  document.getElementById('tabBar').style.display = 'flex';
  renderTab('tracks');
  document.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      renderTab(btn.dataset.tab);
    };
  });
}

async function loadData() {
  const { data: t } = await supabase.from('tracks').select('*').order('created_at', { ascending: false });
  tracks = t || [];
  const { data: a } = await supabase.from('albums').select('*');
  albums = a || [];
  const { data: p } = await supabase.from('playlists').select('*');
  playlists = p || [];
  renderTab(document.querySelector('.tab.active')?.dataset.tab || 'tracks');
}

function renderTab(tab) {
  const app = document.getElementById('app');
  if (tab === 'tracks') {
    app.innerHTML = `
      <div class="screen">
        <h1>Треки</h1>
        <button class="primary" onclick="showUpload()">+ Загрузить трек</button>
        <div id="trackList"></div>
      </div>`;
    const list = document.getElementById('trackList');
    tracks.forEach(t => {
      const el = document.createElement('div');
      el.className = 'track-item';
      el.innerHTML = `<div><strong>${t.title}</strong><br><small style="color:#8e8e93">${t.artist || 'Unknown'}</small></div>`;
      el.onclick = () => playTrack(t, tracks);
      list.appendChild(el);
    });
  } else if (tab === 'albums') {
    app.innerHTML = `<div class="screen"><h1>Альбомы</h1><div id="albumList"></div></div>`;
    albums.forEach(a => {
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `<strong>${a.title}</strong>`;
      document.getElementById('albumList').appendChild(el);
    });
  } else if (tab === 'playlists') {
    app.innerHTML = `<div class="screen"><h1>Плейлисты</h1></div>`;
  } else if (tab === 'stats') {
    loadStats();
  }
}

async function loadStats() {
  const { data: events } = await supabase.from('play_events').select('track_id');
  const counts = {};
  (events || []).forEach(e => counts[e.track_id] = (counts[e.track_id] || 0) + 1);
  const top = tracks.map(t => ({ ...t, count: counts[t.id] || 0 })).filter(t => t.count > 0).sort((a,b) => b.count - a.count);

  document.getElementById('app').innerHTML = `
    <div class="screen">
      <h1>Статистика</h1>
      ${top.map((t,i) => `<div class="list-item"><div>${i+1}. ${t.title}</div><strong>${t.count}</strong></div>`).join('')}
    </div>`;
}

function playTrack(track, list = tracks) {
  queue = list;
  queueIndex = list.findIndex(t => t.id === track.id);
  currentTrack = track;

  const url = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${track.storage_path}`;
  audio.src = url;
  audio.play();

  document.getElementById('miniPlayer').classList.add('visible');
  updateMiniPlayer();
  logPlay(track);
  updateMediaSession();
}

function playNext() {
  if (queue.length === 0) return;
  queueIndex = (queueIndex + 1) % queue.length;
  playTrack(queue[queueIndex], queue);
}

function playPrevious() {
  if (audio.currentTime > 5) {
    audio.currentTime = 0;
  } else {
    queueIndex = queueIndex === 0 ? queue.length - 1 : queueIndex - 1;
    playTrack(queue[queueIndex], queue);
  }
}

function updateMiniPlayer() {
  if (!currentTrack) return;
  document.getElementById('miniTitle').textContent = currentTrack.title;
  document.getElementById('miniArtist').textContent = currentTrack.artist || '';
  document.getElementById('miniPlay').textContent = isPlaying ? '⏸' : '▶';
  document.getElementById('miniPlay').onclick = () => isPlaying ? audio.pause() : audio.play();
}

function updateProgress() {
  if (!audio.duration) return;
  const p = (audio.currentTime / audio.duration) * 100;
  document.getElementById('miniProgress').style.width = p + '%';
}

function updateMediaSession() {
  if ('mediaSession' in navigator && currentTrack) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist || 'Unknown',
      album: currentTrack.album || ''
    });
  }
}

function savePosition() {
  if (currentTrack) {
    localStorage.setItem('lastTrack', currentTrack.id);
    localStorage.setItem('lastPos', audio.currentTime);
  }
}

async function logPlay(track) {
  if (!currentUser) return;
  await supabase.from('play_events').insert({
    user_id: currentUser.id,
    track_id: track.id,
    duration_played: 0
  });
}

window.showUpload = () => {
  document.getElementById('app').innerHTML = `
    <div class="screen">
      <h1>Загрузить</h1>
      <input id="upTitle" placeholder="Название">
      <input id="upArtist" placeholder="Артист">
      <input type="file" id="upFile" accept="audio/*">
      <button class="primary" onclick="uploadTrack()">Загрузить</button>
      <p id="upMsg"></p>
    </div>`;
};

window.uploadTrack = async () => {
  const file = document.getElementById('upFile').files[0];
  const title = document.getElementById('upTitle').value;
  const artist = document.getElementById('upArtist').value;
  if (!file || !title) return;

  const path = `${currentUser.id}/${Date.now()}_${file.name}`;
  const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file);
  if (upErr) { document.getElementById('upMsg').textContent = upErr.message; return; }

  await supabase.from('tracks').insert({
    user_id: currentUser.id,
    title,
    artist: artist || null,
    storage_path: path
  });

  document.getElementById('upMsg').textContent = 'Готово!';
  await loadData();
  setTimeout(() => renderTab('tracks'), 800);
};

init();
