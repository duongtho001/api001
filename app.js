/* ══════════════════════════════════════════════
   Flow AI Studio — Main Application Logic
   ══════════════════════════════════════════════ */

// ── State ──
// ⚠️ ADMIN: Đổi URL API tại đây trước khi deploy
const API_URL = 'https://non-scholars-intend-suggested.trycloudflare.com';
let API_KEY = localStorage.getItem('flow_api_key') || '';
const activeJobs = new Map(); // jobId -> {type, prompt, interval}
const jobHistory = JSON.parse(localStorage.getItem('flow_jobs') || '[]');

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('setting-key').value = API_KEY;
  initNavigation();
  initRangeInputs();
  initFileUploads();
  if (API_KEY) refreshKeyInfo();
  renderJobHistory();
});

// ══════ NAVIGATION ══════
function initNavigation() {
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      switchTab(item.dataset.tab);
    });
  });
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
}

function switchTab(tab) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');
  const titles = { dashboard:'Dashboard', t2i:'Text → Ảnh', r2i:'Ref → Ảnh', t2v:'Text → Video', i2v:'Ảnh → Video', r2v:'Ref → Video', jobs:'Jobs', library:'Thư viện', settings:'Cài đặt' };
  document.getElementById('page-title').textContent = titles[tab] || tab;
  document.getElementById('sidebar').classList.remove('open');
  if (tab === 'library') loadLibrary();
}

// ══════ RANGE INPUTS ══════
function initRangeInputs() {
  ['t2i','r2i','t2v','i2v','r2v'].forEach(prefix => {
    const el = document.getElementById(`${prefix}-concurrency`);
    if (!el) return;
    el.addEventListener('input', () => {
      document.getElementById(`${prefix}-concurrency-val`).textContent = el.value;
    });
  });
}

// ══════ FILE UPLOADS ══════
function initFileUploads() {
  // R2I file upload
  const r2iInput = document.getElementById('r2i-files');
  r2iInput?.addEventListener('change', () => previewFiles(r2iInput, 'r2i-preview'));
  setupDragDrop('r2i-upload-zone', r2iInput, 'r2i-preview');

  // I2V & R2V dynamic uploads handled by click handlers in HTML
  document.addEventListener('change', e => {
    if (e.target.classList.contains('i2v-file') || e.target.classList.contains('r2v-files')) {
      const preview = e.target.closest('.upload-zone')?.querySelector('.upload-preview');
      if (preview) previewFilesFromInput(e.target, preview);
    }
  });
}

function setupDragDrop(zoneId, input, previewId) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  ['dragenter','dragover'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.remove('dragover'); }));
  zone.addEventListener('drop', e => {
    const dt = e.dataTransfer;
    if (dt.files.length) {
      input.files = dt.files;
      previewFiles(input, previewId);
    }
  });
}

function previewFiles(input, previewId) {
  const preview = document.getElementById(previewId);
  if (!preview) return;
  preview.innerHTML = '';
  [...input.files].forEach(f => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    preview.appendChild(img);
  });
}

function previewFilesFromInput(input, previewEl) {
  previewEl.innerHTML = '';
  [...input.files].forEach(f => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    previewEl.appendChild(img);
  });
}

// ══════ API HELPERS ══════
function apiHeaders(isJson = true) {
  const h = {};
  if (isJson) h['Content-Type'] = 'application/json';
  if (API_KEY) h['X-API-Key'] = API_KEY;
  return h;
}

async function apiPost(path, body) {
  const r = await fetch(`${API_URL}${path}`, { method:'POST', headers: apiHeaders(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
  return r.json();
}

async function apiGet(path) {
  const r = await fetch(`${API_URL}${path}`, { headers: apiHeaders(false) });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const h = {};
  if (API_KEY) h['X-API-Key'] = API_KEY;
  const r = await fetch(`${API_URL}/public/api/v1/upload-image`, { method:'POST', headers: h, body: fd });
  if (!r.ok) throw new Error('Upload failed');
  return (await r.json()).path;
}

// ══════ JOB POLLING ══════
function startPolling(jobId, type, promptText) {
  const entry = { jobId, type, prompt: promptText, status:'queued', progress:0, createdAt: Date.now() };
  jobHistory.unshift(entry);
  saveJobHistory();
  renderJobHistory();
  updateActiveCount();

  const interval = setInterval(async () => {
    try {
      const job = await apiGet(`/public/api/v1/jobs/${jobId}`);
      entry.status = job.status;
      entry.progress = job.progress || 0;
      updateJobUI(jobId, job);

      if (job.status === 'completed') {
        clearInterval(interval);
        activeJobs.delete(jobId);
        entry.status = 'completed';
        saveJobHistory();
        updateActiveCount();
        showResult(jobId, type, job);
        notify(`✅ ${type} hoàn thành!`, 'success');
        refreshKeyInfo();
      } else if (job.status === 'failed') {
        clearInterval(interval);
        activeJobs.delete(jobId);
        entry.status = 'failed';
        entry.error = job.error;
        saveJobHistory();
        updateActiveCount();
        notify(`❌ ${type} thất bại: ${job.error || 'Unknown'}`, 'error');
      }
    } catch (e) {
      console.error('Poll error:', e);
    }
  }, 4000);

  activeJobs.set(jobId, interval);
}

function updateActiveCount() {
  const count = activeJobs.size;
  const badge = document.getElementById('active-jobs-badge');
  badge.style.display = count > 0 ? 'inline' : 'none';
  badge.textContent = count;
  document.getElementById('stat-active-jobs').textContent = count;
}

// ══════ SHOW RESULTS ══════
async function fetchMediaBlob(url) {
  const r = await fetch(url, { headers: apiHeaders(false) });
  if (!r.ok) return null;
  return URL.createObjectURL(await r.blob());
}

async function showResult(jobId, type, job) {
  const isImage = type.includes('Image') || type === 'T2I' || type === 'R2I';
  const resultsId = type === 'T2I' ? 't2i-results' : type === 'R2I' ? 'r2i-results' : type === 'T2V' ? 't2v-results' : type === 'I2V' ? 'i2v-results' : 'r2v-results';
  const container = document.getElementById(resultsId);
  if (!container) return;

  const count = isImage ? (job.images_count || job.images?.length || 1) : (job.videos_count || job.videos?.length || 1);
  for (let i = 0; i < count; i++) {
    const apiUrl = isImage ? `${API_URL}/public/api/v1/jobs/${jobId}/image?index=${i}` : `${API_URL}/public/api/v1/jobs/${jobId}/video?index=${i}`;
    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `<div class="result-loading">⏳ Đang tải ${isImage ? 'ảnh' : 'video'}...</div>`;
    container.prepend(card);

    const blobUrl = await fetchMediaBlob(apiUrl);
    if (!blobUrl) {
      card.innerHTML = `<div class="result-error">❌ Không tải được ${isImage ? 'ảnh' : 'video'}</div>`;
      continue;
    }
    if (isImage) {
      card.innerHTML = `<img src="${blobUrl}" alt="Generated Image"><div class="result-info"><span>${type} #${i+1}</span><div class="result-actions"><a href="${blobUrl}" download="${type}_${jobId.slice(0,8)}_${i}.png">⬇️ Tải</a></div></div>`;
    } else {
      card.innerHTML = `<video src="${blobUrl}" controls playsinline></video><div class="result-info"><span>${type} #${i+1}</span><div class="result-actions"><a href="${blobUrl}" download="${type}_${jobId.slice(0,8)}_${i}.mp4">⬇️ Tải</a></div></div>`;
    }
  }
  addToGallery(jobId, type, isImage, count);
}

async function addToGallery(jobId, type, isImage, count) {
  const gallery = document.getElementById('dashboard-gallery');
  if (!gallery) return;
  for (let i = 0; i < count; i++) {
    const apiUrl = isImage ? `${API_URL}/public/api/v1/jobs/${jobId}/image?index=${i}` : `${API_URL}/public/api/v1/jobs/${jobId}/video?index=${i}`;
    const blobUrl = await fetchMediaBlob(apiUrl);
    if (!blobUrl) continue;
    const item = document.createElement('div');
    item.className = 'gallery-item';
    if (isImage) {
      item.innerHTML = `<img src="${blobUrl}" alt="Result"><div class="gallery-label">${type}</div>`;
    } else {
      item.innerHTML = `<video src="${blobUrl}" muted loop onmouseover="this.play()" onmouseout="this.pause()"></video><div class="gallery-label">${type}</div>`;
    }
    gallery.prepend(item);
  }

}

// ══════ JOB UI ══════
function renderJobHistory() {
  const list = document.getElementById('jobs-list');
  if (!list) return;
  list.innerHTML = '';
  jobHistory.slice(0, 50).forEach(j => {
    const icons = { T2I:'🎨', R2I:'🖼️', T2V:'🎬', I2V:'📸', R2V:'🎭' };
    const card = document.createElement('div');
    card.className = 'job-card';
    card.id = `job-${j.jobId}`;
    card.innerHTML = `
      <div class="job-type">${icons[j.type]||'📋'}</div>
      <div class="job-info"><div class="job-title">${j.prompt || j.type}</div><div class="job-meta">${j.jobId.slice(0,8)} · ${new Date(j.createdAt).toLocaleTimeString()}</div></div>
      <div class="job-progress"><div class="progress-bar"><div class="progress-fill" style="width:${j.progress}%"></div></div><div class="progress-text">${j.progress}%</div></div>
      <div class="job-status ${j.status}">${j.status}</div>`;
    list.appendChild(card);
  });
}

function updateJobUI(jobId, job) {
  const card = document.getElementById(`job-${jobId}`);
  if (!card) return;
  card.querySelector('.progress-fill').style.width = `${job.progress||0}%`;
  card.querySelector('.progress-text').textContent = `${job.progress||0}%`;
  const statusEl = card.querySelector('.job-status');
  statusEl.textContent = job.status;
  statusEl.className = `job-status ${job.status}`;
}

function saveJobHistory() {
  localStorage.setItem('flow_jobs', JSON.stringify(jobHistory.slice(0, 100)));
}

function clearCompletedJobs() {
  const kept = jobHistory.filter(j => j.status === 'running' || j.status === 'queued');
  jobHistory.length = 0;
  jobHistory.push(...kept);
  saveJobHistory();
  renderJobHistory();
  notify('🗑️ Đã xóa jobs hoàn thành', 'info');
}

// ══════ KEY INFO ══════
async function refreshKeyInfo() {
  try {
    const info = await apiGet('/public/api/v1/usage');
    document.getElementById('stat-credits').textContent = info.credits_remaining ?? '—';
    document.getElementById('stat-images').textContent = info.image_remaining ?? '—';
    document.getElementById('stat-videos').textContent = info.video_remaining ?? '—';
    document.getElementById('stat-threads').textContent = info.max_concurrent_threads ?? info.max_concurrency ?? '—';
    document.getElementById('stat-plan').textContent = info.plan_label ?? info.plan ?? '—';
    document.getElementById('stat-daily').textContent = `${info.usage_today ?? 0} / ${info.daily_limit ?? '—'}`;
    document.getElementById('stat-expires').textContent = info.expires_at || 'Vĩnh viễn';
    setConnected(true);
  } catch (e) {
    setConnected(false);
  }
}

function setConnected(ok) {
  const dot = document.querySelector('.status-dot');
  const text = document.querySelector('.status-text');
  if (ok) { dot.classList.add('connected'); text.textContent = 'Đã kết nối'; }
  else { dot.classList.remove('connected'); text.textContent = 'Lỗi kết nối'; }
}

// ══════ SETTINGS ══════
function saveSettings() {
  API_KEY = document.getElementById('setting-key').value.trim();
  localStorage.setItem('flow_api_key', API_KEY);
  notify('💾 Đã lưu API Key!', 'success');
  refreshKeyInfo();
}

async function testConnection() {
  const result = document.getElementById('connection-result');
  try {
    const info = await apiGet('/public/api/v1/usage');
    result.className = 'connection-result success';
    result.textContent = `✅ Kết nối OK! Plan: ${info.plan}, Credits: ${info.credits_remaining}, Concurrency: ${info.max_concurrency}`;
    setConnected(true);
  } catch (e) {
    result.className = 'connection-result error';
    result.textContent = `❌ Lỗi: ${e.message}`;
    setConnected(false);
  }
}

function toggleKeyVisibility() {
  const input = document.getElementById('setting-key');
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ══════ HANDLERS ══════
async function handleT2I() {
  const prompts = document.getElementById('t2i-prompts').value.split('\n').map(s=>s.trim()).filter(Boolean);
  if (!prompts.length) return notify('⚠️ Nhập ít nhất 1 prompt', 'error');
  const btn = document.getElementById('btn-t2i');
  btn.disabled = true; btn.classList.add('loading');
  try {
    const body = {
      prompts,
      aspect_ratio: document.getElementById('t2i-aspect').value,
      model_name: document.getElementById('t2i-model').value,
      num_images: parseInt(document.getElementById('t2i-num').value),
      upscale_quality: document.getElementById('t2i-upscale').value,
      max_concurrency: parseInt(document.getElementById('t2i-concurrency').value),
    };
    const res = await apiPost('/public/api/v1/text-to-image', body);
    notify(`🎨 Job tạo ảnh đã bắt đầu: ${res.job_id.slice(0,8)}`, 'info');
    startPolling(res.job_id, 'T2I', prompts[0]);
  } catch (e) { notify(`❌ Lỗi: ${e.message}`, 'error'); }
  btn.disabled = false; btn.classList.remove('loading');
}

async function handleR2I() {
  const files = document.getElementById('r2i-files').files;
  const prompts = document.getElementById('r2i-prompts').value.split('\n').map(s=>s.trim()).filter(Boolean);
  if (!files.length) return notify('⚠️ Chọn ít nhất 1 ảnh tham chiếu', 'error');
  if (!prompts.length) return notify('⚠️ Nhập ít nhất 1 prompt', 'error');
  const btn = document.getElementById('btn-r2i');
  btn.disabled = true; btn.classList.add('loading');
  try {
    notify('📤 Đang upload ảnh...', 'info');
    const paths = [];
    for (const f of files) paths.push(await uploadFile(f));
    const body = {
      prompts,
      reference_images: paths,
      aspect_ratio: document.getElementById('r2i-aspect').value,
      model_name: document.getElementById('r2i-model').value,
      upscale_quality: document.getElementById('r2i-upscale').value,
      max_concurrency: parseInt(document.getElementById('r2i-concurrency').value),
    };
    const res = await apiPost('/public/api/v1/reference-to-image', body);
    notify(`🖼️ Job R2I đã bắt đầu: ${res.job_id.slice(0,8)}`, 'info');
    startPolling(res.job_id, 'R2I', prompts[0]);
  } catch (e) { notify(`❌ Lỗi: ${e.message}`, 'error'); }
  btn.disabled = false; btn.classList.remove('loading');
}

async function handleT2V() {
  const prompts = document.getElementById('t2v-prompts').value.split('\n').map(s=>s.trim()).filter(Boolean);
  if (!prompts.length) return notify('⚠️ Nhập ít nhất 1 prompt', 'error');
  const btn = document.getElementById('btn-t2v');
  btn.disabled = true; btn.classList.add('loading');
  try {
    const body = {
      prompts,
      aspect_ratio: document.getElementById('t2v-aspect').value,
      model_tier: document.getElementById('t2v-model').value,
      upscale_quality: document.getElementById('t2v-upscale').value,
      video_length_seconds: 8,
      chain_mode: document.getElementById('t2v-chain').checked,
      auto_merge: document.getElementById('t2v-merge').checked,
      max_concurrency: parseInt(document.getElementById('t2v-concurrency').value),
    };
    const res = await apiPost('/public/api/v1/text-to-video', body);
    const jobIds = res.job_ids || [res.job_id];
    jobIds.forEach((jid, i) => {
      notify(`🎬 Job T2V #${i+1} đã bắt đầu: ${jid.slice(0,8)}`, 'info');
      startPolling(jid, 'T2V', prompts[i] || prompts[0]);
    });
  } catch (e) { notify(`❌ Lỗi: ${e.message}`, 'error'); }
  btn.disabled = false; btn.classList.remove('loading');
}

async function handleI2V() {
  const items = [];
  document.querySelectorAll('.i2v-item').forEach(el => {
    const file = el.querySelector('.i2v-file')?.files[0];
    const prompt = el.querySelector('.i2v-prompt')?.value.trim();
    if (file && prompt) items.push({ file, prompt });
  });
  if (!items.length) return notify('⚠️ Thêm ít nhất 1 ảnh + prompt', 'error');
  const btn = document.getElementById('btn-i2v');
  btn.disabled = true; btn.classList.add('loading');
  try {
    notify('📤 Đang upload ảnh...', 'info');
    const apiItems = [];
    for (const it of items) {
      const path = await uploadFile(it.file);
      apiItems.push({ image_path: path, prompt: it.prompt });
    }
    const body = {
      items: apiItems,
      aspect_ratio: document.getElementById('i2v-aspect').value,
      model_tier: document.getElementById('i2v-model').value,
      max_concurrency: parseInt(document.getElementById('i2v-concurrency')?.value || '1'),
    };
    const res = await apiPost('/public/api/v1/image-to-video', body);
    notify(`📸 Job I2V đã bắt đầu: ${res.job_id.slice(0,8)}`, 'info');
    startPolling(res.job_id, 'I2V', items[0].prompt);
  } catch (e) { notify(`❌ Lỗi: ${e.message}`, 'error'); }
  btn.disabled = false; btn.classList.remove('loading');
}

async function handleR2V() {
  const items = [];
  document.querySelectorAll('.r2v-item').forEach(el => {
    const files = el.querySelector('.r2v-files')?.files;
    const prompt = el.querySelector('.r2v-prompt')?.value.trim();
    if (files?.length && prompt) items.push({ files: [...files], prompt });
  });
  if (!items.length) return notify('⚠️ Thêm ít nhất 1 nhóm ảnh + prompt', 'error');
  const btn = document.getElementById('btn-r2v');
  btn.disabled = true; btn.classList.add('loading');
  try {
    notify('📤 Đang upload ảnh...', 'info');
    const apiItems = [];
    for (const it of items) {
      const paths = [];
      for (const f of it.files) paths.push(await uploadFile(f));
      apiItems.push({ image_paths: paths, prompt: it.prompt });
    }
    const body = {
      items: apiItems,
      aspect_ratio: document.getElementById('r2v-aspect').value,
      model_tier: document.getElementById('r2v-model').value,
      upscale_quality: document.getElementById('r2v-upscale').value,
      video_length_seconds: 8,
      voice: document.getElementById('r2v-voice').value,
      chain_mode: document.getElementById('r2v-chain').checked,
      auto_merge: document.getElementById('r2v-merge').checked,
      max_concurrency: parseInt(document.getElementById('r2v-concurrency').value),
    };
    const res = await apiPost('/public/api/v1/multi-ref-video', body);
    notify(`🎭 Job R2V đã bắt đầu: ${res.job_id.slice(0,8)}`, 'info');
    startPolling(res.job_id, 'R2V', items[0].prompt);
  } catch (e) { notify(`❌ Lỗi: ${e.message}`, 'error'); }
  btn.disabled = false; btn.classList.remove('loading');
}

// ══════ DYNAMIC ITEMS ══════
let i2vCount = 1;
function addI2VItem() {
  i2vCount++;
  const div = document.createElement('div');
  div.className = 'i2v-item';
  div.innerHTML = `
    <div class="form-group"><label>Ảnh #${i2vCount}</label>
      <div class="upload-zone mini"><input type="file" class="i2v-file" accept="image/*" hidden>
        <div class="upload-placeholder" onclick="this.previousElementSibling.click()"><span class="upload-icon">📁</span><span>Chọn ảnh</span></div>
        <div class="upload-preview"></div></div></div>
    <div class="form-group"><label>Prompt</label><input type="text" class="i2v-prompt" placeholder="Mô tả chuyển động video"></div>`;
  document.getElementById('i2v-items').appendChild(div);
}

let r2vCount = 1;
function addR2VItem() {
  r2vCount++;
  const div = document.createElement('div');
  div.className = 'r2v-item';
  div.innerHTML = `
    <div class="form-group"><label>Ảnh tham chiếu #${r2vCount}</label>
      <div class="upload-zone"><input type="file" class="r2v-files" multiple accept="image/*" hidden>
        <div class="upload-placeholder" onclick="this.previousElementSibling.click()"><span class="upload-icon">📁</span><span>Chọn nhiều ảnh</span></div>
        <div class="upload-preview"></div></div></div>
    <div class="form-group"><label>Prompt</label><input type="text" class="r2v-prompt" placeholder="Mô tả video"></div>`;
  document.getElementById('r2v-items').appendChild(div);
}

// ══════ NOTIFICATIONS ══════
function notify(msg, type = 'info') {
  const container = document.getElementById('notifications');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('hide'); setTimeout(() => toast.remove(), 300); }, 4000);
}

// ══════ LIBRARY ══════
let libraryFiles = [];

async function loadLibrary() {
  const grid = document.getElementById('library-grid');
  const empty = document.getElementById('library-empty');
  grid.innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center">⏳ Đang tải thư viện...</div>';
  try {
    const data = await apiGet('/public/api/v1/storage');
    libraryFiles = data.files || data || [];
    filterLibrary();
  } catch(e) {
    grid.innerHTML = `<div style="color:#ef4444;padding:20px;text-align:center">❌ ${e.message}</div>`;
    empty.style.display = 'none';
  }
}

function filterLibrary() {
  const filter = document.getElementById('lib-filter').value;
  const grid = document.getElementById('library-grid');
  const empty = document.getElementById('library-empty');
  const countEl = document.getElementById('lib-count');

  let files = libraryFiles;
  if (filter === 'images') files = files.filter(f => isImageFile(f));
  if (filter === 'videos') files = files.filter(f => isVideoFile(f));

  countEl.textContent = `${files.length} file`;

  if (!files.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // Group by folder name (clean, no localhost)
  const groups = {};
  files.forEach(f => {
    const folder = f.folder || f.job_id || 'other';
    const cleanFolder = folder.replace(/\\/g, '/').split('/').pop() || folder;
    if (!groups[cleanFolder]) groups[cleanFolder] = { label: cleanFolder, files: [] };
    groups[cleanFolder].files.push(f);
  });

  let html = '';
  let mediaIndex = 0;
  for (const [key, group] of Object.entries(groups)) {
    html += `<div style="grid-column:1/-1;margin-top:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="color:var(--accent);font-size:14px;font-weight:600">📁 ${key}</span>
        <span style="color:var(--muted);font-size:12px">${group.files.length} files</span>
      </div>
    </div>`;
    group.files.forEach(f => {
      const name = f.filename || f.name || (f.path || '').replace(/\\/g, '/').split('/').pop() || 'file';
      const isImg = isImageFile(f);
      const isVid = isVideoFile(f);
      const size = f.size ? formatSize(f.size) : '';
      const time = f.modified_at ? new Date(f.modified_at * 1000).toLocaleString() : '';
      const filePath = f.path || f.filename || name;
      const backendUrl = f._backend_url || '';
      const idx = mediaIndex++;

      html += `<div class="lib-card" style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:transform .2s,border-color .2s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">`; 
      if (isImg) {
        html += `<div id="lib-thumb-${idx}" data-path="${encodeURIComponent(filePath)}" data-backend="${encodeURIComponent(backendUrl)}" data-type="image" style="height:160px;overflow:hidden;background:#0a0e1a;display:flex;align-items:center;justify-content:center;cursor:pointer">
          <div style="color:#64748b;font-size:13px">⏳ Đang tải...</div>
        </div>`;
      } else if (isVid) {
        html += `<div id="lib-thumb-${idx}" data-path="${encodeURIComponent(filePath)}" data-backend="${encodeURIComponent(backendUrl)}" data-type="video" style="height:160px;overflow:hidden;background:#0a0e1a;display:flex;align-items:center;justify-content:center;cursor:pointer">
          <div style="color:#64748b;font-size:13px">⏳ Đang tải...</div>
        </div>`;
      } else {
        html += `<div style="height:80px;background:#0a0e1a;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:32px">📄</div>`;
      }
      html += `<div style="padding:10px 12px">
        <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${name}">${isImg ? '🖼️' : isVid ? '🎬' : '📄'} ${name}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
          <span style="font-size:11px;color:var(--muted)">${size}${time ? ' · ' + time : ''}</span>
          <button onclick="downloadLibFile('${encodeURIComponent(filePath)}','${encodeURIComponent(backendUrl)}','${name}')" style="background:none;border:none;font-size:13px;cursor:pointer;color:var(--accent)" title="Download">⬇️</button>
        </div>
      </div></div>`;
    });
  }
  grid.innerHTML = html;

  // Lazy load thumbnails with IntersectionObserver
  const thumbs = grid.querySelectorAll('[id^="lib-thumb-"]');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        loadLibThumb(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '200px' });
  thumbs.forEach(el => observer.observe(el));
}

// Fetch file with API key → blob URL
async function fetchLibBlob(filePath, backendUrl) {
  const url = `${API_URL}/public/api/v1/storage/file?path=${filePath}&backend=${backendUrl}`;
  const resp = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

// Load a single thumbnail
async function loadLibThumb(el) {
  const path = el.dataset.path;
  const backend = el.dataset.backend;
  const type = el.dataset.type;
  try {
    const blobUrl = await fetchLibBlob(path, backend);
    if (type === 'image') {
      el.innerHTML = `<img src="${blobUrl}" style="width:100%;height:100%;object-fit:cover" onclick="previewMedia('${blobUrl}','image')">`;
    } else {
      el.innerHTML = `<video src="${blobUrl}" style="width:100%;height:100%;object-fit:cover" muted loop onmouseover="this.play()" onmouseout="this.pause()" onclick="previewMedia('${blobUrl}','video')"></video>`;
    }
  } catch(e) {
    el.innerHTML = `<div style="color:#ef4444;font-size:11px;padding:8px;text-align:center">❌ Lỗi tải</div>`;
  }
}

// Preview modal
function previewMedia(blobUrl, type) {
  const existing = document.getElementById('media-preview-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'media-preview-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,.9);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  modal.onclick = () => modal.remove();
  if (type === 'image') {
    modal.innerHTML = `<img src="${blobUrl}" style="max-width:90vw;max-height:90vh;border-radius:12px;box-shadow:0 0 40px rgba(0,0,0,.5)">`;
  } else {
    modal.innerHTML = `<video src="${blobUrl}" controls autoplay style="max-width:90vw;max-height:90vh;border-radius:12px;box-shadow:0 0 40px rgba(0,0,0,.5)"></video>`;
  }
  document.body.appendChild(modal);
}

// Download with auth
async function downloadLibFile(filePath, backendUrl, filename) {
  try {
    const blobUrl = await fetchLibBlob(filePath, backendUrl);
    const a = document.createElement('a');
    a.href = blobUrl; a.download = decodeURIComponent(filename);
    document.body.appendChild(a); a.click(); a.remove();
    notify(`⬇️ Đang tải ${decodeURIComponent(filename)}`, 'success');
  } catch(e) {
    notify(`❌ Lỗi tải file: ${e.message}`, 'error');
  }
}

function isImageFile(f) {
  const name = (f.filename || f.name || f.path || '').toLowerCase();
  return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp') || (f.type && f.type.startsWith('image'));
}

function isVideoFile(f) {
  const name = (f.filename || f.name || f.path || '').toLowerCase();
  return name.endsWith('.mp4') || name.endsWith('.webm') || name.endsWith('.mov') || (f.type && f.type.startsWith('video'));
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + 'KB';
  return (bytes/1048576).toFixed(1) + 'MB';
}
