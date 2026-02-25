import {
    subscribeToMessages, sendMessage, setReaction,
    deleteMessage, markRead, setTyping
} from './db.js';
import { showToast, sendBrowserNotification } from './notifications.js';

let currentChatId = null;
let currentCallsign = null;
let unsubscribeMessages = null;
let replyingTo = null;

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '✅'];

let initialized = false;

export function initChat(callsign) {
    if (callsign) {
        console.log(`[Chat] Initializing with callsign: ${callsign}`);
        currentCallsign = callsign;
    }

    if (initialized) return;
    initialized = true;

    console.log('[Chat] Attaching UI listeners...');
    const msgInput = document.getElementById('msg-input');
    if (msgInput) {
        msgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            } else {
                if (window._currentUid && currentChatId) {
                    setTyping(window._currentUid, currentChatId);
                }
            }
        });
        msgInput.addEventListener('input', autoResize);
    }

    const sendBtn = document.getElementById('btn-send');
    if (sendBtn) sendBtn.addEventListener('click', handleSend);

    const cancelReplyBtn = document.getElementById('cancel-reply');
    if (cancelReplyBtn) cancelReplyBtn.addEventListener('click', clearReply);
}

export function openChat(chatId, chatName, chatType, members) {
    if (currentChatId === chatId) return;

    // Unsubscribe from previous chat
    if (unsubscribeMessages) unsubscribeMessages();
    currentChatId = chatId;

    document.getElementById('chat-title').textContent = chatName;
    document.getElementById('chat-subtitle').textContent =
        chatType === 'dm' ? 'Direct Message' : `${Object.keys(members || {}).length} members`;
    document.getElementById('chat-placeholder').style.display = 'none';
    document.getElementById('chat-main').style.display = 'flex';

    document.getElementById('messages-list').innerHTML = `
    <div class="messages-loader">Loading messages…</div>
  `;

    // Mark read
    markRead(chatId, currentCallsign);

    // Subscribe
    unsubscribeMessages = subscribeToMessages(chatId, (messages) => {
        renderMessages(messages, members);
        markRead(chatId, currentCallsign);
    });

    // Mobile: show chat pane
    document.getElementById('app-shell').classList.add('chat-open');
}

function renderMessages(messages, members) {
    const list = document.getElementById('messages-list');
    const wasAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;

    list.innerHTML = '';

    if (!messages.length) {
        list.innerHTML = '<div class="no-messages">No messages yet. Say hello! 👋</div>';
        return;
    }

    let lastDate = null;
    messages.forEach((msg) => {
        const date = new Date(msg.timestamp).toDateString();
        if (date !== lastDate) {
            const sep = document.createElement('div');
            sep.className = 'date-separator';
            sep.textContent = date === new Date().toDateString() ? 'Today' : date;
            list.appendChild(sep);
            lastDate = date;
        }
        list.appendChild(buildMessageEl(msg, members));
    });

    if (wasAtBottom || messages.length < 5) {
        list.scrollTop = list.scrollHeight;
    }
}

function buildMessageEl(msg, members) {
    const isMine = msg.from.toLowerCase() === currentCallsign.toLowerCase();
    const el = document.createElement('div');
    el.className = `message-row ${isMine ? 'mine' : 'theirs'}`;
    el.dataset.msgId = msg.id;

    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const readBy = msg.readBy ? Object.keys(msg.readBy) : [];
    const readCount = readBy.filter(r => r !== msg.from.toLowerCase()).length;

    // Reactions
    const reactionsHtml = buildReactionsHtml(msg.reactions || {});

    // Reply preview
    const replyHtml = msg.replyTo
        ? `<div class="reply-preview-bubble" data-reply-id="${msg.replyTo}">↩ Replying to message</div>`
        : '';

    el.innerHTML = `
    ${!isMine ? `<div class="msg-avatar">${msg.from.toUpperCase().slice(0, 2)}</div>` : ''}
    <div class="message-bubble ${msg.deleted ? 'deleted' : ''}">
      ${!isMine ? `<div class="msg-sender">${msg.from.toUpperCase()}</div>` : ''}
      ${replyHtml}
      <div class="msg-text">${escapeHtml(msg.text || '')}</div>
      ${msg.mediaUrl ? `<a class="msg-media" href="${msg.mediaUrl}" target="_blank">📎 Attachment</a>` : ''}
      <div class="msg-meta">
        <span class="msg-time">${time}</span>
        ${isMine ? `<span class="msg-read">${readCount > 0 ? '✓✓' : '✓'}</span>` : ''}
      </div>
      ${reactionsHtml}
    </div>
    <div class="msg-actions">
      <button class="msg-action-btn" data-action="reply" title="Reply">↩</button>
      <button class="msg-action-btn" data-action="react" title="React">😊</button>
      ${isMine && !msg.deleted ? `<button class="msg-action-btn danger" data-action="delete" title="Delete">🗑</button>` : ''}
    </div>
  `;

    // Action handlers
    el.querySelector('[data-action="reply"]').addEventListener('click', () => setReplyTo(msg));
    el.querySelector('[data-action="react"]').addEventListener('click', (e) => showEmojiPicker(e, msg.id));
    if (isMine && !msg.deleted) {
        el.querySelector('[data-action="delete"]').addEventListener('click', () => {
            if (confirm('Delete this message?')) deleteMessage(currentChatId, msg.id, currentCallsign);
        });
    }

    return el;
}

function buildReactionsHtml(reactions) {
    if (!Object.keys(reactions).length) return '';
    const counts = {};
    Object.entries(reactions).forEach(([emoji, users]) => {
        const count = Object.keys(users).length;
        if (count > 0) counts[emoji] = { count, mine: users[currentCallsign.toLowerCase()] };
    });
    if (!Object.keys(counts).length) return '';
    const pills = Object.entries(counts).map(([emoji, { count, mine }]) =>
        `<button class="reaction-pill ${mine ? 'mine' : ''}" data-emoji="${emoji}">${emoji} ${count}</button>`
    ).join('');
    return `<div class="reactions-row">${pills}</div>`;
}

function showEmojiPicker(e, msgId) {
    // Remove existing picker
    document.querySelectorAll('.emoji-picker').forEach(p => p.remove());

    const picker = document.createElement('div');
    picker.className = 'emoji-picker';
    picker.innerHTML = EMOJIS.map(em =>
        `<button class="emoji-option" data-emoji="${em}">${em}</button>`
    ).join('');

    picker.querySelectorAll('.emoji-option').forEach(btn => {
        btn.addEventListener('click', () => {
            setReaction(currentChatId, msgId, currentCallsign, btn.dataset.emoji);
            picker.remove();
        });
    });

    document.body.appendChild(picker);
    const rect = e.target.getBoundingClientRect();
    picker.style.top = `${rect.top + window.scrollY - picker.offsetHeight - 8}px`;
    picker.style.left = `${rect.left + window.scrollX}px`;

    const closeOnClick = (ev) => {
        if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('click', closeOnClick); }
    };
    setTimeout(() => document.addEventListener('click', closeOnClick), 0);
}

function setReplyTo(msg) {
    replyingTo = msg;
    document.getElementById('reply-bar').style.display = 'flex';
    document.getElementById('reply-bar-text').textContent =
        `↩ ${msg.from.toUpperCase()}: ${(msg.text || '').slice(0, 50)}`;
    document.getElementById('msg-input').focus();
}

function clearReply() {
    replyingTo = null;
    document.getElementById('reply-bar').style.display = 'none';
}

async function handleSend() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !currentChatId) return;

    input.value = '';
    input.style.height = 'auto';
    clearReply();

    try {
        await sendMessage(currentChatId, currentCallsign, text, replyingTo?.id || null);
    } catch (err) {
        showToast('Failed to send: ' + err.message, 'error');
    }
}

function autoResize() {
    const el = document.getElementById('msg-input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/\n/g, '<br>');
}

export function closeChat() {
    if (unsubscribeMessages) unsubscribeMessages();
    currentChatId = null;
    document.getElementById('app-shell').classList.remove('chat-open');
}
