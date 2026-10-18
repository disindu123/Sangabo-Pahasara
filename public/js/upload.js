import { prepareImage } from './image-preparation.js';

// Reuse preparation on retry without retaining files after the selection is gone.
const preparedPhotos = new WeakMap();

// Start locally at selection time; never request a permit or upload until Publish.
export function preparePhoto(file) {
  validateImage(file);
  if (!preparedPhotos.has(file)) preparedPhotos.set(file, prepareImage(file));
  return preparedPhotos.get(file);
}

export function validateImage(file) {
  if (
    !file ||
    !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) ||
    file.size < 1 ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error('Choose a JPG, PNG, WebP or GIF smaller than 10 MB.');
}

export async function uploadPhoto(
  staffApi,
  collection,
  file,
  onProgress = () => {},
  onStatus = () => {},
) {
  validateImage(file);
  onStatus('Preparing image…');
  const uploadFile = await preparePhoto(file);
  onStatus('Starting upload…');
  const ticket = await staffApi('/api/uploads/ticket', {
    method: 'POST',
    body: { collection, contentType: uploadFile.type, size: uploadFile.size },
  });
  if (
    ticket.provider !== 'cloudinary' ||
    !/^https:\/\/api\.cloudinary\.com\/v1_1\/[\w-]+\/image\/upload$/.test(ticket.uploadUrl)
  )
    throw new Error('Cloudinary uploads are being configured.');
  const body = new FormData();
  for (const [key, value] of Object.entries(ticket.fields)) body.append(key, String(value));
  body.append('file', uploadFile);
  onStatus('Uploading image…');
  onProgress(0);
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', ticket.uploadUrl);
    xhr.timeout = 120_000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.min(99, Math.round((100 * event.loaded) / event.total)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else
        reject(
          new Error('Cloudinary could not upload this image. Please choose it again and retry.'),
        );
    };
    xhr.onerror = () =>
      reject(new Error('The photo upload failed. Check your connection and retry.'));
    xhr.ontimeout = () => reject(new Error('The photo upload timed out. Please retry.'));
    xhr.send(body);
  });
  onStatus('Publishing image…');
  // The server rechecks ownership, expiry, actual format and bytes before publishing.
  return ticket.ticketId;
}
