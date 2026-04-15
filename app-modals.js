// Deal and client modal workflows split out of app.js.

// Voice note state
var _voiceMediaRecorder = null;
var _voiceChunks = [];
var _voiceBlob = null;
var _voiceTimerInterval = null;
var _voiceSeconds = 0;
var _voiceRecording = false;

function _dealModalSetClientMode(isNew) {
  document.getElementById('deal-modal-client').classList.toggle('hidden', isNew);
  document.getElementById('deal-modal-client-select').classList.toggle('hidden', !isNew);
}

function _populateClientSelect() {
  var sel = document.getElementById('deal-modal-client-select');
  sel.innerHTML = '<option value="">\u2014 Select client \u2014</option>';
  Object.values(_leadsById).filter(function(l) { return !_isDeleted(l); }).sort(function(a, b) { return (a.display_name || a.name || '').localeCompare(b.display_name || b.name || ''); }).forEach(function(lead) {
    var opt = document.createElement('option');
    opt.value = lead.id;
    opt.textContent = lead.display_name || lead.name || ('ID ' + lead.id);
    sel.appendChild(opt);
  });
}

function openDealModal(deal) {
  document.getElementById('deal-modal-heading').textContent = 'Deal Details';
  document.getElementById('deal-modal-id').value = deal.id;
  document.getElementById('deal-modal-title').value = deal.title || '';
  document.getElementById('deal-modal-status').value = deal.status || 'lead';
  document.getElementById('deal-modal-amount').value = deal.amount != null ? deal.amount : '';
  if (_fpDealDate) _fpDealDate.setDate(deal.expected_close_date ? deal.expected_close_date.slice(0, 10) : null, false);
  else document.getElementById('deal-modal-close-date').value = deal.expected_close_date ? deal.expected_close_date.slice(0, 10) : '';
  document.getElementById('deal-modal-customer-id').value = deal.customer_id || '';
  document.getElementById('deal-modal-client').textContent = deal.customer_name || '\u2014';
  document.getElementById('deal-modal-description').value = deal.description || '';
  document.getElementById('deal-modal-status-msg').textContent = '';
  _dealModalSetClientMode(false);
  document.getElementById('deal-modal').classList.remove('hidden');
}

function openNewDealModal() {
  document.getElementById('deal-modal-heading').textContent = 'New Deal';
  document.getElementById('deal-modal-id').value = '';
  document.getElementById('deal-modal-title').value = '';
  document.getElementById('deal-modal-status').value = 'lead';
  document.getElementById('deal-modal-amount').value = '';
  if (_fpDealDate) _fpDealDate.clear(); else document.getElementById('deal-modal-close-date').value = '';
  document.getElementById('deal-modal-customer-id').value = '';
  document.getElementById('deal-modal-description').value = '';
  document.getElementById('deal-modal-status-msg').textContent = '';
  _populateClientSelect();
  _dealModalSetClientMode(true);
  document.getElementById('deal-modal').classList.remove('hidden');
}

function openClientFromDeal() {
  var customerId = parseInt(document.getElementById('deal-modal-customer-id').value, 10);
  var lead = _leadsById[customerId];
  if (!lead) return;
  openClientModal(lead);
}

function closeDealModal() {
  document.getElementById('deal-modal').classList.add('hidden');
}

async function saveDeal() {
  var id = document.getElementById('deal-modal-id').value;
  var msg = document.getElementById('deal-modal-status-msg');
  var amountRaw = document.getElementById('deal-modal-amount').value;
  var isNew = !id;
  var payload = {
    title: document.getElementById('deal-modal-title').value,
    status: document.getElementById('deal-modal-status').value,
    amount: amountRaw !== '' ? parseFloat(amountRaw) : null,
    expected_close_date: document.getElementById('deal-modal-close-date').value || null,
    description: document.getElementById('deal-modal-description').value,
  };
  if (isNew) {
    var custId = document.getElementById('deal-modal-client-select').value;
    if (custId) payload.customer_id = parseInt(custId, 10);
  }
  msg.textContent = 'Saving\u2026';
  try {
    var res = await fetch(isNew ? '/api/deals' : '/api/deals/' + id, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _authToken },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    msg.textContent = isNew ? 'Created.' : 'Saved.';
    setTimeout(closeDealModal, 600);
    loadDeals();
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
  }
}

function openNewClientModal() {
  document.getElementById('client-modal-heading').textContent = 'New Client';
  document.getElementById('client-modal-id').value = '';
  document.getElementById('client-modal-name').value = '';
  document.getElementById('client-modal-status').value = 'unknown';
  document.getElementById('client-modal-phone').value = '';
  document.getElementById('client-modal-email').value = '';
  document.getElementById('client-modal-profile').value = '';
  document.getElementById('client-modal-notes').value = '';
  document.getElementById('client-modal-summary').value = '';
  document.getElementById('client-modal-whatsapp').value = '';
  document.getElementById('client-modal-telegram').value = '';
  document.getElementById('client-modal-instagram').value = '';
  document.getElementById('client-modal-signal').value = '';
  document.getElementById('client-modal-status-msg').textContent = '';
  _clientModalPinned = false;
  var pinBtn = document.getElementById('client-modal-pin-btn');
  if (pinBtn) pinBtn.classList.add('hidden');
  var refreshBtn = document.getElementById('client-modal-refresh-btn');
  if (refreshBtn) refreshBtn.classList.add('hidden');
  var delBtn = document.getElementById('client-modal-delete-btn');
  if (delBtn) delBtn.classList.add('hidden');
  _clientModalTagIds = [];
  _renderTagPills();
  _clientModalEvents = [];
  _renderClientEvents();
  cancelEventForm();
  document.getElementById('client-modal-events-section').classList.add('hidden');
  _voiceResetPanel();
  document.getElementById('client-modal').classList.remove('hidden');
}

function _updatePinBtn(pinned) {
  var btn = document.getElementById('client-modal-pin-btn');
  if (!btn) return;
  btn.classList.remove('hidden');
  if (pinned) {
    btn.classList.add('text-primary');
    btn.classList.remove('text-secondary');
    btn.title = 'Unpin client';
  } else {
    btn.classList.add('text-secondary');
    btn.classList.remove('text-primary');
    btn.title = 'Pin client';
  }
}

async function toggleModalPin() {
  var id = document.getElementById('client-modal-id').value;
  if (!id) return;
  var newPinned = !_clientModalPinned;
  try {
    var res = await fetch('/api/leads/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _authToken },
      body: JSON.stringify({ pinned: newPinned }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _clientModalPinned = newPinned;
    if (_leadsById[id]) _leadsById[id].pinned = newPinned;
    _updatePinBtn(newPinned);
    _renderPinnedClients();
  } catch (e) {
    document.getElementById('client-modal-status-msg').textContent = 'Error: ' + e.message;
  }
}

async function openClientModal(lead) {
  document.getElementById('client-modal-heading').textContent = 'Client Details';
  document.getElementById('client-modal-id').value = lead.id;
  document.getElementById('client-modal-name').value = lead.display_name || lead.name || '';
  document.getElementById('client-modal-status').value = lead.status || '';
  document.getElementById('client-modal-phone').value = lead.phone || '';
  document.getElementById('client-modal-email').value = lead.email || '';
  document.getElementById('client-modal-profile').value = lead.customer_profile || '';
  document.getElementById('client-modal-notes').value = lead.notes || '';
  document.getElementById('client-modal-summary').value = lead.summary || '';
  document.getElementById('client-modal-whatsapp').value = lead.whatsapp_id || '';
  document.getElementById('client-modal-telegram').value = lead.telegram_id || '';
  document.getElementById('client-modal-instagram').value = lead.instagram_id || '';
  document.getElementById('client-modal-signal').value = lead.signal_id || '';
  document.getElementById('client-modal-status-msg').textContent = '';
  _clientModalPinned = lead.pinned || false;
  _updatePinBtn(_clientModalPinned);
  var refreshBtn = document.getElementById('client-modal-refresh-btn');
  if (refreshBtn) refreshBtn.classList.remove('hidden');
  var delBtn = document.getElementById('client-modal-delete-btn');
  if (delBtn) delBtn.classList.remove('hidden');
  _clientModalTagIds = [];
  _renderTagPills();
  _clientModalEvents = [];
  _renderClientEvents();
  cancelEventForm();
  document.getElementById('client-modal-events-section').classList.remove('hidden');
  document.getElementById('client-modal').classList.remove('hidden');
  try {
    var res = await fetch('/api/leads/' + lead.id + '/tags', { headers: { 'Authorization': 'Bearer ' + _authToken } });
    if (res.ok) {
      var data = await res.json();
      _clientModalTagIds = (data.tags || []).map(function(t) { return t.id; });
      _renderTagPills();
    }
  } catch (e) {}
  try {
    var evRes = await fetch('/api/leads/' + lead.id + '/events', { headers: { 'Authorization': 'Bearer ' + _authToken } });
    if (evRes.ok) {
      var evData = await evRes.json();
      _clientModalEvents = evData.events || [];
      _renderClientEvents();
    }
  } catch (e) {}
}

function _renderClientEvents() {
  var list = document.getElementById('client-modal-events-list');
  var sorted = _clientModalEvents.slice().sort(function(a, b) {
    if (a.event_date !== b.event_date) return a.event_date < b.event_date ? -1 : 1;
    var at = a.event_time || ''; var bt = b.event_time || '';
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
  if (!sorted.length) {
    list.innerHTML = '<p class="text-xs text-secondary italic py-1">No scheduled events.</p>';
    return;
  }
  list.innerHTML = sorted.map(function(ev) {
    var d = ev.event_date ? new Date(ev.event_date + 'T00:00:00') : null;
    var dateStr = d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
    var timeStr = ev.event_time ? ev.event_time.slice(0, 5) : '';
    var durStr = ev.duration_minutes ? ev.duration_minutes + ' min' : '';
    var meta = [dateStr, timeStr, durStr].filter(Boolean).join(' \u00b7 ');
    return '<div class="flex items-start gap-3 px-3 py-2.5 bg-surface-container rounded-xl border border-outline-variant/20">' +
      '<span class="material-symbols-outlined text-base text-secondary mt-0.5 flex-shrink-0">event</span>' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-sm font-semibold text-on-surface">' + escapeHtml(ev.title) + '</p>' +
        '<p class="text-xs text-secondary mt-0.5">' + escapeHtml(meta) + '</p>' +
        (ev.notes ? '<p class="text-xs text-secondary/70 mt-0.5">' + escapeHtml(ev.notes) + '</p>' : '') +
      '</div>' +
      '<button type="button" onclick="deleteClientEvent(' + ev.id + ')" class="text-secondary hover:text-error transition-colors flex-shrink-0 mt-0.5 p-0.5 rounded hover:bg-error/10">' +
        '<span class="material-symbols-outlined text-base leading-none">delete</span>' +
      '</button>' +
    '</div>';
  }).join('');
}

function openEventForm() {
  document.getElementById('client-modal-event-form').classList.remove('hidden');
  document.getElementById('client-modal-event-add-btn').classList.add('hidden');
  document.getElementById('event-form-title').value = '';
  if (_fpEventDate) _fpEventDate.clear(); else document.getElementById('event-form-date').value = '';
  if (_fpEventTime) _fpEventTime.clear(); else document.getElementById('event-form-time').value = '';
  document.getElementById('event-form-duration').value = '';
  document.getElementById('event-form-event-notes').value = '';
  document.getElementById('event-form-msg').textContent = '';
  document.getElementById('event-form-title').focus();
}

function cancelEventForm() {
  document.getElementById('client-modal-event-form').classList.add('hidden');
  document.getElementById('client-modal-event-add-btn').classList.remove('hidden');
}

async function saveEventForm() {
  var customerId = document.getElementById('client-modal-id').value;
  var title = document.getElementById('event-form-title').value.trim();
  var date = document.getElementById('event-form-date').value;
  var time = document.getElementById('event-form-time').value;
  var dur = document.getElementById('event-form-duration').value;
  var notes = document.getElementById('event-form-event-notes').value.trim();
  var msg = document.getElementById('event-form-msg');
  if (!title) { msg.textContent = 'Title required.'; return; }
  if (!date) { msg.textContent = 'Date required.'; return; }
  msg.textContent = 'Saving\u2026';
  var payload = { title: title, event_date: date };
  if (time) payload.event_time = time;
  if (dur) payload.duration_minutes = parseInt(dur, 10);
  if (notes) payload.notes = notes;
  try {
    var res = await fetch('/api/leads/' + customerId + '/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _authToken },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    _clientModalEvents.push(data.event);
    _renderClientEvents();
    cancelEventForm();
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
  }
}

async function deleteClientEvent(eventId) {
  try {
    var res = await fetch('/api/events/' + eventId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + _authToken },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _clientModalEvents = _clientModalEvents.filter(function(e) { return e.id !== eventId; });
    _renderClientEvents();
  } catch (e) {
    console.error('Delete event failed:', e);
  }
}

async function refreshClient() {
  var id = document.getElementById('client-modal-id').value;
  if (!id) return;
  var msg = document.getElementById('client-modal-status-msg');
  var btn = document.getElementById('client-modal-refresh-btn');
  msg.textContent = 'Queuing refresh\u2026';
  if (btn) btn.disabled = true;
  try {
    var res = await fetch('/api/leads/' + id + '/refresh', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + _authToken },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    msg.textContent = 'Queued \u2014 summary will update after next ingest cycle.';
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function closeClientModal() {
  _voiceResetPanel();
  document.getElementById('client-modal').classList.add('hidden');
}

async function saveClient() {
  var id = document.getElementById('client-modal-id').value;
  var isNew = !id;
  var msg = document.getElementById('client-modal-status-msg');
  var payload = {
    display_name: document.getElementById('client-modal-name').value,
    status: document.getElementById('client-modal-status').value,
    phone: document.getElementById('client-modal-phone').value,
    email: document.getElementById('client-modal-email').value,
    customer_profile: document.getElementById('client-modal-profile').value,
    notes: document.getElementById('client-modal-notes').value,
    whatsapp_id: document.getElementById('client-modal-whatsapp').value,
    telegram_id: document.getElementById('client-modal-telegram').value,
    instagram_id: document.getElementById('client-modal-instagram').value,
    signal_id: document.getElementById('client-modal-signal').value,
  };
  if (isNew) payload.name = document.getElementById('client-modal-name').value;
  msg.textContent = 'Saving\u2026';
  try {
    var res = await fetch(isNew ? '/api/leads' : '/api/leads/' + id, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _authToken },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var saved = await res.json();
    var customerId = isNew ? saved.customer.id : id;
    await fetch('/api/leads/' + customerId + '/tags', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _authToken },
      body: JSON.stringify({ tag_ids: _clientModalTagIds }),
    });
    var tagNames = _clientModalTagIds.map(function(tid) {
      var t = _tenantTags.find(function(x) { return x.id === tid; });
      return t ? t.name : null;
    }).filter(Boolean);
    _customerTagsByLeadId[customerId] = tagNames;
    msg.textContent = isNew ? 'Created.' : 'Saved.';
    if (_voiceBlob && !isNew) {
      var blobToSend = _voiceBlob;
      _voiceBlob = null;
      blobToSend.arrayBuffer().then(function(buf) {
        var bytes = new Uint8Array(buf);
        var binary = '';
        bytes.forEach(function(b) { binary += String.fromCharCode(b); });
        fetch('/api/leads/' + customerId + '/voice-note', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + _authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio_b64: btoa(binary) })
        });
      });
    }
    setTimeout(closeClientModal, 600);
    loadAllLeadData();
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
  }
}

async function deleteClient() {
  var id = document.getElementById('client-modal-id').value;
  if (!id) return;
  if (!confirm('Delete this contact?')) return;
  var msg = document.getElementById('client-modal-status-msg');
  try {
    var res = await fetch('/api/leads/' + id, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + _authToken },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    closeClientModal();
    loadAllLeadData();
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
  }
}

// ── Voice note recording ──────────────────────────────────────────────────────

function _voiceResetPanel() {
  _voiceStopCleanup();
  _voiceBlob = null;
  var panel = document.getElementById('voice-note-panel');
  var btn = document.getElementById('voice-note-btn');
  var timer = document.getElementById('voice-note-timer');
  var ready = document.getElementById('voice-note-ready');
  if (panel) panel.classList.add('hidden');
  if (btn) btn.classList.remove('hidden');
  if (timer) timer.textContent = '0:00';
  if (ready) ready.classList.add('hidden');
}

function startVoiceNote() {
  document.getElementById('voice-note-panel').classList.remove('hidden');
  document.getElementById('voice-note-btn').classList.add('hidden');
}

function cancelVoiceNote() {
  _voiceResetPanel();
}

function toggleVoiceRecording() {
  if (_voiceRecording) { _voiceStopRecording(); } else { _voiceStartRecording(); }
}

async function _voiceStartRecording() {
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _voiceChunks = []; _voiceSeconds = 0; _voiceRecording = true; _voiceBlob = null;
    document.getElementById('voice-note-ready').classList.add('hidden');
    _voiceMediaRecorder = new MediaRecorder(stream);
    _voiceMediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) _voiceChunks.push(e.data); };
    _voiceMediaRecorder.onstop = function() {
      _voiceBlob = new Blob(_voiceChunks, { type: 'audio/webm' });
      _voiceChunks = [];
      document.getElementById('voice-note-ready').classList.remove('hidden');
    };
    _voiceMediaRecorder.start(250);
    document.getElementById('voice-note-record-icon').textContent = 'stop';
    document.getElementById('voice-note-record-label').textContent = 'Stop';
    document.getElementById('voice-note-record-btn').classList.replace('bg-error', 'bg-secondary');
    _voiceTimerInterval = setInterval(function() {
      _voiceSeconds++;
      var m = Math.floor(_voiceSeconds / 60), s = _voiceSeconds % 60;
      document.getElementById('voice-note-timer').textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
  } catch (e) {
    alert('Microphone error: ' + e.message);
  }
}

function _voiceStopRecording() {
  if (_voiceMediaRecorder && _voiceMediaRecorder.state !== 'inactive') {
    _voiceMediaRecorder.stop();
    _voiceMediaRecorder.stream.getTracks().forEach(function(t) { t.stop(); });
  }
  _voiceStopCleanup();
}

function _voiceStopCleanup() {
  _voiceRecording = false;
  clearInterval(_voiceTimerInterval); _voiceTimerInterval = null;
  var icon = document.getElementById('voice-note-record-icon');
  var label = document.getElementById('voice-note-record-label');
  var btn = document.getElementById('voice-note-record-btn');
  if (icon) icon.textContent = 'fiber_manual_record';
  if (label) label.textContent = 'Record';
  if (btn) btn.classList.replace('bg-secondary', 'bg-error');
}