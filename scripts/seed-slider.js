import { readFile } from 'node:fs/promises';
import { loadConfig } from '../lib/config.js';
import { createFirebaseServices } from '../lib/firebase.js';
try {
  const { store, photos } = createFirebaseServices(loadConfig())();
  photos.requireConfigured();
  if ((await store.getSlider()).items.length)
    throw new Error('The slider already has photos. Manage it in the dashboard.');
  const slides = JSON.parse(
    await readFile(new URL('../public/assets/starter-slides.json', import.meta.url), 'utf8'),
  );
  for (const [order, slide] of slides.entries()) {
    const bytes = await readFile(new URL(`../public${slide.imageUrl}`, import.meta.url));
    const ticket = await photos.ticket('slider', 'seed', 'image/jpeg', bytes.length);
    const form = new FormData();
    for (const [key, value] of Object.entries(ticket.fields)) form.append(key, String(value));
    form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'starter.jpg');
    await photos.providerRequest('image/upload', { method: 'POST', body: form });
    const image = await store.prepareImage('slider', { ticketId: ticket.ticketId }, 'seed');
    await store.saveContent(
      'slider',
      {
        order,
        caption: `${slide.caption} · illustrative education photo`,
        postedBy: 'seed',
        postedByEmail: '',
      },
      image,
    );
  }
  console.log(
    'Six illustrative slides saved to Cloudinary and Firestore. Replace them with authorised SCMU photographs.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
