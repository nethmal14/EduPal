// ─── In-app notification & badge system ───────────────────────────────────────

let totalUnread = 0;
const chatUnread = {}; // chatId → count
const unsubscribers = [];

/** Update the browser tab title with total unread count */
function updateTabTitle() {
    const base = 'ECHO';
    document.title = totalUnread > 0 ? `(${totalUnread}) ${base}` : base;
}

/** Recalculate total unread across all chats */
export function setUnreadForChat(chatId, count) {
    const prev = chatUnread[chatId] || 0;
    chatUnread[chatId] = count;
    totalUnread = Math.max(0, totalUnread - prev + count);
    updateTabTitle();

    // Update sidebar badge
    const badge = document.querySelector(`[data-chat-id="${chatId}"] .unread-badge`);
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }
}

/** Show a toast notification */
export function showToast(message, type = 'info', duration = 3500) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
    <span class="toast-icon">${type === 'message' ? '💬' : type === 'error' ? '⚠️' : 'ℹ️'}</span>
    <span class="toast-text">${message}</span>
  `;
    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => toast.classList.add('toast-show'));

    setTimeout(() => {
        toast.classList.remove('toast-show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, duration);
}

/** Show browser notification (when page is not focused) */
export async function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
    }
}

export function sendBrowserNotification(from, text, chatId) {
    if (document.hasFocus()) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(`ECHO — ${from}`, {
        body: text.length > 80 ? text.slice(0, 80) + '…' : text,
        icon: '/icons/icon-192.png',
        tag: chatId,
        renotify: true
    });
    n.onclick = () => {
        window.focus();
        n.close();
        window.dispatchEvent(new CustomEvent('openChat', { detail: { chatId } }));
    };
}

export function getTotalUnread() { return totalUnread; }
export function getChatUnread(chatId) { return chatUnread[chatId] || 0; }
