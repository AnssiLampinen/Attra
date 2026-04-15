// Rendering, search, tags, data loading, and dashboard helpers split out of app.js.

function _isDeleted(lead) {
  return (lead.status || '').toLowerCase() === 'deleted';
}

function onSearchInput(query) {
  var box = document.getElementById('search-results');
  query = query.trim();
  if (!query) { box.classList.add('hidden'); _searchSelectedIdx = -1; return; }
  var q = query.toLowerCase();
  var leads = Object.values(_leadsById).filter(function(l) { return !_isDeleted(l); });
  var scored = leads.map(function(l) {
    var primary = (l.display_name || l.name || '').toLowerCase().includes(q) ||
                  (l.phone || '').toLowerCase().includes(q) ||
                  (l.email || '').toLowerCase().includes(q) ||
                  (l.status || '').toLowerCase().includes(q) ||
                  (l.whatsapp_id || '').toLowerCase().includes(q) ||
                  (l.telegram_id || '').toLowerCase().includes(q);
    var tags = (_customerTagsByLeadId[l.id] || []).join(' ').toLowerCase();
    var secondary = tags.includes(q) ||
                    (l.notes || '').toLowerCase().includes(q) ||
                    (l.summary || '').toLowerCase().includes(q) ||
                    (l.customer_profile || '').toLowerCase().includes(q);
    return { lead: l, score: primary ? 2 : secondary ? 1 : 0 };
  }).filter(function(x) { return x.score > 0; })
    .sort(function(a, b) { return b.score - a.score; })
    .slice(0, 8);
  var results = scored.map(function(x) { return x.lead; });
  _searchSelectedIdx = -1;
  if (!results.length) {
    box.innerHTML = '<div class="px-5 py-4 text-sm text-secondary">No results for "' + escapeHtml(query) + '"</div>';
  } else {
    box.innerHTML = results.map(function(lead, i) {
      var badge = statusBadgeClasses(lead.status);
      var initials = escapeHtml(initialsFromName(lead.display_name || lead.name));
      var phone = escapeHtml(lead.phone || lead.whatsapp_id || lead.telegram_id || '');
      return '<div data-search-idx="' + i + '" data-lead-id="' + lead.id + '" onmousedown="event.preventDefault();selectSearchResult(' + lead.id + ')" class="search-result-row flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-surface-container-low transition-colors border-b border-outline-variant/10 last:border-0">' +
        '<div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0"><span class="text-primary font-bold text-xs">' + initials + '</span></div>' +
        '<div class="flex-1 min-w-0">' +
          '<p class="font-bold text-on-surface text-sm truncate">' + escapeHtml(lead.display_name || lead.name || 'Unknown') + '</p>' +
          (phone ? '<p class="text-xs text-secondary truncate">' + phone + '</p>' : '') +
        '</div>' +
        '<span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md flex-shrink-0 ' + badge + '">' + escapeHtml(lead.status || '') + '</span>' +
      '</div>';
    }).join('');
  }
  box.classList.remove('hidden');
}

function _hexToRgba(hex, alpha) {
  if (!hex || hex.length < 7) return null;
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function _tagPillStyle(tagName) {
  var tagObj = _tenantTags.find(function(t) { return t.name === tagName; });
  var color = tagObj && tagObj.color ? tagObj.color : null;
  if (!color) return { cls: 'bg-surface-container-high text-secondary border border-outline-variant/30', style: '' };
  return {
    cls: 'border',
    style: 'background-color:' + _hexToRgba(color, 0.15) + ';color:' + color + ';border-color:' + _hexToRgba(color, 0.4) + ';',
  };
}

function _tagPillsHtml(leadId) {
  var tags = _customerTagsByLeadId[leadId] || _customerTagsByLeadId[String(leadId)] || [];
  if (!tags.length) return '';
  return tags.map(function(t) {
    var ps = _tagPillStyle(t);
    return '<span class="inline-block text-[9px] font-bold px-2 py-0.5 rounded-md ' + ps.cls + '" style="' + ps.style + '">' + escapeHtml(t) + '</span>';
  }).join('');
}

function onSearchKeydown(e) {
  var box = document.getElementById('search-results');
  if (box.classList.contains('hidden')) return;
  var rows = box.querySelectorAll('.search-result-row');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _searchSelectedIdx = Math.min(_searchSelectedIdx + 1, rows.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _searchSelectedIdx = Math.max(_searchSelectedIdx - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    var row = _searchSelectedIdx >= 0 ? rows[_searchSelectedIdx] : rows[0];
    if (row) selectSearchResult(parseInt(row.dataset.leadId, 10));
    return;
  } else if (e.key === 'Escape') {
    closeSearch(); return;
  } else { return; }
  rows.forEach(function(r, i) {
    r.classList.toggle('bg-surface-container-low', i === _searchSelectedIdx);
  });
}

function selectSearchResult(leadId) {
  var lead = _leadsById[leadId];
  if (lead) { closeSearch(); openClientModal(lead); }
}

function closeSearch() {
  document.getElementById('main-search').value = '';
  document.getElementById('search-results').classList.add('hidden');
  _searchSelectedIdx = -1;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initialsFromName(name) {
  var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function statusBadgeClasses(status) {
  var s = String(status || 'unknown').toLowerCase();
  if (s === 'customer')         return 'bg-primary/10 text-primary';
  if (s === 'lead')             return 'bg-tertiary-fixed text-on-tertiary-fixed-variant';
  if (s === 'prospect')         return 'bg-tertiary-fixed/60 text-on-tertiary-fixed-variant';
  if (s === 'personal contact') return 'bg-secondary-fixed text-on-secondary-fixed-variant';
  if (s === 'partner')          return 'bg-green-100 text-green-800';
  if (s === 'inactive')         return 'bg-surface-container-highest text-outline';
  if (s === 'deleted')          return 'bg-surface-container-high text-outline';
  return 'bg-surface-container-high text-secondary';
}

function stripNumberPrefix(text) {
  var match = text.match(/^\d+\.\s+[^:]*:\s*(.*)/);
  return match ? match[1] : text;
}

function relativeTime(isoString) {
  if (!isoString) return '';
  var now = new Date();
  var then = new Date(isoString);
  var diffMs = now - then;
  var diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 2) return 'Just now';
  if (diffMin < 60) return diffMin + 'm ago';
  var diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return diffH + 'h ago';
  var diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'Yesterday';
  if (diffD < 7) return diffD + ' days ago';
  return then.toLocaleDateString();
}

function _initDatePickers() {
  _fpDealDate = flatpickr('#deal-modal-close-date', {
    dateFormat: 'Y-m-d',
    allowInput: true,
  });
  _fpEventDate = flatpickr('#event-form-date', {
    dateFormat: 'Y-m-d',
    allowInput: true,
  });
  _fpEventTime = flatpickr('#event-form-time', {
    enableTime: true,
    noCalendar: true,
    dateFormat: 'H:i',
    time_24hr: true,
    allowInput: true,
  });
}

async function loadTenantTags() {
  try {
    var res = await fetch('/api/tags', { headers: { 'Authorization': 'Bearer ' + _authToken } });
    if (!res.ok) return;
    var data = await res.json();
    _tenantTags = data.tags || [];
  } catch (e) {}
}

function _renderTagPills() {
  var container = document.getElementById('client-modal-tags-pills');
  var sel = document.getElementById('client-modal-tags-select');
  container.innerHTML = _clientModalTagIds.map(function(tid) {
    var tag = _tenantTags.find(function(t) { return t.id === tid; });
    if (!tag) return '';
    var color = tag.color || null;
    var pillStyle = color
      ? 'background-color:' + _hexToRgba(color, 0.15) + ';color:' + color + ';border-color:' + _hexToRgba(color, 0.4) + ';'
      : '';
    var pillCls = color ? 'border' : 'bg-primary/10 text-primary';
    return '<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ' + pillCls + '" style="' + pillStyle + '">' +
      escapeHtml(tag.name) +
      '<button type="button" onclick="removeClientTag(' + tid + ')" class="ml-1 hover:opacity-60 transition-opacity"><span class="material-symbols-outlined text-[14px]">close</span></button>' +
      '</span>';
  }).join('');
  sel.innerHTML = '<option value="">+ Add tag\u2026</option>';
  _tenantTags.forEach(function(tag) {
    if (_clientModalTagIds.indexOf(tag.id) !== -1) return;
    var opt = document.createElement('option');
    opt.value = tag.id;
    opt.textContent = tag.name;
    sel.appendChild(opt);
  });
  var newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '\uff0b Create new tag\u2026';
  sel.appendChild(newOpt);
}

function removeClientTag(tagId) {
  _clientModalTagIds = _clientModalTagIds.filter(function(id) { return id !== tagId; });
  _renderTagPills();
}

function onTagSelectChange(sel) {
  var val = sel.value;
  sel.value = '';
  if (!val || val === '') return;
  if (val === '__new__') {
    sel.classList.add('hidden');
    var row = document.getElementById('client-modal-new-tag-row');
    row.classList.remove('hidden');
    var input = document.getElementById('client-modal-new-tag-input');
    input.value = '';
    input.focus();
    return;
  }
  var tagId = parseInt(val, 10);
  if (_clientModalTagIds.indexOf(tagId) === -1) _clientModalTagIds.push(tagId);
  _renderTagPills();
}

function cancelNewTag() {
  document.getElementById('client-modal-new-tag-row').classList.add('hidden');
  document.getElementById('client-modal-tags-select').classList.remove('hidden');
  document.getElementById('client-modal-new-tag-input').value = '';
}

async function confirmNewTag() {
  var input = document.getElementById('client-modal-new-tag-input');
  var name = input.value.trim();
  if (!name) { input.focus(); return; }
  var btn = input.nextElementSibling;
  var origText = btn.textContent;
  btn.textContent = '\u2026';
  btn.disabled = true;
  try {
    var res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _authToken },
      body: JSON.stringify({ name: name }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    var tag = data.tag;
    _tenantTags.push(tag);
    _tenantTags.sort(function(a, b) { return a.name.localeCompare(b.name); });
    _clientModalTagIds.push(tag.id);
    cancelNewTag();
    _renderTagPills();
  } catch (e) {
    btn.textContent = origText;
    btn.disabled = false;
    input.classList.add('ring-2', 'ring-error/50');
    setTimeout(function() { input.classList.remove('ring-2', 'ring-error/50'); }, 1500);
  }
}

// ---- Tag Settings Management ----

function loadTagSettings() {
  var list = document.getElementById('settings-tags-list');
  if (!list) return;
  if (!_tenantTags.length) {
    list.innerHTML = '<p class="text-sm text-secondary">No tags yet. Create one below.</p>';
    return;
  }
  list.innerHTML = _tenantTags.map(function(tag) {
    var color = tag.color || '#6366f1';
    return '<div id="settings-tag-row-' + tag.id + '" class="flex items-center gap-3">' +
      '<input type="color" value="' + escapeHtml(color) + '" id="settings-tag-color-' + tag.id + '" class="w-8 h-8 rounded-lg cursor-pointer border border-outline-variant/30 p-0.5 flex-shrink-0" />' +
      '<input type="text" value="' + escapeHtml(tag.name) + '" id="settings-tag-name-' + tag.id + '" ' +
        'class="flex-1 bg-surface-container-low border border-outline-variant/30 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" ' +
        'onkeydown="if(event.key===\'Enter\')saveTagSettings(' + tag.id + ')" />' +
      '<button onclick="saveTagSettings(' + tag.id + ')" class="px-3 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:opacity-90 transition-all flex-shrink-0">Save</button>' +
      '<button onclick="deleteTag(' + tag.id + ')" class="px-3 py-2 rounded-xl text-error text-xs font-bold hover:bg-error/10 transition-all flex-shrink-0">Delete</button>' +
    '</div>';
  }).join('');
}

async function saveTagSettings(tagId) {
  var nameInput = document.getElementById('settings-tag-name-' + tagId);
  var colorInput = document.getElementById('settings-tag-color-' + tagId);
  var name = nameInput ? nameInput.value.trim() : '';
  var color = colorInput ? colorInput.value : null;
  if (!name) { if (nameInput) nameInput.focus(); return; }
  try {
    var res = await fetch('/api/tags/' + tagId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _authToken },
      body: JSON.stringify({ name: name, color: color }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    var updated = data.tag;
    var idx = _tenantTags.findIndex(function(t) { return t.id === tagId; });
    if (idx !== -1) _tenantTags[idx] = updated;
    _tenantTags.sort(function(a, b) { return a.name.localeCompare(b.name); });
    loadTagSettings();
  } catch (e) {
    if (nameInput) { nameInput.classList.add('ring-2', 'ring-error/50'); setTimeout(function() { nameInput.classList.remove('ring-2', 'ring-error/50'); }, 1500); }
  }
}

async function deleteTag(tagId) {
  var tag = _tenantTags.find(function(t) { return t.id === tagId; });
  if (!tag) return;
  if (!confirm('Delete tag "' + tag.name + '"? It will be removed from all customers.')) return;
  try {
    var res = await fetch('/api/tags/' + tagId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + _authToken },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _tenantTags = _tenantTags.filter(function(t) { return t.id !== tagId; });
    // Remove from customer tag mappings in memory
    Object.keys(_customerTagsByLeadId).forEach(function(cid) {
      _customerTagsByLeadId[cid] = (_customerTagsByLeadId[cid] || []).filter(function(n) { return n !== tag.name; });
    });
    loadTagSettings();
  } catch (e) {}
}

function startNewTagFromSettings() {
  var row = document.getElementById('settings-new-tag-row');
  if (row) row.classList.remove('hidden');
  var inp = document.getElementById('settings-new-tag-name');
  if (inp) { inp.value = ''; inp.focus(); }
}

function cancelNewTagFromSettings() {
  var row = document.getElementById('settings-new-tag-row');
  if (row) row.classList.add('hidden');
}

async function confirmNewTagFromSettings() {
  var input = document.getElementById('settings-new-tag-name');
  var colorInput = document.getElementById('settings-new-tag-color');
  var name = input ? input.value.trim() : '';
  if (!name) { if (input) input.focus(); return; }
  var color = colorInput ? colorInput.value : null;
  var btn = document.getElementById('settings-new-tag-confirm');
  if (btn) { btn.textContent = '\u2026'; btn.disabled = true; }
  try {
    var res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _authToken },
      body: JSON.stringify({ name: name, color: color }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    _tenantTags.push(data.tag);
    _tenantTags.sort(function(a, b) { return a.name.localeCompare(b.name); });
    cancelNewTagFromSettings();
    loadTagSettings();
  } catch (e) {
    if (btn) { btn.textContent = 'Add'; btn.disabled = false; }
    if (input) { input.classList.add('ring-2', 'ring-error/50'); setTimeout(function() { input.classList.remove('ring-2', 'ring-error/50'); }, 1500); }
  }
}

function _renderPinnedClients() {
  var prioritiesList = document.getElementById('home-priorities-list');
  if (!prioritiesList) return;
  var pinned = Object.values(_leadsById).filter(function(l) { return l.pinned && !_isDeleted(l); });
  if (!pinned.length) {
    prioritiesList.innerHTML = '<p class="text-sm text-secondary">No pinned clients. Open a client and click the pin icon to pin them here.</p>';
    return;
  }
  prioritiesList.innerHTML = pinned.map(function(lead) {
    var name = escapeHtml(lead.display_name || lead.name || 'Unknown');
    var initials = escapeHtml(initialsFromName(lead.display_name || lead.name));
    var badge = statusBadgeClasses(lead.status);
    var status = escapeHtml(lead.status || 'unknown');
    var sLines = (lead.summary || '').split('\n').filter(function(l) { return l.trim().length > 0; });
    var lastLine = sLines.length > 0 ? escapeHtml(stripNumberPrefix(sLines[sLines.length - 1])) : 'No notes';
    var when = relativeTime(lead.last_updated_at);
    return '' +
      '<div class="bg-surface-container-lowest p-5 rounded-2xl border border-outline-variant/10 flex items-center gap-5 hover:shadow-md transition-all">' +
        '<div onclick="openClientModal(_leadsById[' + lead.id + '])" class="cursor-pointer w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center border-2 border-outline-variant/20 flex-shrink-0">' +
          '<span class="text-primary font-bold text-sm">' + initials + '</span>' +
        '</div>' +
        '<div onclick="openClientModal(_leadsById[' + lead.id + '])" class="cursor-pointer flex-1 min-w-0">' +
          '<div class="flex items-center gap-2 mb-0.5">' +
            '<p class="font-bold text-on-surface text-sm">' + name + '</p>' +
            '<span class="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md ' + badge + '">' + status + '</span>' +
          '</div>' +
          '<p class="text-sm text-secondary truncate">' + lastLine + '</p>' +
        '</div>' +
        (when ? '<span class="flex-shrink-0 text-[10px] text-secondary font-medium mr-2">' + when + '</span>' : '') +
        '<button onclick="(async function(){var r=await fetch(\'/api/leads/' + lead.id + '\',{method:\'PATCH\',headers:{\'Content-Type\':\'application/json\',\'Authorization\':\'Bearer \' + _authToken},body:JSON.stringify({pinned:false})});if(r.ok&&_leadsById[' + lead.id + '])_leadsById[' + lead.id + '].pinned=false;_renderPinnedClients();})()" class="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-primary hover:bg-primary/10 transition-all" title="Unpin">' +
          '<span class="material-symbols-outlined text-base" style="font-variation-settings:\'FILL\' 1">push_pin</span>' +
        '</button>' +
      '</div>';
  }).join('');
}

function _renderActionRequired(container, events) {
  if (!container) return;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 30);

  var seen = {};
  var candidates = [];
  events.forEach(function(ev) {
    var d = new Date(ev.event_date + 'T00:00:00');
    if (d < cutoff) return;
    if (seen[ev.customer_id]) return;
    var lead = _leadsById[ev.customer_id];
    if (lead && _isDeleted(lead)) return;
    seen[ev.customer_id] = true;
    candidates.push(ev);
  });

  var top = candidates.slice(0, 5);
  if (!top.length) {
    container.innerHTML = '<p class="text-sm text-secondary">No upcoming or recent events.</p>';
    return;
  }

  container.innerHTML = top.map(function(ev) {
    var d = new Date(ev.event_date + 'T00:00:00');
    var diffDays = Math.round((d - today) / 86400000);
    var isOverdue = diffDays < 0;
    var isToday = diffDays === 0;
    var isSoon = diffDays > 0 && diffDays <= 3;

    var dateLabel = isOverdue
      ? (diffDays === -1 ? 'Yesterday' : Math.abs(diffDays) + ' days overdue')
      : isToday ? 'Today'
      : diffDays === 1 ? 'Tomorrow'
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    var dotColor = isOverdue ? 'bg-error' : isToday ? 'bg-amber-500' : isSoon ? 'bg-amber-400' : 'bg-primary';
    var dateColor = isOverdue ? 'text-error' : isToday ? 'text-amber-600' : isSoon ? 'text-amber-500' : 'text-secondary';
    var timeStr = ev.event_time ? ' · ' + ev.event_time.slice(0, 5) : '';
    var lead = _leadsById[ev.customer_id];
    var name = escapeHtml(ev.customer_name || 'Unknown');
    var initials = escapeHtml(initialsFromName(ev.customer_name));

    return '' +
      '<div onclick="' + (lead ? 'openClientModal(_leadsById[' + ev.customer_id + '])' : '') + '" class="' + (lead ? 'cursor-pointer ' : '') + 'bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/10 flex items-center gap-4 hover:shadow-md transition-all">' +
        '<div class="relative flex-shrink-0">' +
          '<div class="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center border-2 border-outline-variant/20">' +
            '<span class="text-primary font-bold text-xs">' + initials + '</span>' +
          '</div>' +
          '<div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface ' + dotColor + '"></div>' +
        '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<p class="font-bold text-on-surface text-sm truncate">' + name + '</p>' +
          '<p class="text-xs text-secondary truncate">' + escapeHtml(ev.title) + '</p>' +
        '</div>' +
        '<span class="flex-shrink-0 text-[11px] font-bold ' + dateColor + ' text-right">' + escapeHtml(dateLabel) + '<br><span class="font-normal text-secondary">' + escapeHtml(timeStr.replace(' · ', '')) + '</span></span>' +
      '</div>';
  }).join('');
}

function _applyLeadFilters(leads) {
  var q = _filterQuery.trim().toLowerCase();
  return leads.filter(function(l) {
    if (q) {
      var displayName = (l.display_name || l.name || '').toLowerCase();
      var inText = displayName.includes(q) ||
        (l.phone || '').toLowerCase().includes(q) ||
        (l.email || '').toLowerCase().includes(q) ||
        (l.telegram_id || '').toLowerCase().includes(q) ||
        (l.whatsapp_id || '').toLowerCase().includes(q) ||
        (l.notes || '').toLowerCase().includes(q) ||
        (l.summary || '').toLowerCase().includes(q) ||
        (l.customer_profile || '').toLowerCase().includes(q);
      var tagStr = (_customerTagsByLeadId[l.id] || []).join(' ').toLowerCase();
      if (!inText && !tagStr.includes(q)) return false;
    }
    if (_filterStatuses.length > 0) {
      if (_filterStatuses.indexOf((l.status || '').toLowerCase()) === -1) return false;
    }
    if (_filterTagIds.length > 0) {
      var selectedTagNames = _filterTagIds.map(function(tid) {
        var t = _tenantTags.find(function(x) { return x.id === tid; });
        return t ? t.name : null;
      }).filter(Boolean);
      var leadTags = _customerTagsByLeadId[l.id] || [];
      var hasAll = selectedTagNames.every(function(tn) { return leadTags.indexOf(tn) !== -1; });
      if (!hasAll) return false;
    }
    return true;
  });
}

function _renderLeadsToDOM(leads, deletedLeads) {
  var grid = document.getElementById('clients-grid');
  var table = document.getElementById('dashboard-crm-rows');
  var dashGrid = document.getElementById('dashboard-grid-rows');

  var hasFilter = _filterQuery.trim() || _filterStatuses.length || _filterTagIds.length;
  var emptyMsg = hasFilter
    ? '<div class="p-6 rounded-2xl border border-outline-variant/20 bg-surface-container-low text-secondary text-sm">No clients match your filters. <button onclick="clearLeadFilters()" class="underline text-primary hover:opacity-80">Clear filters</button></div>'
    : '<div class="p-6 rounded-2xl border border-outline-variant/20 bg-surface-container-low text-secondary text-sm">No clients yet. Run your CRM ingestion script to create entries.</div>';

  if (grid) {
    if (!leads.length && !deletedLeads.length) {
      grid.innerHTML = emptyMsg;
    } else {
      var activeGridHtml = leads.length ? leads.map(function(lead) {
        var name = escapeHtml(lead.display_name || lead.name || 'Unknown');
        var status = escapeHtml(lead.status || 'unknown');
        var summary = escapeHtml(lead.summary || '');
        var phone = escapeHtml(lead.phone || lead.whatsapp_id || lead.telegram_id || '');
        var initials = escapeHtml(initialsFromName(lead.display_name || lead.name));
        var badge = statusBadgeClasses(lead.status);
        var tags = _tagPillsHtml(lead.id);
        return '' +
          '<div onclick="openClientModal(_leadsById[' + lead.id + '])" class="cursor-pointer bg-surface-container-lowest p-5 rounded-2xl border border-outline-variant/10 shadow-sm hover:shadow-md transition-all">' +
            '<div class="flex items-start gap-4">' +
              '<div class="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center border-2 border-outline-variant/20 flex-shrink-0">' +
                '<span class="text-primary font-bold text-lg">' + initials + '</span>' +
              '</div>' +
              '<div class="min-w-0 flex-1">' +
                '<div class="flex flex-wrap items-center gap-2 mb-2">' +
                  '<h4 class="font-bold text-on-surface text-base truncate">' + name + '</h4>' +
                  '<span class="inline-block text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg ' + badge + '">' + status + '</span>' +
                  tags +
                '</div>' +
                '<p class="text-sm text-secondary leading-relaxed whitespace-pre-wrap">' + (summary || 'No summary yet') + '</p>' +
                (phone ? '<p class="text-xs text-outline mt-3">' + phone + '</p>' : '') +
              '</div>' +
            '</div>' +
          '</div>';
      }).join('') : (hasFilter ? emptyMsg : '');
      var deletedGridHtml = deletedLeads.length
        ? '<div class="pt-2 pb-1 border-t border-outline-variant/20 mt-2"><p class="text-xs text-outline uppercase tracking-widest font-bold">Deleted</p></div>' +
          deletedLeads.map(function(lead) {
            var name = escapeHtml(lead.display_name || lead.name || 'Unknown');
            var initials = escapeHtml(initialsFromName(lead.display_name || lead.name));
            var phone = escapeHtml(lead.phone || lead.whatsapp_id || lead.telegram_id || '');
            return '' +
              '<div onclick="openClientModal(_leadsById[' + lead.id + '])" class="cursor-pointer opacity-40 bg-surface-container-lowest p-5 rounded-2xl border border-outline-variant/10 shadow-sm hover:shadow-md transition-all">' +
                '<div class="flex items-start gap-4">' +
                  '<div class="w-14 h-14 rounded-full bg-surface-container-high flex items-center justify-center border-2 border-outline-variant/20 flex-shrink-0">' +
                    '<span class="text-secondary font-bold text-lg">' + initials + '</span>' +
                  '</div>' +
                  '<div class="min-w-0 flex-1">' +
                    '<div class="flex flex-wrap items-center gap-2 mb-2">' +
                      '<h4 class="font-bold text-secondary text-base truncate">' + name + '</h4>' +
                      '<span class="inline-block text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-lg bg-surface-container-high text-outline">deleted</span>' +
                    '</div>' +
                    (phone ? '<p class="text-xs text-outline mt-1">' + phone + '</p>' : '') +
                  '</div>' +
                '</div>' +
              '</div>';
          }).join('')
        : '';
      grid.innerHTML = activeGridHtml + deletedGridHtml;
    }
  }

  if (table) {
    if (!leads.length && !deletedLeads.length) {
      table.innerHTML = emptyMsg;
    } else {
      var activeTableHtml = leads.length ? leads.map(function(lead) {
        var name = escapeHtml(lead.display_name || lead.name || 'Unknown');
        var status = escapeHtml(lead.status || 'unknown');
        var summary = escapeHtml(lead.summary || '');
        var initials = escapeHtml(initialsFromName(lead.display_name || lead.name));
        var badge = statusBadgeClasses(lead.status);
        var tags = _tagPillsHtml(lead.id);
        var profileLine = escapeHtml(lead.customer_profile || '');
        if (!profileLine) {
          var sLines = summary.split('\n').filter(function(l) { return l.trim().length > 0; });
          profileLine = sLines.length > 1 ? sLines[sLines.length - 2] : summary;
        }
        var sLines2 = summary.split('\n').filter(function(l) { return l.trim().length > 0; });
        var nextAction = sLines2.length > 0 ? sLines2[sLines2.length - 1] : 'No pending actions';
        nextAction = escapeHtml(stripNumberPrefix(nextAction));
        return '' +
          '<div onclick="openClientModal(_leadsById[' + lead.id + '])" class="cursor-pointer crm-row grid grid-cols-12 gap-2 md:gap-4 px-5 md:px-8 py-4 md:py-5 border-b border-outline-variant/10 items-center hover:bg-surface-container-low/50 transition-all">' +
            '<div class="col-span-12 md:col-span-4 flex items-center gap-3 md:gap-4">' +
              '<div class="w-9 h-9 md:w-10 md:h-10 rounded-full bg-primary/10 flex items-center justify-center border-2 border-outline-variant/20 flex-shrink-0">' +
                '<span class="text-primary font-bold text-sm md:text-lg">' + initials + '</span>' +
              '</div>' +
              '<div class="flex-1 min-w-0">' +
                '<p class="font-bold text-on-surface text-sm truncate">' + name + '</p>' +
                '<div class="flex flex-wrap items-center gap-1 mt-1">' +
                  '<span class="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md ' + badge + '">' + status + '</span>' +
                  tags +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="hidden md:block col-span-4">' +
              '<p class="text-sm text-secondary leading-relaxed">' + profileLine + '</p>' +
            '</div>' +
            '<div class="hidden md:block col-span-4">' +
              '<div class="flex items-center gap-2">' +
                '<span class="material-symbols-outlined text-primary text-lg">schedule_send</span>' +
                '<p class="text-sm font-medium text-on-surface">' + nextAction + '</p>' +
              '</div>' +
            '</div>' +
          '</div>';
      }).join('') : (hasFilter ? emptyMsg : '');
      var deletedTableHtml = deletedLeads.length
        ? '<div class="px-5 md:px-8 py-2 border-t border-outline-variant/20 mt-2"><p class="text-xs text-outline uppercase tracking-widest font-bold">Deleted</p></div>' +
          deletedLeads.map(function(lead) {
            var name = escapeHtml(lead.display_name || lead.name || 'Unknown');
            var initials = escapeHtml(initialsFromName(lead.display_name || lead.name));
            return '' +
              '<div onclick="openClientModal(_leadsById[' + lead.id + '])" class="cursor-pointer opacity-40 crm-row grid grid-cols-12 gap-2 md:gap-4 px-5 md:px-8 py-4 md:py-5 border-b border-outline-variant/10 items-center hover:bg-surface-container-low/50 transition-all">' +
                '<div class="col-span-12 md:col-span-4 flex items-center gap-3 md:gap-4">' +
                  '<div class="w-9 h-9 md:w-10 md:h-10 rounded-full bg-surface-container-high flex items-center justify-center border-2 border-outline-variant/20 flex-shrink-0">' +
                    '<span class="text-secondary font-bold text-sm md:text-lg">' + initials + '</span>' +
                  '</div>' +
                  '<div class="flex-1 min-w-0">' +
                    '<p class="font-bold text-secondary text-sm truncate">' + name + '</p>' +
                    '<span class="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md mt-1 bg-surface-container-high text-outline">deleted</span>' +
                  '</div>' +
                '</div>' +
              '</div>';
          }).join('')
        : '';
      table.innerHTML = activeTableHtml + deletedTableHtml;
    }
  }

  if (dashGrid) {
    if (!leads.length && !deletedLeads.length) {
      dashGrid.innerHTML = emptyMsg;
    } else {
      var activeDashHtml = leads.length ? leads.map(function(lead) {
        var name = escapeHtml(lead.display_name || lead.name || 'Unknown');
        var status = escapeHtml(lead.status || 'unknown');
        var summary = escapeHtml(lead.summary || '');
        var initials = escapeHtml(initialsFromName(lead.display_name || lead.name));
        var badge = statusBadgeClasses(lead.status);
        var tags = _tagPillsHtml(lead.id);
        var phone = escapeHtml(lead.phone || lead.whatsapp_id || lead.telegram_id || '');
        var profileLine = escapeHtml(lead.customer_profile || '');
        if (!profileLine) {
          var gLines = summary.split('\n').filter(function(l) { return l.trim().length > 0; });
          profileLine = gLines.length > 1 ? gLines[gLines.length - 2] : summary;
        }
        var aLines = summary.split('\n').filter(function(l) { return l.trim().length > 0; });
        var nextAction = aLines.length > 0 ? aLines[aLines.length - 1] : 'No pending actions';
        nextAction = escapeHtml(stripNumberPrefix(nextAction));
        return '' +
          '<div onclick="openClientModal(_leadsById[' + lead.id + '])" class="cursor-pointer bg-surface-container-lowest p-5 rounded-2xl border border-outline-variant/10 shadow-sm hover:shadow-md transition-all flex flex-col gap-4">' +
            '<div class="flex items-start gap-3">' +
              '<div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center border-2 border-outline-variant/20 flex-shrink-0">' +
                '<span class="text-primary font-bold text-sm">' + initials + '</span>' +
              '</div>' +
              '<div class="min-w-0 flex-1">' +
                '<p class="font-bold text-on-surface text-sm truncate">' + name + '</p>' +
                '<div class="flex flex-wrap items-center gap-1 mt-1">' +
                  '<span class="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md ' + badge + '">' + status + '</span>' +
                  tags +
                '</div>' +
              '</div>' +
            '</div>' +
            (profileLine ? '<p class="text-xs text-secondary leading-relaxed line-clamp-3">' + profileLine + '</p>' : '') +
            '<div class="flex items-start gap-2 pt-1 border-t border-outline-variant/10">' +
              '<span class="material-symbols-outlined text-primary text-base flex-shrink-0 mt-0.5">schedule_send</span>' +
              '<p class="text-xs font-medium text-on-surface leading-snug">' + nextAction + '</p>' +
            '</div>' +
            (phone ? '<p class="text-[11px] text-outline -mt-1">' + phone + '</p>' : '') +
          '</div>';
      }).join('') : (hasFilter ? '<div style="grid-column:1/-1">' + emptyMsg + '</div>' : '');
      var deletedDashHtml = deletedLeads.length
        ? '<div style="grid-column: 1 / -1" class="pt-2 pb-1 border-t border-outline-variant/20 mt-2"><p class="text-xs text-outline uppercase tracking-widest font-bold">Deleted</p></div>' +
          deletedLeads.map(function(lead) {
            var name = escapeHtml(lead.display_name || lead.name || 'Unknown');
            var initials = escapeHtml(initialsFromName(lead.display_name || lead.name));
            var phone = escapeHtml(lead.phone || lead.whatsapp_id || lead.telegram_id || '');
            return '' +
              '<div onclick="openClientModal(_leadsById[' + lead.id + '])" class="cursor-pointer opacity-40 bg-surface-container-lowest p-5 rounded-2xl border border-outline-variant/10 shadow-sm hover:shadow-md transition-all flex flex-col gap-4">' +
                '<div class="flex items-start gap-3">' +
                  '<div class="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center border-2 border-outline-variant/20 flex-shrink-0">' +
                    '<span class="text-secondary font-bold text-sm">' + initials + '</span>' +
                  '</div>' +
                  '<div class="min-w-0 flex-1">' +
                    '<p class="font-bold text-secondary text-sm truncate">' + name + '</p>' +
                    '<span class="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md mt-1 bg-surface-container-high text-outline">deleted</span>' +
                  '</div>' +
                '</div>' +
                (phone ? '<p class="text-[11px] text-outline -mt-1">' + phone + '</p>' : '') +
              '</div>';
          }).join('')
        : '';
      dashGrid.innerHTML = activeDashHtml + deletedDashHtml;
    }
  }
}

function _refilterLeads() {
  var allLeads = Object.values(_leadsById);
  var activeLeads = allLeads.filter(function(l) { return !_isDeleted(l); });
  var deletedLeads = allLeads.filter(function(l) { return _isDeleted(l); });
  var leads = _settings.hide_personal_contacts
    ? activeLeads.filter(function(l) { return (l.status || '').toLowerCase() !== 'personal contact'; })
    : activeLeads;
  leads = _applyLeadFilters(leads);
  _renderLeadsToDOM(leads, deletedLeads);
  _updateFilterBadges();
}

function _updateFilterBadges() {
  var count = _filterStatuses.length + _filterTagIds.length;
  ['clients', 'dash'].forEach(function(prefix) {
    var badge = document.getElementById(prefix + '-filter-badge');
    if (!badge) return;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  });
}

function _renderFilterDropdown() {
  var inner = document.getElementById('lead-filter-dropdown-inner');
  if (!inner) return;

  var allStatuses = ['customer', 'lead', 'prospect', 'personal contact', 'partner', 'inactive', 'closed', 'unknown'];
  var existingStatuses = {};
  Object.values(_leadsById).forEach(function(l) {
    var s = (l.status || 'unknown').toLowerCase();
    if (allStatuses.indexOf(s) !== -1) existingStatuses[s] = true;
  });
  var statuses = allStatuses.filter(function(s) { return existingStatuses[s]; });

  var statusHtml = statuses.length
    ? '<div class="mb-4">' +
      '<p class="text-[10px] uppercase tracking-widest font-bold text-secondary mb-2">Status</p>' +
      statuses.map(function(s) {
        var checked = _filterStatuses.indexOf(s) !== -1 ? ' checked' : '';
        return '<label class="flex items-center gap-2.5 py-1 cursor-pointer hover:text-primary transition-colors">' +
          '<input type="checkbox" value="' + s + '"' + checked + ' onchange="onStatusFilterChange(this)" class="w-4 h-4 rounded accent-primary">' +
          '<span class="text-sm text-on-surface capitalize">' + escapeHtml(s) + '</span>' +
          '</label>';
      }).join('') +
      '</div>'
    : '';

  var tagsHtml = _tenantTags.length
    ? '<div class="mb-3">' +
      '<p class="text-[10px] uppercase tracking-widest font-bold text-secondary mb-2">Tags</p>' +
      _tenantTags.map(function(t) {
        var checked = _filterTagIds.indexOf(t.id) !== -1 ? ' checked' : '';
        return '<label class="flex items-center gap-2.5 py-1 cursor-pointer hover:text-primary transition-colors">' +
          '<input type="checkbox" value="' + t.id + '"' + checked + ' onchange="onTagFilterChange(this)" class="w-4 h-4 rounded accent-primary">' +
          '<span class="text-sm text-on-surface">' + escapeHtml(t.name) + '</span>' +
          '</label>';
      }).join('') +
      '</div>'
    : '';

  var clearHtml = (_filterStatuses.length || _filterTagIds.length)
    ? '<div class="pt-2 border-t border-outline-variant/20">' +
      '<button onclick="clearLeadFilters()" class="w-full text-sm text-error hover:opacity-80 font-medium py-1 transition-colors">Clear all filters</button>' +
      '</div>'
    : '';

  inner.innerHTML = (statusHtml || tagsHtml)
    ? statusHtml + tagsHtml + clearHtml
    : '<p class="text-sm text-secondary py-1">No filters available yet.</p>';
}

function toggleLeadFilterDropdown(event, btnId) {
  event.stopPropagation();
  var dropdown = document.getElementById('lead-filter-dropdown');
  if (!dropdown) return;
  if (!dropdown.classList.contains('hidden')) {
    dropdown.classList.add('hidden');
    return;
  }
  _renderFilterDropdown();
  var btn = document.getElementById(btnId);
  if (btn) {
    var rect = btn.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    var right = window.innerWidth - rect.right;
    dropdown.style.right = right + 'px';
    dropdown.style.left = 'auto';
  }
  dropdown.classList.remove('hidden');
}

function onLeadFilterInput(value) {
  _filterQuery = value;
  document.querySelectorAll('.lead-filter-input').forEach(function(inp) {
    if (inp.value !== value) inp.value = value;
  });
  var q = value.trim().toLowerCase();
  if (!q && !_filterStatuses.length && !_filterTagIds.length) {
    _refilterLeads();
    return;
  }
  var allLeads = Object.values(_leadsById);
  var activeLeads = allLeads.filter(function(l) { return !_isDeleted(l); });
  var leads = _settings.hide_personal_contacts
    ? activeLeads.filter(function(l) { return (l.status || '').toLowerCase() !== 'personal contact'; })
    : activeLeads;
  if (q) {
    leads = leads.filter(function(l) {
      var displayName = (l.display_name || l.name || '').toLowerCase();
      var primary = displayName.includes(q) ||
        (l.phone || '').toLowerCase().includes(q) ||
        (l.email || '').toLowerCase().includes(q) ||
        (l.status || '').toLowerCase().includes(q) ||
        (l.whatsapp_id || '').toLowerCase().includes(q) ||
        (l.telegram_id || '').toLowerCase().includes(q);
      var tagStr = (_customerTagsByLeadId[l.id] || _customerTagsByLeadId[String(l.id)] || []).join(' ').toLowerCase();
      var secondary = tagStr.includes(q) ||
        (l.notes || '').toLowerCase().includes(q) ||
        (l.summary || '').toLowerCase().includes(q) ||
        (l.customer_profile || '').toLowerCase().includes(q);
      return primary || secondary;
    });
  }
  if (_filterStatuses.length > 0) {
    leads = leads.filter(function(l) {
      return _filterStatuses.indexOf((l.status || '').toLowerCase()) !== -1;
    });
  }
  if (_filterTagIds.length > 0) {
    var selectedTagNames = _filterTagIds.map(function(tid) {
      var t = _tenantTags.find(function(x) { return x.id === tid; });
      return t ? t.name : null;
    }).filter(Boolean);
    leads = leads.filter(function(l) {
      var leadTags = _customerTagsByLeadId[l.id] || _customerTagsByLeadId[String(l.id)] || [];
      return selectedTagNames.every(function(tn) { return leadTags.indexOf(tn) !== -1; });
    });
  }
  var deletedLeads = allLeads.filter(function(l) { return _isDeleted(l); });
  _renderLeadsToDOM(leads, deletedLeads);
  _updateFilterBadges();
}

function onStatusFilterChange(checkbox) {
  var s = checkbox.value;
  if (checkbox.checked) {
    if (_filterStatuses.indexOf(s) === -1) _filterStatuses.push(s);
  } else {
    _filterStatuses = _filterStatuses.filter(function(x) { return x !== s; });
  }
  _updateFilterBadges();
  _refilterLeads();
}

function onTagFilterChange(checkbox) {
  var tid = parseInt(checkbox.value, 10);
  if (checkbox.checked) {
    if (_filterTagIds.indexOf(tid) === -1) _filterTagIds.push(tid);
  } else {
    _filterTagIds = _filterTagIds.filter(function(x) { return x !== tid; });
  }
  _updateFilterBadges();
  _refilterLeads();
}

function clearLeadFilters() {
  _filterStatuses = [];
  _filterTagIds = [];
  _filterQuery = '';
  document.querySelectorAll('.lead-filter-input').forEach(function(inp) { inp.value = ''; });
  var dropdown = document.getElementById('lead-filter-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
  _refilterLeads();
}

document.addEventListener('click', function(e) {
  var dropdown = document.getElementById('lead-filter-dropdown');
  if (!dropdown || dropdown.classList.contains('hidden')) return;
  if (!dropdown.contains(e.target) && !e.target.closest('.lead-filter-btn')) {
    dropdown.classList.add('hidden');
  }
});

async function loadAllLeadData() {
  var grid = document.getElementById('clients-grid');
  var table = document.getElementById('dashboard-crm-rows');
  var prioritiesList = document.getElementById('home-priorities-list');
  var activityList = document.getElementById('home-activity-list');

  var errorHtml = '<div class="col-span-12 p-6 rounded-2xl border border-error/30 bg-error/5 text-error text-sm">Could not load leads from API. Start app_server.py and open the page via http://127.0.0.1:8000</div>';

  try {
    var results = await Promise.all([
      fetch('/api/leads', { headers: { 'Authorization': 'Bearer ' + _authToken } }),
      fetch('/api/customer-tags', { headers: { 'Authorization': 'Bearer ' + _authToken } }),
    ]);
    var res = results[0];
    var tagsRes = results[1];
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    var tagsData = tagsRes.ok ? await tagsRes.json() : {};
    if (tagsData.customer_tags) _customerTagsByLeadId = tagsData.customer_tags;
    var allLeads = Array.isArray(data.leads) ? data.leads : [];
    allLeads.forEach(function(l) { _leadsById[l.id] = l; });

    var activeLeads = allLeads.filter(function(l) { return !_isDeleted(l); });
    var leadsForStats = _settings.hide_personal_contacts
      ? activeLeads.filter(function(l) { return (l.status || '').toLowerCase() !== 'personal contact'; })
      : activeLeads;

    var now = new Date();
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    var activeCount = leadsForStats.filter(function(l) {
      var s = (l.status || '').toLowerCase();
      return s !== 'closed' && s !== 'inactive';
    }).length;
    var monthCount = leadsForStats.filter(function(l) {
      return l.last_updated_at && l.last_updated_at >= monthStart;
    }).length;

    ['home', 'dash'].forEach(function(prefix) {
      var t = document.getElementById('stat-' + prefix + '-total');
      var a = document.getElementById('stat-' + prefix + '-active');
      var m = document.getElementById('stat-' + prefix + '-month');
      if (t) t.textContent = leadsForStats.length;
      if (a) a.textContent = activeCount;
      if (m) m.textContent = monthCount;
    });

    _refilterLeads();

    _renderPinnedClients();

    if (activityList) {
      try {
        var evRes = await fetch('/api/events', { headers: { 'Authorization': 'Bearer ' + _authToken } });
        var allEvents = evRes.ok ? ((await evRes.json()).events || []) : [];
        _renderActionRequired(activityList, allEvents);
      } catch (e) {
        activityList.innerHTML = '<p class="text-sm text-secondary">Could not load events.</p>';
      }
    }

  } catch (err) {
    if (grid) grid.innerHTML = errorHtml;
    if (table) table.innerHTML = errorHtml;
  }
}

function dealStatusBadgeClasses(status) {
  var s = String(status || '').toLowerCase();
  if (s === 'won') return 'bg-green-100 text-green-800';
  if (s === 'lost') return 'bg-error/10 text-error';
  if (s === 'negotiation') return 'bg-tertiary-fixed text-on-tertiary-fixed-variant';
  if (s === 'proposal') return 'bg-secondary-fixed text-on-secondary-fixed-variant';
  if (s === 'qualified') return 'bg-primary/10 text-primary';
  return 'bg-surface-container-high text-secondary';
}

function formatAmount(amount) {
  if (amount == null || amount === '') return '';
  return '\u20ac' + Number(amount).toLocaleString('fi-FI', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('fi-FI', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderDealCard(deal) {
  var title = escapeHtml(deal.title || 'Untitled');
  var client = escapeHtml(deal.customer_name || '');
  var desc = escapeHtml(deal.description || '');
  var amount = formatAmount(deal.amount);
  var closeDate = formatDate(deal.expected_close_date);
  var status = escapeHtml(deal.status || '');
  var badge = dealStatusBadgeClasses(deal.status);
  var dataAttr = 'data-deal-id="' + deal.id + '"';
  return '' +
    '<div ' + dataAttr + ' onclick="openDealModal(_dealsById[' + deal.id + '])" class="cursor-pointer bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/10 shadow-sm hover:shadow-md transition-all">' +
      '<div class="flex items-start justify-between gap-2 mb-2">' +
        '<p class="font-bold text-on-surface text-sm leading-tight">' + title + '</p>' +
        (amount ? '<span class="flex-shrink-0 text-xs font-bold text-primary">' + amount + '</span>' : '') +
      '</div>' +
      (client ? '<p class="text-xs text-secondary mb-2">' + client + '</p>' : '') +
      (desc ? '<p class="text-xs text-secondary leading-relaxed mb-3 line-clamp-2">' + desc + '</p>' : '') +
      '<div class="flex items-center justify-between gap-2">' +
        '<span class="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md ' + badge + '">' + status + '</span>' +
        (closeDate ? '<span class="text-[10px] text-secondary">' + closeDate + '</span>' : '') +
      '</div>' +
    '</div>';
}

async function loadDeals() {
  var colIds = {
    lead:      document.getElementById('deals-col-lead'),
    qualified: document.getElementById('deals-col-qualified'),
    proposal:  document.getElementById('deals-col-proposal'),
    closed:    document.getElementById('deals-col-closed'),
  };
  var empty = '<p class="text-sm text-secondary">No deals yet.</p>';
  var errorMsg = '<p class="text-sm text-error">Could not load deals.</p>';

  try {
    var res = await fetch('/api/deals', { headers: { 'Authorization': 'Bearer ' + _authToken } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    var deals = Array.isArray(data.deals) ? data.deals : [];
    _dealsById = {};
    deals.forEach(function(d) { _dealsById[d.id] = d; });

    var buckets = { lead: [], qualified: [], proposal: [], closed: [] };
    deals.forEach(function(d) {
      var s = (d.status || '').toLowerCase();
      if (s === 'lead') buckets.lead.push(d);
      else if (s === 'qualified') buckets.qualified.push(d);
      else if (s === 'proposal' || s === 'negotiation') buckets.proposal.push(d);
      else if (s === 'won' || s === 'lost') buckets.closed.push(d);
      else buckets.lead.push(d);
    });

    Object.keys(colIds).forEach(function(key) {
      var el = colIds[key];
      if (!el) return;
      var cards = buckets[key];
      el.innerHTML = cards.length ? cards.map(renderDealCard).join('') : empty;
    });
  } catch (err) {
    Object.values(colIds).forEach(function(el) { if (el) el.innerHTML = errorMsg; });
  }
}