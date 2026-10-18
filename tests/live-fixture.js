// Provider API doubles for local browser tests only. Never served by production.
export const liveSdkFixture = (facebook = false) => `
window.liveFixture = { commands: [], muted: false, blocked: false, hold: false };
const state = window.liveFixture;
function record(action) { state.commands.push({action, userActive:navigator.userActivation.isActive}); }
function blocked() { return window.blockLiveAutoplay && document.activeElement?.id !== 'live-play'; }
${
  facebook
    ? `
const handlers = {};
window.FB = {
  init() {},
  Event: {subscribe(name, fn) {handlers[name] = fn;}, unsubscribe(name) {delete handlers[name];}},
  XFBML: { parse(root) {
    const mount = root.querySelector('.fb-video');
    const frame = document.createElement('iframe');
    frame.title = 'SCMU live broadcast';
    frame.src = 'https://www.facebook.com/plugins/video.php?href='+encodeURIComponent(mount.dataset.href)+'&show_text=false&autoplay=false&mute=0';
    mount.append(frame);
    const callbacks = {};
    const player = {
      subscribe(name, fn) {callbacks[name] = fn;},
      unmute() {state.muted=false;record('unmute');},
      isMuted() {return state.muted;},
      play() {record('play');if(!blocked()) callbacks.startedPlaying?.();},
      pause() {callbacks.paused?.();}
    };
    state.pause = () => player.pause();
    state.ready = () => handlers['xfbml.ready']?.({type:'video',id:mount.id,instance:player});
    if(!window.holdLiveReady) queueMicrotask(state.ready);
  }}
};
window.fbAsyncInit?.();
`
    : `
window.YT = {Player:class {
  constructor(frame, {events}) {
    this.events=events;
    state.pause = () => events.onStateChange?.({data:2,target:this});
    state.ready = () => events.onReady({target:this});
    if(!window.holdLiveReady) queueMicrotask(state.ready);
  }
  unMute() {state.muted=false;record('unmute');}
  isMuted() {return state.muted;}
  playVideo() {record('play');if(blocked()) this.events.onAutoplayBlocked?.();else this.events.onStateChange?.({data:1,target:this});}
}};
window.onYouTubeIframeAPIReady?.();
`
}
`;
