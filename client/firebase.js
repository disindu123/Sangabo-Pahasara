import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  browserSessionPersistence,
  setPersistence,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
let instance;
export async function initFirebase(config) {
  if (!config) throw new Error('SCMU staff login is being configured.');
  if (instance) return instance;
  const app = getApps()[0] || initializeApp(config),
    auth = getAuth(app);
  await setPersistence(auth, browserSessionPersistence);
  instance = { auth };
  return instance;
}
export { signInWithCustomToken, signOut, onAuthStateChanged };
