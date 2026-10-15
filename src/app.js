import { upload } from '@vercel/blob/client';

(function () {
  const form = document.getElementById('upload-form');
  const fileInput = document.getElementById('file');
  const drop = document.getElementById('drop');
  const dropText = document.getElementById('drop-text');
  const dropSub = document.getElementById('drop-sub');
  const passwordInput = document.getElementById('password');
  const uploadBtn = document.getElementById('upload-btn');
  const progress = document.getElementById('progress');
  const progressBar = document.getElementById('progress-bar');
  const statusEl = document.getElementById('status');
  const listEl = document.getElementById('files');
  const emptyEl = document.getElementById('empty');
  const countEl = document.getElementById('count');
  const filterInput = document.getElementById('filter');

  let maxFileBytes = 100 * 1024 * 1024;
  let allFiles = [];

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function tooBigMessage() {
    return 'This file is over the ' + Math.round(maxFileBytes / (1024 * 1024)) + ' MB limit. Choose a smaller file.';
  }

  function showSelected() {
    const file = fileInput.files[0];
    if (!file) {
      dropText.textContent = 'Choose a file or drag it here';
      dropSub.textContent = 'Any file type, up to ' + Math.round(maxFileBytes / (1024 * 1024)) + ' MB';
      return;
    }
    dropText.textContent = file.name;
    dropSub.textContent = formatSize(file.size);
    if (file.size > maxFileBytes) {
      setStatus(tooBigMessage(), 'error');
    } else {
      setStatus('');
    }
  }

  // ---- File list -----------------------------------------------------------
  function render() {
    const q = filterInput.value.trim().toLowerCase();
    const shown = q ? allFiles.filter((f) => f.name.toLowerCase().includes(q)) : allFiles;

    listEl.replaceChildren();
    for (const f of shown) {
      const li = document.createElement('li');

      const info = document.createElement('div');
      info.className = 'file-info';
      const name = document.createElement('a');
      name.className = 'file-name';
      name.href = f.downloadUrl;
      name.rel = 'noopener';
      name.textContent = f.name;
      const meta = document.createElement('span');
      meta.className = 'file-meta muted';
      meta.textContent = formatSize(f.size) + ' · ' + formatDate(f.uploadedAt);
      info.append(name, meta);

      const dl = document.createElement('a');
      dl.className = 'btn';
      dl.href = name.href;
      dl.textContent = 'Download';
      dl.setAttribute('aria-label', 'Download ' + f.name);

      li.append(info, dl);
      listEl.append(li);
    }

    countEl.textContent = allFiles.length ? '(' + allFiles.length + ')' : '';
    emptyEl.hidden = shown.length > 0;
    emptyEl.textContent = allFiles.length ? 'No files match that filter.' : 'No files uploaded yet.';
  }

  async function loadFiles() {
    try {
      const res = await fetch('/api/files', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      maxFileBytes = data.maxFileBytes || maxFileBytes;
      allFiles = data.files || [];
      render();
    } catch (err) {
      emptyEl.hidden = false;
      emptyEl.textContent = 'Could not load the file list. Try refreshing the page.';
    }
  }

  // ---- Upload --------------------------------------------------------------
  function randomId() {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
  }

  function cleanName(name) {
    const cleaned = name.replace(/[\u0000-\u001f\u007f\\/]/g, '_').trim().slice(-200);
    return cleaned || 'file';
  }

  async function sendFile(file, password) {
    const pathname = 'files/' + Date.now() + '-' + randomId() + '/' + cleanName(file.name);
    return upload(pathname, file, {
      access: 'public',
      handleUploadUrl: '/api/upload',
      clientPayload: password,
      contentType: file.type || 'application/octet-stream',
      // Large files go up in parts that are retried individually on failure.
      multipart: file.size > 10 * 1024 * 1024,
      onUploadProgress: ({ percentage }) => {
        progressBar.style.width = Math.round(percentage) + '%';
      },
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = fileInput.files[0];
    const password = passwordInput.value;

    if (!file) return setStatus('Choose a file first.', 'error');
    if (file.size > maxFileBytes) {
      return setStatus(tooBigMessage(), 'error');
    }
    if (!password) {
      passwordInput.focus();
      return setStatus('Enter the upload password.', 'error');
    }

    uploadBtn.disabled = true;
    try {
      // Check the password first so nobody waits for a large upload to be refused.
      setStatus('Checking password…');
      const check = await fetch('/api/check-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      }).catch(() => null);
      if (!check) return setStatus('Could not reach the server. Check your connection and try again.', 'error');
      if (check.status === 401) {
        passwordInput.focus();
        return setStatus('Wrong upload password.', 'error');
      }
      if (!check.ok) {
        const body = await check.json().catch(() => ({}));
        return setStatus(body.error || 'The server could not check the password (HTTP ' + check.status + ').', 'error');
      }

      setStatus('Uploading ' + file.name + '…');
      progressBar.style.width = '0';
      progress.hidden = false;
      try {
        const blob = await sendFile(file, password);
        progress.hidden = true;
        fileInput.value = '';
        showSelected();
        setStatus('Uploaded ' + blob.pathname.split('/').pop() + '.', 'success');
        await loadFiles();
      } catch (err) {
        progress.hidden = true;
        setStatus('The upload failed: ' + (err && err.message ? err.message : 'unknown error') + '. Try again.', 'error');
      }
    } finally {
      uploadBtn.disabled = false;
    }
  });

  fileInput.addEventListener('change', showSelected);
  filterInput.addEventListener('input', render);

  ['dragenter', 'dragover'].forEach((type) =>
    drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((type) =>
    drop.addEventListener(type, () => drop.classList.remove('dragging')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      showSelected();
    }
  });

  loadFiles();
})();
