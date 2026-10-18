import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { CloudinaryPhotos, MAX_IMAGE_BYTES, signParameters } from '../lib/photos.js';
import { FirebaseStore } from '../lib/store.js';
import { MemoryDB } from './helpers.js';
const cloudConfig = {
  cloudName: 'scmu-test',
  apiKey: 'test-key',
  apiSecret: 'server-secret',
  configured: true,
  uploadPreset: '',
};
function setup() {
  const db = new MemoryDB(),
    files = new Map(),
    deleted = [],
    requests = [];
  const request = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/image/destroy')) {
      const path = `cloudinary/${options.body.get('public_id')}`;
      deleted.push(path);
      files.delete(path);
      return { ok: true, json: async () => ({ result: 'ok' }) };
    }
    const path = `cloudinary/${decodeURIComponent(url.split('/resources/image/upload/')[1])}`;
    if (!files.has(path)) return { ok: false, status: 404 };
    return { ok: true, json: async () => files.get(path) };
  };
  return {
    db,
    files,
    deleted,
    requests,
    photos: new CloudinaryPhotos(db, cloudConfig, { request }),
  };
}
async function uploaded(ctx, collection = 'gallery', uid = 'owner') {
  const ticket = await ctx.photos.ticket(collection, uid, 'image/png', 12);
  const publicId = ticket.fields.public_id;
  const storagePath = `cloudinary/${publicId}`;
  ctx.files.set(storagePath, {
    public_id: publicId,
    resource_type: 'image',
    type: 'upload',
    format: 'png',
    bytes: 12,
    version: 123,
  });
  return { ...ticket, storagePath };
}
test('upload permits restrict MIME/size and are single-use and owned', async () => {
  const ctx = setup();
  for (const [type, size] of [
    ['image/svg+xml', 12],
    ['image/jpeg', 0],
    ['image/png', MAX_IMAGE_BYTES + 1],
  ])
    await assert.rejects(ctx.photos.ticket('gallery', 'owner', type, size), {
      code: 'INVALID_IMAGE',
    });
  const ticket = await uploaded(ctx);
  await assert.rejects(ctx.photos.inspect(ticket.ticketId, 'gallery', 'other'), {
    code: 'INVALID_UPLOAD',
  });
  await assert.rejects(ctx.photos.inspect(ticket.ticketId, 'slider', 'owner'), {
    code: 'INVALID_UPLOAD',
  });
  const inspected = await ctx.photos.inspect(ticket.ticketId, 'gallery', 'owner');
  assert.ok(inspected.imageUrl.startsWith('https://res.cloudinary.com/'));
  assert.equal(inspected.storagePath, ticket.storagePath);
});
test('server checks authoritative Cloudinary format and metadata before publication', async () => {
  const ctx = setup(),
    ticket = await uploaded(ctx);
  const original = { ...ctx.files.get(ticket.storagePath) };
  for (const change of [
    { format: 'svg' },
    { bytes: 100 },
    { public_id: 'unrelated' },
    { resource_type: 'raw' },
    { type: 'private' },
    { version: 0 },
  ]) {
    ctx.files.set(ticket.storagePath, { ...original, ...change });
    await assert.rejects(ctx.photos.inspect(ticket.ticketId, 'gallery', 'owner'), {
      code: 'INVALID_IMAGE',
    });
  }
  ctx.files.delete(ticket.storagePath);
  await assert.rejects(ctx.photos.inspect(ticket.ticketId, 'gallery', 'owner'), {
    code: 'UPLOAD_NOT_FOUND',
  });
});
test('expired uploads cannot be published; unconfigured Cloudinary fails closed', async () => {
  const ctx = setup(),
    ticket = await uploaded(ctx);
  await ctx.db
    .collection('_uploads')
    .doc(ticket.ticketId)
    .update({ expiresAt: Timestamp.fromMillis(0) });
  await assert.rejects(ctx.photos.inspect(ticket.ticketId, 'gallery', 'owner'), {
    code: 'UPLOAD_EXPIRED',
  });
  await assert.rejects(
    new CloudinaryPhotos(ctx.db, { configured: false }).ticket('gallery', 'owner', 'image/png', 12),
    { code: 'CLOUDINARY_NOT_CONFIGURED' },
  );
});
test('registration is idempotent and cannot reuse an upload for another document', async () => {
  const ctx = setup(),
    ticket = await uploaded(ctx),
    store = new FirebaseStore(ctx.db, ctx.photos);
  const image = await store.prepareImage('gallery', { ticketId: ticket.ticketId }, 'owner');
  const first = await store.saveContent('gallery', { caption: 'First' }, image);
  const second = await store.saveContent('gallery', { caption: 'Changed' }, image);
  assert.equal(first.id, second.id);
  assert.equal(second.caption, 'First');
  await assert.rejects(store.saveContent('gallery', {}, image, 'different'), {
    code: 'UPLOAD_EXPIRED',
  });
  assert.equal((await ctx.db.collection('gallery').get()).size, 1);
});
test('editing a board contact retains its managed image; replacing it removes the old upload', async () => {
  const ctx = setup(),
    ticket = await uploaded(ctx, 'mediaHeads'),
    store = new FirebaseStore(ctx.db, ctx.photos);
  const image = await store.prepareImage(
    'mediaHeads',
    { ticketId: ticket.ticketId },
    'owner',
    true,
    'photoUrl',
  );
  const first = await store.saveContent('mediaHeads', { name: 'President' }, image, 'president');
  const keep = await store.prepareImage(
    'mediaHeads',
    { photoUrl: first.photoUrl },
    'owner',
    true,
    'photoUrl',
  );
  await store.saveContent('mediaHeads', { name: 'Edited President' }, keep, 'president');
  assert.deepEqual(ctx.deleted, []);
  assert.equal((await store.getItem('mediaHeads', 'president')).storagePath, ticket.storagePath);
  await store.saveContent(
    'mediaHeads',
    { name: 'New President' },
    { imageUrl: 'https://example.com/new.jpg', storagePath: '' },
    'president',
  );
  assert.deepEqual(ctx.deleted, [ticket.storagePath]);
});
test('failed Cloudinary deletion retains metadata; external URLs are never deleted from a provider', async () => {
  const ctx = setup(),
    store = new FirebaseStore(ctx.db, ctx.photos);
  await ctx.db
    .collection('gallery')
    .doc('owned')
    .set({ storagePath: 'uploads/gallery/owner/photo.png' });
  ctx.photos.destroy = async () => {
    throw new Error('unavailable');
  };
  await assert.rejects(store.remove('gallery', 'owned'), /unavailable/);
  assert.equal((await ctx.db.collection('gallery').doc('owned').get()).exists, true);
  await ctx.db
    .collection('gallery')
    .doc('external')
    .set({ imageUrl: 'https://example.com/photo.jpg' });
  await store.remove('gallery', 'external');
  assert.equal((await ctx.db.collection('gallery').doc('external').get()).exists, false);
});

test('upload signatures bind destination, allowed formats and overwrite protection without exposing secrets', async () => {
  const ctx = setup();
  const ticket = await ctx.photos.ticket('popups', 'owner', 'image/png', 12);
  const { signature, api_key, ...params } = ticket.fields;
  assert.equal(signature, signParameters(params, cloudConfig.apiSecret));
  assert.equal(params.overwrite, 'false');
  assert.equal(params.allowed_formats, 'jpg,png,webp,gif');
  assert.ok(!JSON.stringify(ticket).includes(cloudConfig.apiSecret));
  const changed = { ...params, public_id: 'elsewhere' };
  assert.notEqual(signature, signParameters(changed, cloudConfig.apiSecret));
});
test('provider failures fail closed and do not disclose the Cloudinary secret', async () => {
  const ctx = setup(),
    ticket = await uploaded(ctx);
  ctx.photos.request = async () => {
    throw new Error(cloudConfig.apiSecret);
  };
  await assert.rejects(
    ctx.photos.inspect(ticket.ticketId, 'gallery', 'owner'),
    (error) =>
      error.code === 'CLOUDINARY_UNAVAILABLE' && !error.message.includes(cloudConfig.apiSecret),
  );
});
test('deletion only accepts managed Cloudinary IDs and retains legacy Firebase deletion support', async () => {
  const ctx = setup();
  await assert.rejects(ctx.photos.destroy('cloudinary/someone-elses-photo'), {
    code: 'INVALID_UPLOAD',
  });
  await assert.rejects(
    ctx.photos.destroy('https://res.cloudinary.com/scmu-test/image/upload/photo.jpg'),
    { code: 'INVALID_UPLOAD' },
  );
  const removed = [];
  ctx.photos.legacyBucket = { file: (path) => ({ delete: async () => removed.push(path) }) };
  await ctx.photos.destroy('uploads/gallery/owner/photo.png');
  assert.deepEqual(removed, ['uploads/gallery/owner/photo.png']);
});

test('team-photo uploads retain ownership, replace one singleton and delete managed Cloudinary assets', async () => {
  const ctx = setup(),
    store = new FirebaseStore(ctx.db, ctx.photos);
  const first = await uploaded(ctx, 'teamPhoto', 'admin-owner');
  await assert.rejects(ctx.photos.inspect(first.ticketId, 'teamPhoto', 'student'), {
    code: 'INVALID_UPLOAD',
  });
  await assert.rejects(ctx.photos.inspect(first.ticketId, 'gallery', 'admin-owner'), {
    code: 'INVALID_UPLOAD',
  });
  const image = await store.prepareImage('teamPhoto', { ticketId: first.ticketId }, 'admin-owner');
  await store.saveContent('teamPhoto', { caption: 'Team' }, image, 'current');
  await store.saveContent('teamPhoto', { caption: 'Retried response' }, image, 'current');
  assert.equal((await store.getTeamPhoto()).caption, 'Team');
  const second = await uploaded(ctx, 'teamPhoto', 'admin-owner');
  await store.saveContent(
    'teamPhoto',
    { caption: 'New team' },
    await store.prepareImage('teamPhoto', { ticketId: second.ticketId }, 'admin-owner'),
    'current',
  );
  assert.equal((await ctx.db.collection('teamPhoto').get()).size, 1);
  assert.deepEqual(ctx.deleted, [first.storagePath]);
  await store.remove('teamPhoto', 'current');
  assert.deepEqual(ctx.deleted, [first.storagePath, second.storagePath]);
  assert.equal((await store.getTeamPhoto()).imageUrl, '');
});
