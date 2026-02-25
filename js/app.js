import { onAuth, logout, getCurrentCallsign, setOnline } from './auth.js';
import { subscribeToUserChats, createDM, setOnline as dbSetOnline, subscribeToPresence, setTyping } from './db.js';
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
    if (!user) {
        window.location.href = '/index.html';
        return;
    }
    currentUser = user;
    window._currentUid = user.uid;

    currentCallsign = await getCurrentCallsign(user.uid);
    if (!currentCallsign) { await logout(); return; }

    // Show callsign badge
    document.getElementById('user-callsign').textContent = currentCallsign;
    document.getElementById('user-avatar').textContent = currentCallsign.slice(0, 2);

    // Set online presence
    dbSetOnline(user.uid, currentCallsign);

    // Init sub-modules
    initChat(currentCallsign);
    initGroups(currentCallsign, (chatId) => {
        // After group created, it'll appear via subscribeToUserChats
    });

    // Request notification permission
    await requestNotificationPermission();

    // Subscribe to sidebar chat list
    unsubChats = subscribeToUserChats(currentCallsign, renderSidebar);

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
// Logout button
document.getElementById('btn-logout').addEventListener('click', async () => {
    if (confirm('Sign out?')) await logout();
});

// New DM button
document.getElementById('btn-new-dm').addEventListener('click', openNewDMModal);
document.getElementById('dm-modal-close').addEventListener('click', () =>
    document.getElementById('dm-modal-overlay').classList.remove('active'));
document.getElementById('dm-modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('dm-modal-overlay'))
        document.getElementById('dm-modal-overlay').classList.remove('active');
});

// Back button (mobile)
document.getElementById('btn-back').addEventListener('click', closeChat);

// Members button
document.getElementById('btn-members').addEventListener('click', () => {
    const id = window._activeChatId;
    if (id && currentChatData[id]) openMembersModal(currentChatData[id], currentCallsign);
});

// Listen for openChat events (from notifications)
window.addEventListener('openChat', (e) => {
    const { chatId } = e.detail;
    if (currentChatData[chatId]) activateChat(chatId);
});
});

// ─── Sidebar ─────────────────────────────────────────────────────────────────

const lastSeenTime = {}; // chatId -> timestamp

function renderSidebar(chats) {
    const dmList = document.getElementById('dm-list');
    const groupList = document.getElementById('group-list');
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
