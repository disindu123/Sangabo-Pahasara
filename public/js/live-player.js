// Load only the SDK for the published provider. Native controls remain usable
// if an SDK is unavailable; audible autoplay still follows browser policy.
function loadApi(name, callback, src) {
  if (
    name === 'YT' ? typeof window.YT?.Player === 'function' : typeof window.FB?.init === 'function'
  )
    return Promise.resolve(window[name]);
  return new Promise((resolve, reject) => {
    const previous = window[callback];
    const timer = setTimeout(() => reject(new Error('Player API timed out')), 12_000);
    window[callback] = () => {
      clearTimeout(timer);
      previous?.();
      resolve(window[name]);
    };
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Player API unavailable'));
    };
    document.head.append(script);
  });
}

function preconnect(origin) {
  if (document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = origin;
  link.crossOrigin = 'anonymous';
  document.head.append(link);
}

export function setupLivePlayer(live) {
  if (!live.isLive || !live.embedUrl) return;
  const url = new URL(live.embedUrl);
  if (!['https://www.youtube-nocookie.com', 'https://www.facebook.com'].includes(url.origin))
    return;
  const youtube = url.origin === 'https://www.youtube-nocookie.com';
  const viewer = document.querySelector('#live-frame');
  const button = document.querySelector('#live-play');
  const status = document.querySelector('#live-status');
  const link = document.querySelector('#live-link');
  link.href = live.url;
  document.querySelector('#live-section').hidden = false;
  preconnect(url.origin);
  preconnect(youtube ? 'https://www.youtube.com' : 'https://connect.facebook.net');
  // Preload the player immediately, without starting an off-screen broadcast.
  url.searchParams.set('autoplay', youtube ? '0' : 'false');
  url.searchParams.set('mute', '0');
  if (youtube) {
    url.searchParams.set('playsinline', '1');
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('origin', location.origin);
  }
  function nativeFrame() {
    const frame = document.createElement('iframe');
    frame.src = url.href;
    frame.title = 'SCMU live broadcast';
    frame.loading = 'eager';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    viewer.replaceChildren(frame);
    return frame;
  }
  let player,
    ready = false,
    visible = false,
    attempted = false,
    failed = false;
  const prompt = () => {
    button.hidden = false;
    status.textContent = 'Tap Play with sound, or press Play in the video player.';
  };
  const playing = () => {
    const muted = player?.isMuted?.();
    button.hidden = muted === false;
    status.textContent = muted
      ? 'Playing without sound. Tap Play with sound to enable audio.'
      : 'Live broadcast playing. Use the player controls for volume and pause.';
  };
  function play(manual = false) {
    if (!ready || (!manual && (attempted || !visible || document.hidden))) return;
    attempted = true;
    prompt();
    try {
      // Called synchronously from a click for browsers requiring user activation.
      if (youtube) {
        player.unMute();
        player.playVideo();
      } else {
        player.unmute();
        player.play();
      }
    } catch {
      status.textContent = 'Use Play in the video player or Watch on platform.';
    }
  }
  button.addEventListener('click', () => play(true));
  function onReady(instance) {
    if (failed) return;
    clearTimeout(readyTimer);
    player = instance;
    ready = true;
    button.disabled = false;
    prompt();
    play();
  }
  function fallback() {
    if (failed) return;
    failed = true;
    clearTimeout(readyTimer);
    ready = false;
    button.hidden = true;
    status.textContent = 'Press Play in the video player for sound, or choose Watch on platform.';
    if (!youtube) nativeFrame();
  }
  const readyTimer = setTimeout(fallback, 12_000);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.15;
        play();
      },
      { threshold: [0, 0.15] },
    );
    observer.observe(viewer);
  }
  document.addEventListener('visibilitychange', () => play());

  if (youtube) {
    const frame = nativeFrame();
    loadApi('YT', 'onYouTubeIframeAPIReady', 'https://www.youtube.com/iframe_api')
      .then((YT) => {
        if (failed) return;
        new YT.Player(frame, {
          events: {
            onReady: (event) => onReady(event.target),
            onStateChange: (event) => {
              if (event.data === 1) playing();
              else if (event.data === 2) prompt();
            },
            onAutoplayBlocked: prompt,
            onError: () => {
              status.textContent = 'This broadcast is unavailable here. Choose Watch on platform.';
            },
          },
        });
      })
      .catch(fallback);
  } else {
    // SDK controls are needed to unmute Facebook; its native autoplay is muted.
    if (!document.getElementById('fb-root')) {
      const root = document.createElement('div');
      root.id = 'fb-root';
      document.body.prepend(root);
    }
    const mount = document.createElement('div');
    mount.id = 'live-facebook-player';
    mount.className = 'fb-video';
    mount.dataset.href = live.url;
    mount.dataset.autoplay = 'false';
    mount.dataset.allowfullscreen = 'true';
    mount.dataset.width = String(viewer.clientWidth);
    viewer.append(mount);
    loadApi('FB', 'fbAsyncInit', 'https://connect.facebook.net/en_US/sdk.js')
      .then((FB) => {
        if (failed) return;
        FB.init({
          version: 'v23.0',
          xfbml: false,
          status: false,
          cookie: false,
          autoLogAppEvents: false,
        });
        const loaded = (event) => {
          if (event.type !== 'video' || event.id !== mount.id) return;
          FB.Event.unsubscribe('xfbml.ready', loaded);
          const frame = viewer.querySelector('iframe');
          if (frame) {
            frame.title = 'SCMU live broadcast';
            frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
            frame.referrerPolicy = 'strict-origin-when-cross-origin';
          }
          event.instance.subscribe('startedPlaying', playing);
          event.instance.subscribe('paused', prompt);
          onReady(event.instance);
        };
        FB.Event.subscribe('xfbml.ready', loaded);
        FB.XFBML.parse(viewer);
      })
      .catch(fallback);
  }
}
