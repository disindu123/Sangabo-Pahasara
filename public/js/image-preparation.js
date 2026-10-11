const MIN_BYTES = 512 * 1024;
const MAX_EDGE = 2400;

// APNG's animation control chunk must precede IDAT. Keep animation intact.
async function isAnimatedPng(file) {
  const data = new DataView(await file.arrayBuffer());
  let offset = 8;
  while (offset + 12 <= data.byteLength) {
    const size = data.getUint32(offset),
      type = data.getUint32(offset + 4);
    if (type === 0x6163544c) return true; // acTL
    if (type === 0x49444154) return false; // IDAT
    offset += size + 12;
  }
  return true; // Unknown/malformed PNG: leave validation to the provider.
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function')
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Reduce bytes before the signed ticket is requested, so its MIME/size match
// what Cloudinary receives. Already-small files and animated formats stay intact.
export async function prepareImage(file) {
  if (file.size < MIN_BYTES || !['image/jpeg', 'image/png'].includes(file.type)) return file;
  let image, canvas;
  try {
    if (file.type === 'image/png' && (await isAnimatedPng(file))) return file;
    image = await decodeImage(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // WebP keeps PNG transparency. Browsers without WebP encoding return PNG.
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
    if (!blob || !['image/webp', 'image/png'].includes(blob.type) || blob.size >= file.size * 0.9)
      return file;
    const extension = blob.type === 'image/webp' ? 'webp' : 'png';
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${extension}`, {
      type: blob.type,
      lastModified: file.lastModified,
    });
  } catch {
    // Limited-memory/older devices can still upload the original photograph.
    return file;
  } finally {
    image?.close?.();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
