import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpError } from './errors.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const sections = ['gallery', 'slider', 'popups', 'mediaHeads'];
const managedId = /^scmu\/(gallery|slider|popups|mediaHeads)\/[a-f0-9]{24}\/[a-f0-9-]{36}$/;

// Cloudinary REST signatures: sort parameters, append secret, then SHA-256.
// https://cloudinary.com/documentation/authentication_signatures
export function signParameters(params, secret) {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha256')
    .update(payload + secret)
    .digest('hex');
}
export class CloudinaryPhotos {
  constructor(db, config, { request = fetch, legacyBucket = null } = {}) {
    this.db = db;
    this.config = config;
    this.request = request;
    this.legacyBucket = legacyBucket;
  }
  requireConfigured() {
    if (!this.config?.configured)
      throw new HttpError(
        503,
        'CLOUDINARY_NOT_CONFIGURED',
        'Cloudinary photo uploads are being configured.',
      );
  }
  get endpoint() {
    return `https://api.cloudinary.com/v1_1/${this.config.cloudName}`;
  }
  async ticket(collection, uid, contentType, size) {
    this.requireConfigured();
    if (!sections.includes(collection) || typeof uid !== 'string' || !uid)
      throw new HttpError(400, 'INVALID_UPLOAD', 'Invalid photograph destination.');
    if (
      typeof contentType !== 'string' ||
      !Object.hasOwn(IMAGE_TYPES, contentType) ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > MAX_IMAGE_BYTES
    )
      throw new HttpError(
        400,
        'INVALID_IMAGE',
        'Choose a JPG, PNG, WebP or GIF smaller than 10 MB.',
      );
    const ticketId = randomUUID();
    const owner = createHash('sha256').update(uid).digest('hex').slice(0, 24);
    const publicId = `scmu/${collection}/${owner}/${ticketId}`;
    const params = {
      public_id: publicId,
      timestamp: Math.floor(Date.now() / 1000),
      overwrite: 'false',
      allowed_formats: 'jpg,png,webp,gif',
      ...(this.config.uploadPreset ? { upload_preset: this.config.uploadPreset } : {}),
    };
    await this.db
      .collection('_uploads')
      .doc(ticketId)
      .create({
        uid,
        collection,
        provider: 'cloudinary',
        publicId,
        storagePath: `cloudinary/${publicId}`,
        contentType,
        size,
        consumed: false,
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + 30 * 60_000),
      });
    return {
      ticketId,
      provider: 'cloudinary',
      uploadUrl: `${this.endpoint}/image/upload`,
      fields: {
        ...params,
        api_key: this.config.apiKey,
        signature: signParameters(params, this.config.apiSecret),
      },
    };
  }
  async providerRequest(path, options = {}) {
    this.requireConfigured();
    let response;
    try {
      response = await this.request(`${this.endpoint}/${path}`, {
        ...options,
        signal: AbortSignal.timeout(10_000),
        headers: {
          ...options.headers,
          Authorization: `Basic ${Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString('base64')}`,
        },
      });
      if (response.status === 404)
        throw new HttpError(400, 'UPLOAD_NOT_FOUND', 'Upload the photo first.');
      if (!response.ok) throw new Error('Provider rejected request');
      return await response.json();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // Never return provider responses, Basic credentials or upstream URLs in errors.
      throw new HttpError(
        503,
        'CLOUDINARY_UNAVAILABLE',
        'Cloudinary is temporarily unavailable. Please try again.',
      );
    }
  }
  async inspect(ticketId, collection, uid) {
    this.requireConfigured();
    const ticket = (await this.db.collection('_uploads').doc(ticketId).get()).data();
    if (
      !ticket ||
      ticket.provider !== 'cloudinary' ||
      ticket.uid !== uid ||
      ticket.collection !== collection ||
      !managedId.test(ticket.publicId) ||
      ticket.storagePath !== `cloudinary/${ticket.publicId}`
    )
      throw new HttpError(400, 'INVALID_UPLOAD', 'Choose a photograph uploaded by your account.');
    if (!ticket.consumed && ticket.expiresAt.toMillis() < Date.now())
      throw new HttpError(
        400,
        'UPLOAD_EXPIRED',
        'The upload expired. Choose the photograph again.',
      );
    // Authoritative Admin API metadata, never an untrusted browser upload response.
    const asset = await this.providerRequest(
      `resources/image/upload/${encodeURIComponent(ticket.publicId)}`,
    );
    if (
      asset.public_id !== ticket.publicId ||
      asset.resource_type !== 'image' ||
      asset.type !== 'upload' ||
      asset.format !== IMAGE_TYPES[ticket.contentType] ||
      asset.bytes !== ticket.size ||
      asset.bytes > MAX_IMAGE_BYTES ||
      !Number.isSafeInteger(asset.version) ||
      asset.version < 1
    )
      throw new HttpError(
        400,
        'INVALID_IMAGE',
        'The uploaded file does not match its upload permit.',
      );
    return {
      storagePath: ticket.storagePath,
      imageUrl: `https://res.cloudinary.com/${this.config.cloudName}/image/upload/v${asset.version}/${ticket.publicId}.${asset.format}`,
    };
  }
  async destroy(storagePath) {
    // Existing Firebase images remain viewable and can be deleted through the Admin SDK.
    // No browser or server upload path uses Firebase Storage anymore.
    if (
      /^uploads\/(gallery|slider|popups|mediaHeads)\/[\w-]+\/[\w-]+\.(jpg|png|webp|gif)$/.test(
        storagePath,
      )
    ) {
      if (!this.legacyBucket)
        throw new HttpError(
          503,
          'LEGACY_STORAGE_NOT_CONFIGURED',
          'The existing photo bucket needs to be configured to remove this photo.',
        );
      await this.legacyBucket.file(storagePath).delete({ ignoreNotFound: true });
      return;
    }
    const publicId =
      typeof storagePath === 'string' && storagePath.startsWith('cloudinary/')
        ? storagePath.slice(11)
        : '';
    if (!managedId.test(publicId))
      throw new HttpError(400, 'INVALID_UPLOAD', 'Invalid managed photograph.');
    const result = await this.providerRequest('image/destroy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ public_id: publicId, invalidate: 'true' }),
    });
    if (!['ok', 'not found'].includes(result.result))
      throw new HttpError(
        503,
        'CLOUDINARY_UNAVAILABLE',
        'The photo could not be removed. Please try again.',
      );
  }
  async *listManaged() {
    let cursor;
    do {
      const query = new URLSearchParams({
        prefix: 'scmu/',
        max_results: '500',
        ...(cursor ? { next_cursor: cursor } : {}),
      });
      const page = await this.providerRequest(`resources/image/upload?${query}`);
      for (const asset of page.resources || [])
        if (managedId.test(asset.public_id))
          yield { name: `cloudinary/${asset.public_id}`, createdAt: asset.created_at };
      cursor = page.next_cursor;
    } while (cursor);
  }
}
