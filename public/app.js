const fileInput = document.querySelector('#files');
const uploadButton = document.querySelector('#upload');
const tokenInput = document.querySelector('#token');
const statusElement = document.querySelector('#status');
const workspace = document.querySelector('#workspace');
const itemsElement = document.querySelector('#items');
const countElement = document.querySelector('#count');
const downloadPdfButton = document.querySelector('#download-pdf');
const downloadImagesButton = document.querySelector('#download-images');

let job = null;
let draggedId = null;
const previewUrls = new Map();
tokenInput.value = localStorage.getItem('pdf-composer-token') || '';
tokenInput.addEventListener('change', () => localStorage.setItem('pdf-composer-token', tokenInput.value));

function headers(json = false) {
  const result = {};
  if (json) result['Content-Type'] = 'application/json';
  if (tokenInput.value) result.Authorization = `Bearer ${tokenInput.value}`;
  return result;
}

function setStatus(message, error = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle('error', error);
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers(typeof options.body === 'string'), ...(options.headers || {}) } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return response;
}

async function loadPreview(item) {
  const response = await api(item.previewUrl);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  previewUrls.set(item.id, url);
  return url;
}

function render() {
  if (!job) return;
  workspace.classList.toggle('hidden', job.items.length === 0);
  countElement.textContent = `${job.items.length} item${job.items.length === 1 ? '' : 's'}`;
  itemsElement.replaceChildren();
  job.items.forEach((item) => {
    const element = document.createElement('li');
    element.className = 'item';
    element.draggable = true;
    element.dataset.id = item.id;
    const preview = document.createElement('img');
    preview.className = 'preview';
    preview.alt = item.name;
    const previewUrl = previewUrls.get(item.id);
    if (previewUrl) preview.src = previewUrl;
    else loadPreview(item).then((url) => { preview.src = url; }).catch(() => {});
    const details = document.createElement('div');
    details.innerHTML = `<div class="item-name"></div><div class="item-meta"></div>`;
    details.querySelector('.item-name').textContent = item.name;
    details.querySelector('.item-meta').textContent = item.source === 'pdf' ? 'PDF page' : 'Image';
    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => removeItem(item.id));
    element.append(preview, details, remove);
    element.addEventListener('dragstart', () => { draggedId = item.id; element.classList.add('dragging'); });
    element.addEventListener('dragend', () => element.classList.remove('dragging'));
    element.addEventListener('dragover', (event) => event.preventDefault());
    element.addEventListener('drop', () => reorder(draggedId, item.id));
    itemsElement.append(element);
  });
}

async function refresh() {
  if (!job) return;
  job = await (await api(`/api/jobs/${job.id}`)).json();
  render();
}

async function upload() {
  if (!fileInput.files.length) return setStatus('Choose at least one file.', true);
  uploadButton.disabled = true;
  setStatus('Uploading and rendering PDF pages…');
  try {
    const body = new FormData();
    [...fileInput.files].forEach((file) => body.append('files', file));
    const endpoint = job ? `/api/jobs/${job.id}/files` : '/api/jobs';
    job = await (await api(endpoint, { method: 'POST', body })).json();
    fileInput.value = '';
    render();
    setStatus(`${job.items.length} item${job.items.length === 1 ? '' : 's'} ready.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    uploadButton.disabled = false;
  }
}

async function reorder(fromId, toId) {
  if (!fromId || fromId === toId) return;
  const ids = job.items.map((item) => item.id);
  const fromIndex = ids.indexOf(fromId);
  const toIndex = ids.indexOf(toId);
  ids.splice(fromIndex, 1);
  ids.splice(toIndex, 0, fromId);
  try {
    job = await (await api(`/api/jobs/${job.id}/order`, { method: 'PUT', body: JSON.stringify({ itemIds: ids }) })).json();
    render();
  } catch (error) {
    if (error.message === 'Job not found or expired.') {
      job = null;
      render();
      setStatus('This job has expired or the server was restarted. Please upload the files again.', true);
      return;
    }
    setStatus(error.message, true);
  }
}

async function removeItem(itemId) {
  try {
    await api(`/api/jobs/${job.id}/items/${itemId}`, { method: 'DELETE' });
    const previewUrl = previewUrls.get(itemId);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrls.delete(itemId);
    await refresh();
    setStatus('Item removed.');
  } catch (error) {
    if (error.message === 'Job not found or expired.') {
      job = null;
      render();
      setStatus('This job has expired or the server was restarted. Please upload the files again.', true);
      return;
    }
    setStatus(error.message, true);
  }
}

async function download(kind) {
  if (!job?.items.length) return setStatus('Add at least one item first.', true);
  setStatus('Preparing download…');
  try {
    const response = await api(`/api/jobs/${job.id}/export/${kind}`);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = kind === 'pdf' ? 'pdf-composer.pdf' : 'pdf-composer-images.zip';
    link.click();
    URL.revokeObjectURL(url);
    setStatus('Download ready.');
  } catch (error) {
    if (error.message === 'Job not found or expired.') {
      job = null;
      render();
      setStatus('This job has expired or the server was restarted. Please upload the files again.', true);
      return;
    }
    setStatus(error.message, true);
  }
}

uploadButton.addEventListener('click', upload);
downloadPdfButton.addEventListener('click', () => download('pdf'));
downloadImagesButton.addEventListener('click', () => download('images'));
