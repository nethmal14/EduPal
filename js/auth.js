import { firebaseConfig, CALLSIGNS, callsignToEmail } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    browserLocalPersistence,
    browserSessionPersistence,
    setPersistence
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getDatabase, ref, get, set } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

export { app, auth, db };

/**
 * Check if a callsign has already set a password (first-time login vs returning)
 */
export async function isFirstLogin(callsign) {
    const snap = await get(ref(db, `users/${callsign.toLowerCase()}/passwordSet`));
    return !snap.exists() || snap.val() === false;
}

/**
 * Register a new user (first login - set password)
 */
export async function register(callsign, password) {
    const email = callsignToEmail(callsign);
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // Write user profile to RTDB
    const profile = {
        displayName: callsign,
        callsign: callsign,
        uid: cred.user.uid,
        passwordSet: true,
        createdAt: Date.now()
    };
    await set(ref(db, `users/${callsign.toLowerCase()}`), profile);
    await set(ref(db, `profiles/${cred.user.uid}`), { callsign: callsign.toLowerCase() });
    return cred.user;
}

/**
 * Login existing user
 */
export async function login(callsign, password, remember = true) {
    const persistence = remember ? browserLocalPersistence : browserSessionPersistence;
    await setPersistence(auth, persistence);
    const email = callsignToEmail(callsign);
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
}

/**
 * Logout
 */
export async function logout() {
    await signOut(auth);
    window.location.href = '/index.html';
}

/**
 * Get current user's callsign from RTDB
 */
export async function getCurrentCallsign(uid) {
    for (const cs of CALLSIGNS) {
        const snap = await get(ref(db, `users/${cs.toLowerCase()}/uid`));
        if (snap.exists() && snap.val() === uid) return cs;
    }
    return null;
}

/**
 * Listen for auth state changes
 */
export function onAuth(callback) {
    return onAuthStateChanged(auth, callback);
}
