import { firebaseConfig, CALLSIGNS, callsignToEmail } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js';
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
let analytics = null;
try {
    analytics = getAnalytics(app);
    console.log('[Auth] Analytics initialized.');
} catch (e) {
    console.warn('[Auth] Analytics failed to initialize (likely blocked):', e.message);
}
const auth = getAuth(app);
const db = getDatabase(app);

export { app, auth, db, analytics };

/**
 * Check if a callsign has already set a password (first-time login vs returning)
 */
export async function isFirstLogin(callsign) {
    console.log(`[Auth] Checking if callsign "${callsign}" is first login...`);
    try {
        const snap = await get(ref(db, `users/${callsign.toLowerCase()}/passwordSet`));
        const first = !snap.exists() || snap.val() === false;
        console.log(`[Auth] First login for ${callsign}:`, first);
        return first;
    } catch (e) {
        console.error(`[Auth] Error in isFirstLogin for ${callsign}:`, e);
        return true; // Show create-password on genuine read failures
    }
}

/**
 * Register a new user (first login - set password)
 */
export async function register(callsign, password) {
    console.log(`[Auth] Starting registration for ${callsign}...`);
    const email = callsignToEmail(callsign);
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    console.log(`[Auth] Firebase account created:`, cred.user.uid);

    // Write user profile to RTDB
    const profile = {
        displayName: callsign,
        callsign: callsign,
        uid: cred.user.uid,
        passwordSet: true,
        createdAt: Date.now()
    };

    console.log(`[Auth] Writing profile to RTDB...`);
    await set(ref(db, `users/${callsign.toLowerCase()}`), profile);
    await set(ref(db, `profiles/${cred.user.uid}`), { callsign: callsign.toLowerCase() });
    console.log(`[Auth] Registration complete.`);
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
    console.log(`[Auth] Looking up callsign for UID: ${uid}...`);
    // 1. Try profiles node (fast/secure)
    try {
        const profileSnap = await get(ref(db, `profiles/${uid}/callsign`));
        if (profileSnap.exists()) {
            const cs = profileSnap.val().toUpperCase();
            console.log(`[Auth] Callsign found in profiles: ${cs}`);
            return cs;
        }
    } catch (e) {
        console.warn(`[Auth] Could not read profiles node:`, e.message);
    }

    // 2. Fallback: Search users node
    console.log(`[Auth] Falling back to users node search...`);
    for (const cs of CALLSIGNS) {
        try {
            const snap = await get(ref(db, `users/${cs.toLowerCase()}/uid`));
            if (snap.exists() && snap.val() === uid) {
                console.log(`[Auth] Callsign found via users search: ${cs}`);
                return cs;
            }
        } catch (e) {
            console.warn(`[Auth] Could not read user node for ${cs}:`, e.message);
        }
    }

    console.error(`[Auth] No callsign found for UID: ${uid}`);
    return null;
}

/**
 * Listen for auth state changes
 */
export function onAuth(callback) {
    return onAuthStateChanged(auth, callback);
}
