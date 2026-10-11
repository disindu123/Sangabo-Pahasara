import { validateImage } from './upload.js';

// Enhance the native file picker; both picker and drop use the same upload path.
export function setupDropUpload(input) {
  if (!input || input.dataset.dropReady) return;
  input.dataset.dropReady = 'true';
  const form = input.form;
  const zone = document.createElement('div');
  zone.className = 'upload-dropzone';
  zone.setAttribute('role', 'group');
  zone.setAttribute('aria-label', input.labels[0]?.textContent || 'Image upload');
  const heading = document.createElement('p');
  heading.className = 'upload-drop-title';
  heading.textContent = 'Drag & drop an image here';
  const hint = document.createElement('p');
  hint.className = 'upload-drop-hint';
  hint.id = `${input.id}-drop-hint`;
  hint.textContent = 'Or choose a file below · JPG, PNG, WebP or GIF · up to 10 MB';
  input.setAttribute(
    'aria-describedby',
    [input.getAttribute('aria-describedby'), hint.id].filter(Boolean).join(' '),
  );
  const preview = document.createElement('img');
  preview.className = 'upload-preview';
  preview.alt = 'Selected image preview';
  preview.hidden = true;
  preview.addEventListener('error', () => {
    preview.hidden = true;
  });
  const note = document.createElement('p');
  note.className = 'upload-selection';
  note.setAttribute('role', 'status');
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'button button-outline upload-clear';
  clear.textContent = 'Remove selected image';
  clear.hidden = true;
  input.before(zone);
  zone.append(heading, hint, input, preview, note, clear);
  let objectUrl,
    depth = 0;
  const blocked = () => input.disabled || !!form.dataset.busy;
  function revoke() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  function render() {
    revoke();
    preview.hidden = true;
    preview.removeAttribute('src');
    const file = input.files[0];
    note.textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : '';
    note.classList.remove('upload-error');
    clear.hidden = !file;
    if (file) {
      objectUrl = URL.createObjectURL(file);
      preview.src = objectUrl;
      preview.hidden = false;
    }
  }
  function showError(error) {
    note.textContent = error.message;
    note.classList.add('upload-error');
  }
  function changed() {
    try {
      if (input.files.length) validateImage(input.files[0]);
      render();
    } catch (error) {
      input.value = '';
      render();
      showError(error);
    }
  }
  input.addEventListener('change', changed);
  clear.addEventListener('click', () => {
    if (blocked()) return;
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
  });
  function idle() {
    depth = 0;
    zone.classList.remove('is-dragging');
  }
  zone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    if (!blocked() && Array.from(event.dataTransfer?.types || []).includes('Files')) {
      depth++;
      zone.classList.add('is-dragging');
    }
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = blocked() ? 'none' : 'copy';
  });
  zone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    if (--depth <= 0) idle();
  });
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    idle();
    if (blocked()) return;
    try {
      const files = event.dataTransfer?.files;
      if (files?.length !== 1) throw new Error('Drop one image at a time.');
      validateImage(files[0]);
      input.files = files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      showError(error);
    }
  });
  function syncAvailability() {
    zone.setAttribute('aria-disabled', String(blocked()));
    // Prevent changes to the selected file while its upload is in progress.
    zone.inert = blocked();
    if (blocked()) idle();
  }
  new MutationObserver(syncAvailability).observe(form, {
    attributes: true,
    attributeFilter: ['aria-busy'],
  });
  new MutationObserver(syncAvailability).observe(input, {
    attributes: true,
    attributeFilter: ['disabled'],
  });
  form.addEventListener('reset', () => requestAnimationFrame(render));
  window.addEventListener('pagehide', revoke);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) render();
  });
  syncAvailability();
  render();
}
