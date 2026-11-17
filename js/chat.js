// Support chat between customers and the shop.
// Admin > Messages: every conversation, filters (unread, needs reply, replied,
// resolved), search, and a reply box under the thread.
// Customer > Support: their conversations with the shop's replies, a reply box,
// and a form to start a new message.

let selectedAdminMessageId = null;
let selectedCustomerMessageId = null;
let adminChatFilter = 'all';
let customerChatFilter = 'all';
let customerChatRefreshTimer = null;

function escapeChatHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function chatInitials(name) {
    const words = String(name || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
    return ((words[0]?.[0] || '?') + (words[1]?.[0] || '')).toUpperCase();
}

function chatMessageTime(message) {
    return Date.parse(message?.updatedAt || message?.createdAt || '') || Date.parse(message?.date || '') || 0;
}

function formatChatTime(value, fallback = '') {
    const time = typeof value === 'number' ? value : Date.parse(value || '');
    if (!time) return fallback;
    const date = new Date(time);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

// All messages of a conversation in order: the customer's first message, then replies.
function getChatEntries(message) {
    const first = { sender: 'customer', message: message.message, time: Date.parse(message.createdAt || '') || 0, date: message.date };
    const replies = (Array.isArray(message.replies) ? message.replies : []).map(reply => ({
        sender: reply.sender === 'admin' ? 'admin' : 'customer',
        message: reply.message,
        time: Date.parse(reply.createdAt || '') || 0,
        date: reply.date
    }));
    return [first, ...replies];
}

function getLastChatEntry(message) {
    const entries = getChatEntries(message);
    return entries[entries.length - 1];
}

// The customer wrote last and nobody has answered yet.
function chatNeedsReply(message) {
    return message.status !== 'resolved' && getLastChatEntry(message).sender === 'customer';
}

function chatStatusLabel(message, forCustomer = false) {
    if (message.status === 'resolved') return ['resolved', 'Resolved'];
    if (chatNeedsReply(message)) return ['waiting', forCustomer ? 'Waiting for the shop' : 'Needs reply'];
    return ['replied', 'Replied'];
}

function renderChatBubbles(message, viewer) {
    const customerName = message.customerUsername || message.customerName || 'Customer';
    return getChatEntries(message).map(entry => {
        const mine = entry.sender === viewer;
        const author = entry.sender === 'admin' ? (viewer === 'admin' ? 'You' : 'KingPin shop') : (viewer === 'customer' ? 'You' : customerName);
        return `<div class="chat-bubble-row${mine ? ' is-mine' : ''}">
            <div class="chat-bubble${entry.sender === 'admin' ? ' is-shop' : ''}">
                <p>${escapeChatHtml(entry.message)}</p>
                <span class="chat-bubble-meta">${escapeChatHtml(author)} · ${escapeChatHtml(formatChatTime(entry.time, entry.date || ''))}</span>
            </div>
        </div>`;
    }).join('');
}

function renderChatFilters(containerId, filters, active, onSelect) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = filters.map(filter => `<button type="button" class="chat-filter${filter.id === active ? ' is-active' : ''}" aria-pressed="${filter.id === active}" data-chat-filter="${filter.id}">
        ${escapeChatHtml(filter.label)}${filter.count ? `<span>${filter.count}</span>` : ''}
    </button>`).join('');
    container.querySelectorAll('[data-chat-filter]').forEach(button => {
        button.addEventListener('click', () => onSelect(button.dataset.chatFilter));
    });
}

function openChatThread(shellId) {
    document.getElementById(shellId)?.classList.add('is-thread-open');
}

function closeChatThread(shellId) {
    document.getElementById(shellId)?.classList.remove('is-thread-open');
}

// Called after the messages are loaded again from the server.
function onCustomerServiceMessagesUpdated() {
    if (appData.currentRole === 'admin' && document.getElementById('messagesTab')?.style.display === 'block') {
        renderAdminMessagesList();
        if (selectedAdminMessageId && !isChatComposerBusy('adminReplyInput')) renderAdminMessageDetails(selectedAdminMessageId);
    }
    if (appData.currentRole === 'customer') {
        updateCustomerChatCount();
        if (document.getElementById('customerServiceSection')?.style.display === 'block') {
            renderCustomerChatList();
            if (selectedCustomerMessageId && !isChatComposerBusy('customerChatReplyInput')) renderCustomerChatThread(selectedCustomerMessageId);
        }
    }
}

// True while someone is typing a reply, so a refresh does not wipe it.
function isChatComposerBusy(inputId) {
    const input = document.getElementById(inputId);
    return Boolean(input && (input.value.trim() || document.activeElement === input));
}

// ===== Admin =====
async function loadAdminMessages() {
    const list = document.getElementById('adminMessagesList');
    if (!list) return;
    if (!appData.customerServiceMessages.length) list.innerHTML = '<p class="chat-list-empty">Loading conversations…</p>';
    try {
        await refreshCustomerServiceMessages();
        renderAdminMessagesList();
    } catch (error) {
        console.error('Unable to load shared customer-service messages:', error);
        list.innerHTML = '<p class="chat-list-empty is-error">Unable to load customer messages. Please try again.</p>';
    }
}

function getAdminChatCounts(messages) {
    return {
        all: messages.length,
        unread: messages.filter(message => !message.read).length,
        'needs-reply': messages.filter(chatNeedsReply).length,
        replied: messages.filter(message => message.status !== 'resolved' && !chatNeedsReply(message)).length,
        resolved: messages.filter(message => message.status === 'resolved').length
    };
}

function renderAdminMessagesList() {
    const list = document.getElementById('adminMessagesList');
    if (!list) return;
    const messages = (appData.customerServiceMessages || []).slice().sort((a, b) => chatMessageTime(b) - chatMessageTime(a));
    const counts = getAdminChatCounts(messages);
    renderChatFilters('adminChatFilters', [
        { id: 'all', label: 'All', count: 0 },
        { id: 'unread', label: 'Unread', count: counts.unread },
        { id: 'needs-reply', label: 'Needs reply', count: counts['needs-reply'] },
        { id: 'replied', label: 'Replied', count: 0 },
        { id: 'resolved', label: 'Resolved', count: 0 }
    ], adminChatFilter, filter => { adminChatFilter = filter; renderAdminMessagesList(); });

    const query = String(document.getElementById('adminChatSearch')?.value || '').trim().toLowerCase();
    const visible = messages.filter(message => {
        if (adminChatFilter === 'unread' && message.read) return false;
        if (adminChatFilter === 'needs-reply' && !chatNeedsReply(message)) return false;
        if (adminChatFilter === 'replied' && (message.status === 'resolved' || chatNeedsReply(message))) return false;
        if (adminChatFilter === 'resolved' && message.status !== 'resolved') return false;
        if (!query) return true;
        return [message.customerUsername, message.customerName, message.customerEmail, message.subject, message.orderId, message.message]
            .some(value => String(value || '').toLowerCase().includes(query));
    });

    if (!messages.length) {
        list.innerHTML = '<p class="chat-list-empty">No customer messages yet.</p>';
        return;
    }
    if (!visible.length) {
        list.innerHTML = '<p class="chat-list-empty">No conversations match this filter.</p>';
        return;
    }
    list.innerHTML = visible.map(message => {
        const name = message.customerUsername || message.customerName || 'Customer';
        const last = getLastChatEntry(message);
        const [statusClass, statusText] = chatStatusLabel(message);
        return `<button type="button" class="chat-list-item${message.read ? '' : ' is-unread'}${String(message.id) === String(selectedAdminMessageId) ? ' is-active' : ''}" data-message-id="${escapeChatHtml(message.id)}">
            <span class="chat-avatar" aria-hidden="true">${escapeChatHtml(chatInitials(name))}</span>
            <span class="chat-list-copy">
                <span class="chat-list-top"><strong>${escapeChatHtml(name)}</strong><small>${escapeChatHtml(formatChatTime(chatMessageTime(message), message.date || ''))}</small></span>
                <span class="chat-list-subject">${escapeChatHtml(message.subject || 'Customer concern')}${message.orderId ? ` · #${escapeChatHtml(message.orderId)}` : ''}</span>
                <span class="chat-list-preview">${last.sender === 'admin' ? 'You: ' : ''}${escapeChatHtml(last.message)}</span>
                <span class="chat-status chat-status-${statusClass}">${escapeChatHtml(statusText)}</span>
            </span>
            ${message.read ? '' : '<span class="chat-unread-dot" aria-label="Unread"></span>'}
        </button>`;
    }).join('');
    list.querySelectorAll('[data-message-id]').forEach(button => {
        button.addEventListener('click', () => selectAdminMessage(button.dataset.messageId));
    });
}

function renderAdminMessageDetails(messageId) {
    const message = appData.customerServiceMessages.find(item => String(item.id) === String(messageId));
    const details = document.getElementById('adminMessageDetails');
    if (!message || !details) return;
    const name = message.customerUsername || message.customerName || 'Customer';
    const [statusClass, statusText] = chatStatusLabel(message);
    const resolved = message.status === 'resolved';
    details.innerHTML = `
        <div class="chat-thread-head">
            <button type="button" class="chat-back" onclick="closeChatThread('adminChatShell')" aria-label="Back to conversations">‹</button>
            <span class="chat-avatar" aria-hidden="true">${escapeChatHtml(chatInitials(name))}</span>
            <div>
                <h3>${escapeChatHtml(message.subject || 'Customer concern')}</h3>
                <p>${escapeChatHtml(name)} · ${escapeChatHtml(message.customerEmail || 'No email')}${message.orderId ? ` · <button type="button" class="chat-order-link" onclick="viewOrderDetails(${Number(message.orderId) || `'${escapeChatHtml(message.orderId)}'`})">Order #${escapeChatHtml(message.orderId)}</button>` : ' · General concern'}</p>
            </div>
            <span class="chat-status chat-status-${statusClass}">${escapeChatHtml(statusText)}</span>
            <button type="button" class="btn btn-secondary btn-small chat-resolve" onclick="setAdminChatStatus('${escapeChatHtml(message.id)}', '${resolved ? 'open' : 'resolved'}')">${resolved ? 'Reopen' : 'Mark resolved'}</button>
        </div>
        <div class="chat-messages" id="adminChatMessages">${renderChatBubbles(message, 'admin')}</div>
        <form class="chat-composer" onsubmit="event.preventDefault(); sendAdminMessageReply('${escapeChatHtml(message.id)}')">
            <label for="adminReplyInput" class="chat-sr-only">Reply to ${escapeChatHtml(name)}</label>
            <textarea id="adminReplyInput" rows="2" maxlength="5000" placeholder="Write a reply to ${escapeChatHtml(name)}…" onkeydown="if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) this.form.requestSubmit()"></textarea>
            <button type="submit" class="btn btn-primary">Send</button>
        </form>
        <p id="adminChatError" class="status-message error" role="alert" hidden></p>`;
    const thread = document.getElementById('adminChatMessages');
    if (thread) thread.scrollTop = thread.scrollHeight;
}

function selectAdminMessage(messageId) {
    selectedAdminMessageId = String(messageId);
    renderAdminMessageDetails(selectedAdminMessageId);
    renderAdminMessagesList();
    openChatThread('adminChatShell');
    const message = appData.customerServiceMessages.find(item => String(item.id) === selectedAdminMessageId);
    if (message && !message.read) {
        markCustomerMessageAsRead(selectedAdminMessageId).catch(error => {
            console.error('Unable to mark customer message as read:', error);
        });
    }
}

function replaceChatMessage(updated) {
    const index = appData.customerServiceMessages.findIndex(item => String(item.id) === String(updated.id));
    if (index >= 0) appData.customerServiceMessages[index] = updated;
    else appData.customerServiceMessages.unshift(updated);
}

async function sendAdminMessageReply(messageId) {
    const input = document.getElementById('adminReplyInput');
    const replyText = input ? input.value.trim() : '';
    if (!replyText) return;
    const button = input.form?.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
        const result = await callCustomerServiceApi({ action: 'reply', messageId, message: replyText });
        replaceChatMessage(result.message);
        input.value = '';
        renderAdminMessagesList();
        renderAdminMessageDetails(messageId);
        updateNotificationBadges();
    } catch (error) {
        console.error('Unable to send customer-service reply:', error);
        const errorBox = document.getElementById('adminChatError');
        if (errorBox) {
            errorBox.textContent = `Reply was not sent: ${error.message}`;
            errorBox.hidden = false;
        }
    } finally {
        if (button) button.disabled = false;
    }
}

async function setAdminChatStatus(messageId, status) {
    try {
        const result = await callCustomerServiceApi({ action: 'status', messageId, status });
        replaceChatMessage(result.message);
        renderAdminMessagesList();
        renderAdminMessageDetails(messageId);
        updateNotificationBadges();
    } catch (error) {
        showStatusUpdateToast(error.message);
    }
}

async function markCustomerMessageAsRead(messageId) {
    const result = await callCustomerServiceApi({ action: 'read', messageId });
    replaceChatMessage(result.message);
    renderAdminMessagesList();
    updateNotificationBadges();
}

// ===== Customer =====
function viewCustomerService() {
    if (requireCustomerLogin('support')) return;
    setCustomerActiveView('customerServiceSection');
    saveNavigationState('customer', 'viewCustomerService');
    updateFloatingBackButton();
    fillCustomerChatOrderOptions();
    renderCustomerChatList();
    const messages = appData.customerServiceMessages || [];
    if (selectedCustomerMessageId && messages.some(message => String(message.id) === String(selectedCustomerMessageId))) {
        renderCustomerChatThread(selectedCustomerMessageId);
    } else if (messages.length && window.innerWidth > 900) {
        selectCustomerChat(messages.slice().sort((a, b) => chatMessageTime(b) - chatMessageTime(a))[0].id);
    } else {
        openCustomerChatComposer(false, !messages.length);
    }
    refreshCustomerServiceMessages().catch(error => console.warn('Unable to load your messages:', error));
    if (customerChatRefreshTimer === null) {
        customerChatRefreshTimer = setInterval(() => {
            if (appData.currentRole === 'customer' && document.visibilityState !== 'hidden') {
                refreshCustomerServiceMessages().catch(() => {});
            }
        }, 15000);
    }
}

function fillCustomerChatOrderOptions() {
    const orderSelect = document.getElementById('serviceOrderId');
    if (!orderSelect) return;
    const current = orderSelect.value;
    const email = normalizeCustomerEmail(appData.currentUser);
    orderSelect.innerHTML = '<option value="">General concern</option>';
    appData.orders
        .filter(order => normalizeCustomerEmail(order.customerEmail) === email || order.customerUsername === appData.currentUser)
        .sort((first, second) => Number(second.id) - Number(first.id))
        .forEach(order => {
            orderSelect.insertAdjacentHTML('beforeend', `<option value="${escapeChatHtml(order.id)}">Order #${escapeChatHtml(order.id)}</option>`);
        });
    orderSelect.value = current;
}

function updateCustomerChatCount() {
    const unread = (appData.customerServiceMessages || []).filter(message => message.customerUnread).length;
    document.querySelectorAll('[data-account-count="support"]').forEach(badge => {
        badge.textContent = String(unread);
        badge.hidden = unread === 0;
    });
}

function renderCustomerChatList() {
    const list = document.getElementById('customerChatList');
    if (!list) return;
    const messages = (appData.customerServiceMessages || []).slice().sort((a, b) => chatMessageTime(b) - chatMessageTime(a));
    const unread = messages.filter(message => message.customerUnread).length;
    renderChatFilters('customerChatFilters', [
        { id: 'all', label: 'All', count: 0 },
        { id: 'unread', label: 'New replies', count: unread },
        { id: 'open', label: 'Open', count: 0 },
        { id: 'resolved', label: 'Resolved', count: 0 }
    ], customerChatFilter, filter => { customerChatFilter = filter; renderCustomerChatList(); });
    const visible = messages.filter(message => {
        if (customerChatFilter === 'unread') return message.customerUnread;
        if (customerChatFilter === 'open') return message.status !== 'resolved';
        if (customerChatFilter === 'resolved') return message.status === 'resolved';
        return true;
    });
    if (!messages.length) {
        list.innerHTML = '<p class="chat-list-empty">No messages yet. Start one with “New message”.</p>';
        return;
    }
    if (!visible.length) {
        list.innerHTML = '<p class="chat-list-empty">No conversations match this filter.</p>';
        return;
    }
    list.innerHTML = visible.map(message => {
        const last = getLastChatEntry(message);
        const [statusClass, statusText] = chatStatusLabel(message, true);
        return `<button type="button" class="chat-list-item${message.customerUnread ? ' is-unread' : ''}${String(message.id) === String(selectedCustomerMessageId) ? ' is-active' : ''}" data-message-id="${escapeChatHtml(message.id)}">
            <span class="chat-avatar is-shop" aria-hidden="true">KP</span>
            <span class="chat-list-copy">
                <span class="chat-list-top"><strong>${escapeChatHtml(message.subject || 'Message')}</strong><small>${escapeChatHtml(formatChatTime(chatMessageTime(message), message.date || ''))}</small></span>
                <span class="chat-list-subject">${message.orderId ? `Order #${escapeChatHtml(message.orderId)}` : 'General concern'}</span>
                <span class="chat-list-preview">${last.sender === 'customer' ? 'You: ' : 'Shop: '}${escapeChatHtml(last.message)}</span>
                <span class="chat-status chat-status-${statusClass}">${escapeChatHtml(statusText)}</span>
            </span>
            ${message.customerUnread ? '<span class="chat-unread-dot" aria-label="New reply"></span>' : ''}
        </button>`;
    }).join('');
    list.querySelectorAll('[data-message-id]').forEach(button => {
        button.addEventListener('click', () => selectCustomerChat(button.dataset.messageId));
    });
}

function selectCustomerChat(messageId) {
    selectedCustomerMessageId = String(messageId);
    renderCustomerChatThread(selectedCustomerMessageId);
    renderCustomerChatList();
    openChatThread('customerChatShell');
    const message = appData.customerServiceMessages.find(item => String(item.id) === selectedCustomerMessageId);
    if (message?.customerUnread) {
        message.customerUnread = false;
        updateCustomerChatCount();
        renderCustomerChatList();
        callCustomerServiceApi({ action: 'customer-seen', messageId: message.id }).catch(error => console.warn('Could not mark the reply as seen:', error));
    }
}

function renderCustomerChatThread(messageId) {
    const message = appData.customerServiceMessages.find(item => String(item.id) === String(messageId));
    const thread = document.getElementById('customerChatThread');
    const form = document.getElementById('customerServiceForm');
    if (!message || !thread) return;
    const [statusClass, statusText] = chatStatusLabel(message, true);
    form.hidden = true;
    thread.hidden = false;
    thread.innerHTML = `
        <div class="chat-thread-head">
            <button type="button" class="chat-back" onclick="closeChatThread('customerChatShell')" aria-label="Back to conversations">‹</button>
            <span class="chat-avatar is-shop" aria-hidden="true">KP</span>
            <div>
                <h3>${escapeChatHtml(message.subject || 'Message')}</h3>
                <p>${message.orderId ? `Order #${escapeChatHtml(message.orderId)}` : 'General concern'} · started ${escapeChatHtml(formatChatTime(Date.parse(message.createdAt || '') || 0, message.date || ''))}</p>
            </div>
            <span class="chat-status chat-status-${statusClass}">${escapeChatHtml(statusText)}</span>
        </div>
        <div class="chat-messages" id="customerChatMessages">${renderChatBubbles(message, 'customer')}</div>
        <form class="chat-composer" onsubmit="event.preventDefault(); sendCustomerChatReply('${escapeChatHtml(message.id)}')">
            <label for="customerChatReplyInput" class="chat-sr-only">Write to the shop</label>
            <textarea id="customerChatReplyInput" rows="2" maxlength="5000" placeholder="${message.status === 'resolved' ? 'This was marked resolved. Write here to reopen it…' : 'Write a message…'}" onkeydown="if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) this.form.requestSubmit()"></textarea>
            <button type="submit" class="btn btn-primary">Send</button>
        </form>
        <p id="customerChatError" class="status-message error" role="alert" hidden></p>`;
    const messagesBox = document.getElementById('customerChatMessages');
    if (messagesBox) messagesBox.scrollTop = messagesBox.scrollHeight;
}

function openCustomerChatComposer(focus = true, open = focus) {
    selectedCustomerMessageId = null;
    const thread = document.getElementById('customerChatThread');
    const form = document.getElementById('customerServiceForm');
    if (thread) thread.hidden = true;
    if (form) form.hidden = false;
    document.getElementById('customerServiceStatus').textContent = '';
    renderCustomerChatList();
    if (open) openChatThread('customerChatShell');
    if (focus) document.getElementById('serviceSubject')?.focus();
}

async function sendCustomerChatReply(messageId) {
    const input = document.getElementById('customerChatReplyInput');
    const text = input ? input.value.trim() : '';
    if (!text) return;
    const button = input.form?.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
        const result = await callCustomerServiceApi({ action: 'customer-reply', messageId, message: text });
        replaceChatMessage(result.message);
        input.value = '';
        renderCustomerChatThread(messageId);
        renderCustomerChatList();
    } catch (error) {
        const errorBox = document.getElementById('customerChatError');
        if (errorBox) {
            errorBox.textContent = `Message was not sent: ${error.message}`;
            errorBox.hidden = false;
        }
    } finally {
        if (button) button.disabled = false;
    }
}

async function sendCustomerServiceMessage(event) {
    event.preventDefault();
    const subject = document.getElementById('serviceSubject').value;
    const message = document.getElementById('serviceMessage').value.trim();
    const orderId = document.getElementById('serviceOrderId').value || null;
    if (!subject || !message) return;

    const status = document.getElementById('customerServiceStatus');
    status.className = 'status-message';
    status.textContent = 'Sending your message...';
    const submitButton = document.querySelector('#customerServiceForm button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
        const result = await callCustomerServiceApi({
            action: 'create',
            customerName: appData.currentUserProfile?.fullName || appData.currentUserProfile?.username || appData.currentUser,
            orderId,
            subject,
            message
        });
        document.getElementById('customerServiceForm').reset();
        status.textContent = '';
        if (result.message) {
            replaceChatMessage(result.message);
            selectCustomerChat(result.message.id);
        }
        showStatusUpdateToast('Message sent. The shop will reply here in Support.');
    } catch (error) {
        console.error('Unable to send customer-service message:', error);
        status.className = 'status-message error';
        status.textContent = `Message was not sent: ${error.message}`;
    } finally {
        if (submitButton) submitButton.disabled = false;
    }
}

// Customers see a count on Support when the shop replies, even on other pages.
setInterval(() => {
    if (appData?.currentRole === 'customer' && document.visibilityState !== 'hidden'
        && document.getElementById('customerServiceSection')?.style.display !== 'block') {
        refreshCustomerServiceMessages().catch(() => {});
    }
}, 30000);
window.addEventListener('load', () => {
    setTimeout(() => {
        if (appData?.currentRole === 'customer') refreshCustomerServiceMessages().catch(() => {});
    }, 2500);
});
