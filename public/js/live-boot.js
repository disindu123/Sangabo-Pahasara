import { setupLivePlayer } from './live-player.js';

// Independent of the homepage/gallery module graph. Express supplies fresh,
// public live metadata when ready; older/static responses retain an API fallback.
async function boot() {
  let live;
  const data = document.querySelector('meta[name="scmu-live"]');
  try {
    if (data) live = JSON.parse(data.content);
  } catch {
    /* Fall back if a proxy or older host provided malformed metadata. */
  }
  if (!live || typeof live.isLive !== 'boolean') {
    const response = await fetch('/api/live', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    live = await response.json();
  }
  setupLivePlayer(live);
}
boot().catch(() => {
  /* The homepage remains available when live services are down. */
});
