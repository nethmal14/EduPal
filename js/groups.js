import { createGroup, addMember, removeMember } from './db.js';
import { showToast } from './notifications.js';
import { CALLSIGNS } from './firebase-config.js';

let currentCallsign = null;
let onGroupCreatedCallback = null;

export function initGroups(callsign, onCreated) {
    currentCallsign = callsign;
    onGroupCreatedCallback = onCreated;
    document.getElementById('btn-new-group').addEventListener('click', openCreateGroupModal);
    document.getElementById('group-modal-close').addEventListener('click', closeGroupModal);
    document.getElementById('group-form').addEventListener('submit', handleCreateGroup);
    document.getElementById('group-modal-overlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('group-modal-overlay')) closeGroupModal();
    });
}

function openCreateGroupModal() {
    renderMemberCheckboxes();
    document.getElementById('group-modal-overlay').classList.add('active');
    document.getElementById('group-name-input').focus();
}

function closeGroupModal() {
    document.getElementById('group-modal-overlay').classList.remove('active');
    document.getElementById('group-form').reset();
}

function renderMemberCheckboxes() {
    const container = document.getElementById('member-checkboxes');
    container.innerHTML = '';
    CALLSIGNS.filter(cs => cs !== currentCallsign).forEach(cs => {
        const label = document.createElement('label');
        label.className = 'member-checkbox-item';
        label.innerHTML = `
      <input type="checkbox" value="${cs}" name="members">
      <span class="callsign-pill">${cs}</span>
    `;
        container.appendChild(label);
    });
}

async function handleCreateGroup(e) {
    e.preventDefault();
    const name = document.getElementById('group-name-input').value.trim();
    const topic = document.getElementById('group-topic-input').value.trim();
    const checked = [...document.querySelectorAll('#member-checkboxes input:checked')].map(el => el.value);

    if (!name) { showToast('Group name required', 'error'); return; }

    const btn = document.getElementById('create-group-btn');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
        const chatId = await createGroup(currentCallsign, name, topic, checked);
        closeGroupModal();
        showToast(`Group "${name}" created`, 'info');
        if (onGroupCreatedCallback) onGroupCreatedCallback(chatId);
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Group';
    }
}

// ─── Member management modal ─────────────────────────────────────────────────

export function openMembersModal(chat, callsign) {
    const modal = document.getElementById('members-modal-overlay');
    const list = document.getElementById('members-list');
    const addSection = document.getElementById('add-member-section');

    list.innerHTML = '';
    const isCreator = chat.createdBy === callsign.toLowerCase();

    Object.keys(chat.members || {}).forEach(member => {
        const item = document.createElement('div');
        item.className = 'member-item';
        item.innerHTML = `
      <span class="callsign-pill">${member.toUpperCase()}</span>
      ${member === chat.createdBy ? '<span class="creator-badge">creator</span>' : ''}
      ${isCreator && member !== callsign.toLowerCase() ? `<button class="btn-remove-member" data-member="${member}">Remove</button>` : ''}
    `;
        list.appendChild(item);
    });

    // Add member controls (creator only)
    if (isCreator && chat.type === 'group') {
        addSection.style.display = 'flex';
        const addableMembers = CALLSIGNS.filter(cs => !chat.members[cs.toLowerCase()]);
        const select = document.getElementById('add-member-select');
        select.innerHTML = '<option value="">Add member…</option>' +
            addableMembers.map(cs => `<option value="${cs}">${cs}</option>`).join('');

        document.getElementById('btn-add-member').onclick = async () => {
            const newMember = select.value;
            if (!newMember) return;
            try {
                await addMember(chat.id, callsign, newMember);
                showToast(`${newMember} added to group`, 'info');
                chat.members[newMember.toLowerCase()] = true;
                openMembersModal(chat, callsign); // re-render
            } catch (err) {
                showToast(err.message, 'error');
            }
        };
    } else {
        addSection.style.display = 'none';
    }

    // Remove member handlers
    list.querySelectorAll('.btn-remove-member').forEach(btn => {
        btn.addEventListener('click', async () => {
            const target = btn.dataset.member;
            try {
                await removeMember(chat.id, callsign, target);
                showToast(`${target.toUpperCase()} removed`, 'info');
                delete chat.members[target];
                openMembersModal(chat, callsign);
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    });

    document.getElementById('members-modal-close').onclick = () => modal.classList.remove('active');
    modal.classList.add('active');
}
