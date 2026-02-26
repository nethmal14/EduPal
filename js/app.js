import { onAuth, logout, getCurrentCallsign } from './auth.js';
import { subscribeToUserChats, createDM, setOnline as dbSetOnline, subscribeToPresence, setTyping, clearChat } from './db.js';
import { initChat, openChat, closeChat } from './chat.js';
import { initGroups, openMembersModal } from './groups.js';
import { setUnreadForChat, showToast, requestNotificationPermission, sendBrowserNotification } from './notifications.js';
import { CALLSIGNS } from './firebase-config.js';

let currentUser = null;
let currentCallsign = null;
let currentChatData = {};
let presenceData = {};
let unsubChats = null;

// ─── Boot ────────────────────────────────────────────────────────────────────

onAuth(async (user) => {
    console.log('[App] Auth state changed:', user ? `UID: ${user.uid}` : 'No user');
    if (!user) {
        if (!window.location.pathname.endsWith('index.html')) {
            console.log('[App] Redirecting to login...');
            window.location.href = '/index.html';
        }
        return;
    }
    currentUser = user;
    window._currentUid = user.uid;

    console.log('[App] Fetching callsign for user...');
    currentCallsign = await getCurrentCallsign(user.uid);
    if (!currentCallsign) {
        console.error('[App] User logged in but no callsign found. Possible missing registration data.');
        showToast('Error: Callsign not found. Try re-logging.', 'error');
        return;
    }

    console.log(`[App] Welcome, ${currentCallsign}. Updating UI...`);
    // Show callsign badge
    document.getElementById('user-callsign').textContent = currentCallsign;
    const avatar = document.getElementById('user-avatar');
    if (avatar) avatar.textContent = currentCallsign.slice(0, 2);

    // Set online presence
    dbSetOnline(user.uid, currentCallsign);

    // Update sub-modules
    initChat(currentCallsign);
    initGroups(currentCallsign, (chatId) => {
        console.log(`[App] Group created: ${chatId}`);
    });

    // Request notification permission
    await requestNotificationPermission();

    // Subscribe to sidebar chat list
    console.log('[App] Subscribing to user chats...');
    if (unsubChats) unsubChats();
    unsubChats = subscribeToUserChats(currentCallsign, (chats) => {
        console.log(`[App] Received ${chats.length} chats for sidebar.`);
        renderSidebar(chats);
    });

    // Subscribe to presence
    subscribeToPresence((presence) => {
        presenceData = presence;
        updatePresenceUI();
    });
});

function updatePresenceUI() {
    // 1. Update Sidebar Online Dots
    document.querySelectorAll('.chat-item').forEach(el => {
        const chatId = el.dataset.chatId;
        const chat = currentChatData[chatId];
        if (!chat) return;

        const dot = el.querySelector('.online-dot');
        if (!dot) return;

        let isOnline = false;
        if (chat.type === 'dm') {
            const otherCS = Object.keys(chat.members || {})
                .find(m => m !== currentCallsign.toLowerCase())?.toUpperCase();
            isOnline = Object.values(presenceData).some(p => p.callsign === otherCS && p.online);
        } else {
            // For groups, show online if anyone else is online
            isOnline = Object.values(presenceData).some(p =>
                p.online &&
                p.callsign !== currentCallsign &&
                chat.members[p.callsign.toLowerCase()]
            );
        }
        dot.classList.toggle('online', isOnline);
    });

    // 2. Update Typing Indicator in Active Chat
    const typingEl = document.getElementById('typing-indicator');
    if (typingEl && window._activeChatId) {
        const typers = Object.values(presenceData).filter(p =>
            p.typing === window._activeChatId &&
            p.callsign !== currentCallsign &&
            p.online // Only if they are online
        ).map(p => p.callsign);

        if (typers.length > 0) {
            typingEl.textContent = `${typers.join(', ')} ${typers.length > 1 ? 'are' : 'is'} typing...`;
            typingEl.style.opacity = 1;
        } else {
            typingEl.style.opacity = 0;
            // Clear text after fade
            setTimeout(() => { if (typingEl.style.opacity === '0') typingEl.textContent = ''; }, 300);
        }
    }
}
// ─── Event Listeners (Immediate) ──────────────────────────────────────────────

console.log('[App] Initializing UI listeners...');

// Logout button
const logoutBtn = document.getElementById('btn-logout');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        console.log('[App] Logout clicked');
        if (confirm('Sign out?')) await logout();
    });
}

// New DM button
const newDmBtn = document.getElementById('btn-new-dm');
if (newDmBtn) {
    newDmBtn.addEventListener('click', () => {
        console.log('[App] New DM clicked');
        if (!currentCallsign) return showToast('Waiting for session...', 'info');
        openNewDMModal();
    });
}

const dmCancel = document.getElementById('dm-modal-close');
if (dmCancel) {
    dmCancel.addEventListener('click', () =>
        document.getElementById('dm-modal-overlay').classList.remove('active'));
}

const dmOverlay = document.getElementById('dm-modal-overlay');
if (dmOverlay) {
    dmOverlay.addEventListener('click', (e) => {
        if (e.target === dmOverlay) dmOverlay.classList.remove('active');
    });
}

// Back button (mobile)
const backBtn = document.getElementById('btn-back');
if (backBtn) backBtn.addEventListener('click', closeChat);

// Members button
const membersBtn = document.getElementById('btn-members');
if (membersBtn) {
    membersBtn.addEventListener('click', () => {
        const id = window._activeChatId;
        if (id && currentChatData[id]) openMembersModal(currentChatData[id], currentCallsign);
    });
}

// ··· More options button
const moreBtn = document.getElementById('btn-more');
const moreDropdown = document.getElementById('topbar-dropdown');
if (moreBtn && moreDropdown) {
    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        moreDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => moreDropdown.classList.remove('open'));
}

// Clear chat button
const clearChatBtn = document.getElementById('btn-clear-chat');
if (clearChatBtn) {
    clearChatBtn.addEventListener('click', async () => {
        moreDropdown.classList.remove('open');
        const id = window._activeChatId;
        if (!id) return;
        if (!confirm('Clear all messages in this chat? This cannot be undone.')) return;
        try {
            await clearChat(id);
            showToast('Chat cleared', 'info');
        } catch (err) {
            showToast('Failed to clear chat: ' + err.message, 'error');
        }
    });
}


// Listen for openChat events (from notifications)
window.addEventListener('openChat', (e) => {
    const { chatId } = e.detail;
    if (currentChatData[chatId]) activateChat(chatId);
});

// Initialize sub-modules without callsign (will re-init in onAuth)
initChat(null);
initGroups(null, (chatId) => console.log(`[App] Group created: ${chatId}`));


// ─── Sidebar ─────────────────────────────────────────────────────────────────

const lastSeenTime = {}; // chatId -> timestamp

function renderSidebar(chats) {
    console.log('[App] Rendering sidebar...');
    const dmList = document.getElementById('dm-list');
    const groupList = document.getElementById('group-list');
    if (!dmList || !groupList) {
        console.error('[App] Critical UI elements missing: #dm-list or #group-list');
        return;
    }
    dmList.innerHTML = '';
    groupList.innerHTML = '';

    chats.forEach(chat => {
        const isNewMessage = chat.lastMessageTime &&
            (!lastSeenTime[chat.id] || chat.lastMessageTime > lastSeenTime[chat.id]);

        // Check if we should notify
        if (isNewMessage && chat.lastMessageFrom &&
            chat.lastMessageFrom.toLowerCase() !== currentCallsign.toLowerCase()) {

            const isNotActive = window._activeChatId !== chat.id;
            if (isNotActive) {
                showToast(`New message in ${chat.type === 'dm' ? chat.lastMessageFrom : chat.name}`, 'message');
                sendBrowserNotification(chat.lastMessageFrom, chat.lastMessage, chat.id);
            }
        }

        // Update tracking
        if (chat.lastMessageTime) lastSeenTime[chat.id] = chat.lastMessageTime;

        currentChatData[chat.id] = chat;

        const el = document.createElement('div');
        el.className = 'chat-item';
        el.dataset.chatId = chat.id;
        if (window._activeChatId === chat.id) el.classList.add('active');

        const unread = (chat.unread && chat.unread[currentCallsign.toLowerCase()]) || 0;
        const lastTime = chat.lastMessageTime
            ? formatSidebarTime(chat.lastMessageTime)
            : '';

        if (chat.type === 'dm') {
            const otherMember = Object.keys(chat.members || {})
                .find(m => m !== currentCallsign.toLowerCase());
            const otherCS = otherMember ? otherMember.toUpperCase() : '?';
            const isOnline = Object.values(presenceData).some(p => p.callsign === otherCS && p.online);

            el.innerHTML = `
        <div class="chat-item-avatar dm-avatar">
          ${otherCS.slice(0, 2)}
          <span class="online-dot ${isOnline ? 'online' : ''}"></span>
        </div>
        <div class="chat-item-info">
          <div class="chat-item-name">${otherCS}</div>
          <div class="chat-item-last">${escapeHtml(chat.lastMessage || 'No messages yet')}</div>
        </div>
        <div class="chat-item-meta">
          <div class="chat-item-time">${lastTime}</div>
          <div class="unread-badge" style="display:${unread > 0 ? 'flex' : 'none'}">${unread}</div>
        </div>
      `;
        } else {
            el.innerHTML = `
        <div class="chat-item-avatar group-avatar">#</div>
        <div class="chat-item-info">
          <div class="chat-item-name">${escapeHtml(chat.name)}</div>
          <div class="chat-item-last">${chat.topic ? `📌 ${escapeHtml(chat.topic)}` : escapeHtml(chat.lastMessage || 'No messages yet')}</div>
        </div>
        <div class="chat-item-meta">
          <div class="chat-item-time">${lastTime}</div>
          <div class="unread-badge" style="display:${unread > 0 ? 'flex' : 'none'}">${unread}</div>
        </div>
      `;
        }

        el.addEventListener('click', () => activateChat(chat.id));
        setUnreadForChat(chat.id, unread);

        if (chat.type === 'dm') dmList.appendChild(el);
        else groupList.appendChild(el);
    });
}

function activateChat(chatId) {
    window._activeChatId = chatId;
    const chat = currentChatData[chatId];
    if (!chat) return;

    // Update active state in sidebar
    document.querySelectorAll('.chat-item').forEach(el => {
        el.classList.toggle('active', el.dataset.chatId === chatId);
    });

    // Show/hide members button
    document.getElementById('btn-members').style.display =
        chat.type === 'group' ? 'flex' : 'none';

    openChat(chatId, chat.type === 'dm'
        ? Object.keys(chat.members).find(m => m !== currentCallsign.toLowerCase())?.toUpperCase() || chat.name
        : chat.name,
        chat.type,
        chat.members
    );
}

// ─── New DM Modal ─────────────────────────────────────────────────────────────

function openNewDMModal() {
    const list = document.getElementById('dm-callsign-list');
    list.innerHTML = '';
    CALLSIGNS.filter(cs => cs !== currentCallsign).forEach(cs => {
        const btn = document.createElement('button');
        btn.className = 'callsign-dm-btn';
        btn.textContent = cs;
        btn.addEventListener('click', async () => {
            document.getElementById('dm-modal-overlay').classList.remove('active');
            try {
                const chatId = await createDM(currentCallsign, cs);
                // Wait briefly for sidebar to update
                setTimeout(() => activateChat(chatId), 500);
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
        list.appendChild(btn);
    });
    document.getElementById('dm-modal-overlay').classList.add('active');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSidebarTime(ts) {
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
