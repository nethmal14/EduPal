import { db } from './auth.js';
import { showToast } from './notifications.js';
import {
    ref, push, set, get, update, onValue, off,
    serverTimestamp, query, orderByChild, limitToLast, onDisconnect
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// ─── Messaging ────────────────────────────────────────────────────────────────

export async function sendMessage(chatId, callsign, text, replyTo = null, mediaUrl = null) {
    const msgRef = push(ref(db, `chats/${chatId}/messages`));
    const timestamp = Date.now();

    await set(msgRef, {
        id: msgRef.key,
        from: callsign,
        text: text || '',
        mediaUrl: mediaUrl || null,
        replyTo: replyTo || null,
        reactions: {},
        readBy: { [callsign.toLowerCase()]: true },
        timestamp: timestamp
    });

    // Get chat members to increment their unread counts
    const chatSnap = await get(ref(db, `chats/${chatId}`));
    const chat = chatSnap.val();
    const members = chat.members || {};

    const updates = {
        [`chats/${chatId}/lastMessage`]: text || '📎 Media',
        [`chats/${chatId}/lastMessageFrom`]: callsign,
        [`chats/${chatId}/lastMessageTime`]: timestamp
    };

    // Increment unread for everyone but the sender
    Object.keys(members).forEach(m => {
        if (m !== callsign.toLowerCase()) {
            const currentUnread = (chat.unread && chat.unread[m]) || 0;
            updates[`chats/${chatId}/unread/${m}`] = currentUnread + 1;
        }
    });

    await update(ref(db), updates);
    return msgRef.key;
}

export function subscribeToMessages(chatId, callback, limit = 60) {
    const msgsRef = query(
        ref(db, `chats/${chatId}/messages`),
        orderByChild('timestamp'),
        limitToLast(limit)
    );
    onValue(msgsRef, (snap) => {
        const messages = [];
        snap.forEach((child) => messages.push(child.val()));
        callback(messages);
    });
    return () => off(msgsRef);
}

export async function markRead(chatId, callsign) {
    const msgsSnap = await get(query(
        ref(db, `chats/${chatId}/messages`),
        orderByChild('timestamp'),
        limitToLast(50)
    ));
    const updates = {};
    msgsSnap.forEach((child) => {
        updates[`chats/${chatId}/messages/${child.key}/readBy/${callsign.toLowerCase()}`] = true;
    });
    if (Object.keys(updates).length) await update(ref(db), updates);
    // Clear unread counter
    await set(ref(db, `chats/${chatId}/unread/${callsign.toLowerCase()}`), 0);
}

export async function setReaction(chatId, msgId, callsign, emoji) {
    const reactionRef = ref(db, `chats/${chatId}/messages/${msgId}/reactions/${emoji}/${callsign.toLowerCase()}`);
    const snap = await get(reactionRef);
    if (snap.exists()) {
        await set(reactionRef, null); // toggle off
    } else {
        await set(reactionRef, true);
    }
}

export async function deleteMessage(chatId, msgId, callsign) {
    const msgRef = ref(db, `chats/${chatId}/messages/${msgId}`);
    const snap = await get(msgRef);
    if (snap.exists() && snap.val().from === callsign) {
        await update(msgRef, { text: '🗑 Message deleted', deleted: true, mediaUrl: null });
    }
}

// ─── Chats & Groups ────────────────────────────────────────────────────────────

export async function createGroup(callsign, name, topic, members = []) {
    const chatRef = push(ref(db, 'chats'));
    const memberMap = {};
    [...new Set([callsign.toLowerCase(), ...members.map(m => m.toLowerCase())])].forEach(m => {
        memberMap[m] = true;
    });
    await set(chatRef, {
        id: chatRef.key,
        type: 'group',
        name,
        topic: topic || '',
        createdBy: callsign.toLowerCase(),
        members: memberMap,
        createdAt: Date.now(),
        lastMessage: '',
        lastMessageTime: Date.now()
    });
    return chatRef.key;
}

export async function createDM(callsignA, callsignB) {
    // Check if DM already exists
    const chatsSnap = await get(ref(db, 'chats'));
    let existingId = null;
    chatsSnap.forEach((child) => {
        const chat = child.val();
        if (
            chat.type === 'dm' &&
            chat.members[callsignA.toLowerCase()] &&
            chat.members[callsignB.toLowerCase()]
        ) {
            existingId = child.key;
        }
    });
    if (existingId) return existingId;

    const chatRef = push(ref(db, 'chats'));
    await set(chatRef, {
        id: chatRef.key,
        type: 'dm',
        name: `${callsignA} ↔ ${callsignB}`,
        members: {
            [callsignA.toLowerCase()]: true,
            [callsignB.toLowerCase()]: true
        },
        createdBy: callsignA.toLowerCase(),
        createdAt: Date.now(),
        lastMessage: '',
        lastMessageTime: Date.now()
    });
    return chatRef.key;
}

export async function addMember(chatId, requesterCallsign, newCallsign) {
    const chatSnap = await get(ref(db, `chats/${chatId}/createdBy`));
    if (!chatSnap.exists() || chatSnap.val() !== requesterCallsign.toLowerCase()) {
        throw new Error('Only the group creator can add members.');
    }
    await set(ref(db, `chats/${chatId}/members/${newCallsign.toLowerCase()}`), true);
}

export async function removeMember(chatId, requesterCallsign, targetCallsign) {
    const chatSnap = await get(ref(db, `chats/${chatId}/createdBy`));
    if (!chatSnap.exists() || chatSnap.val() !== requesterCallsign.toLowerCase()) {
        throw new Error('Only the group creator can remove members.');
    }
    await set(ref(db, `chats/${chatId}/members/${targetCallsign.toLowerCase()}`), null);
}

export function subscribeToUserChats(callsign, callback) {
    console.log(`[DB] Subscribing to chats for ${callsign}...`);
    const chatsRef = ref(db, 'chats');
    onValue(chatsRef, (snap) => {
        const chats = [];
        if (!snap.exists()) {
            console.log('[DB] No chats found in database.');
        }
        snap.forEach((child) => {
            const chat = child.val();
            if (chat.members && chat.members[callsign.toLowerCase()]) {
                chats.push({ ...chat, id: child.key });
            }
        });
        console.log(`[DB] Found ${chats.length} relevant chats for ${callsign}.`);
        chats.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
        callback(chats);
    }, (error) => {
        console.error('[DB] Error subscribing to chats:', error.message);
        showToast('Database access denied. Check security rules.', 'error');
    });
    return () => off(chatsRef);
}

// ─── Presence / Typing ────────────────────────────────────────────────────────

export function setOnline(uid, callsign) {
    const presRef = ref(db, `presence/${uid}`);
    set(presRef, { online: true, callsign, lastSeen: Date.now() });
    onDisconnect(presRef).update({ online: false, lastSeen: Date.now() });
}

export function setTyping(uid, chatId) {
    update(ref(db, `presence/${uid}`), { typing: chatId });
    setTimeout(() => update(ref(db, `presence/${uid}`), { typing: null }), 3000);
}

export function subscribeToPresence(callback) {
    const presRef = ref(db, 'presence');
    onValue(presRef, (snap) => {
        const presence = {};
        snap.forEach(child => { presence[child.key] = child.val(); });
        callback(presence);
    });
    return () => off(presRef);
}

// ─── Unread Counts ─────────────────────────────────────────────────────────────

export async function incrementUnread(chatId, callsign) {
    const key = callsign.toLowerCase();
    const unreadRef = ref(db, `chats/${chatId}/unread/${key}`);
    const snap = await get(unreadRef);
    const current = snap.exists() ? snap.val() : 0;
    await set(unreadRef, current + 1);
}

export function subscribeToUnread(chatId, callsign, callback) {
    const unreadRef = ref(db, `chats/${chatId}/unread/${callsign.toLowerCase()}`);
    onValue(unreadRef, (snap) => callback(snap.val() || 0));
    return () => off(unreadRef);
}
