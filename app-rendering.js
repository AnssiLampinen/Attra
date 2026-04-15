// Rendering, search, tags, data loading, and dashboard helpers split out of app.js.

function onSearchInput(query) {
  var box = document.getElementById('search-results');
  query = query.trim();
  if (!query) { box.classList.add('hidden'); _searchSelectedIdx = -1; return; }
  var q = query.toLowerCase();
  var leads = Object.values(_leadsById);
  var scored = leads.map(function(l) {
    var primary = (l.name || '').toLowerCase().includes(q) ||
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
      var initials = escapeHtml(initialsFromName(lead.name));
      var phone = escapeHtml(lead.phone || lead.whatsapp_id || lead.telegram_id || '');
      return '<div data-search-idx="' + i + '" data-lead-id="' + lead.id + '" onmousedown="event.preventDefault();selectSearchResult(' + lead.id + ')" class="search-result-row flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-surface-container-low transition-colors border-b border-outline-variant/10 last:border-0">' +
        '<div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0"><span class="text-primary font-bold text-xs">' + initials + '</span></div>' +
        '<div class="flex-1 min-w-0">' +
          '<p class="font-bold text-on-surface text-sm truncate">' + escapeHtml(lead.name || 'Unknown') + '</p>' +
          (phone ? '<p class="text-xs text-secondary truncate">' + phone + '</p>' : '') +
        '</div>' +
        '<span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md flex-shrink-0 ' + badge + '">' + escapeHtml(lead.status || '') + '</span>' +
      '</div>';
    }).join('');
  }
  box.classList.remove('hidden');
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
    return '<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold">' +
      escapeHtml(tag.name) +
      '<button type="button" onclick="removeClientTag(' + tid + ')" class="ml-1 hover:text-error transition-colors"><span class="material-symbols-outlined text-[14px]">close</span></button>' +
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

function _renderPinnedClients() {
  var prioritiesList = document.getElementById('home-priorities-list');
  if (!prioritiesList) return;
  var pinned = Object.values(_leadsById).filter(function(l) { return l.pinned; });
  if (!pinned.length) {
    prioritiesList.innerHTML = '<p class="text-sm text-secondary">No pinned clients. Open a client and click the pin icon to pin them here.</p>';
    return;
  }
  prioritiesList.innerHTML = pinned.map(function(lead) {
    var name = escapeHtml(lead.name || 'Unknown');
    var initials = escapeHtml(initialsFromName(lead.name));
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

async function loadAllLeadData() {
  var grid = document.getElementById('clients-grid');
  var table = document.getElementById('dashboard-crm-rows');
  var prioritiesList = document.getElementById('home-priorities-list');
  var activityList = document.getElementById('home-activity-list');

  var errorHtml = '<div class="col-span-12 p-6 rounded-2xl border border-error/30 bg-error/5 text-error text-sm">Could not load leads from API. Start app_server.py and open the page via http://127.0.0.1:8000</div>';

  try {
    var res = await fetch('/api/leads', { headers: { 'Authorization': 'Bearer ' + _authToken } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    var allLeads = Array.isArray(data.leads) ? data.leads : [];
    allLeads.forEach(function(l) { _leadsById[l.id] = l; });
    fetch('/api/customer-tags', { headers: { 'Authorization': 'Bearer ' + _authToken } })
      .then(function(r) { return r.ok ? r.json() : {}; })
      .then(function(d) { if (d.customer_tags) _customerTagsByLeadId = d.customer_tags; })
      .catch(function() {});
    var leads = _settings.hide_personal_contacts
      ? allLeads.filter(function(l) { return (l.status || '').toLowerCase() !== 'personal contact'; })
      : allLeads;

    var now = new Date();
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    var activeCount = leads.filter(function(l) {
      var s = (l.status || '').toLowerCase();
      return s !== 'closed' && s !== 'inactive';
    }).length;
    var monthCount = leads.filter(function(l) {
      return l.last_updated_at && l.last_updated_at >= monthStart;
    }).length;

    ['home', 'dash'].forEach(function(prefix) {
      var t = document.getElementById('stat-' + prefix + '-total');
      var a = document.getElementById('stat-' + prefix + '-active');
      var m = document.getElementById('stat-' + prefix + '-month');
      if (t) t.textContent = leads.length;
      if (a) a.textContent = activeCount;
      if (m) m.textContent = monthCount;
    });

    var emptyMsg = '<div class="p-6 rounded-2xl border border-outline-variant/20 bg-surface-container-low text-secondary text-sm">No clients yet. Run your CRM ingestion script to create entries.</div>';

    if (grid) {
      if (!leads.length) {
        grid.innerHTML = emptyMsg;
      } else {
        grid.innerHTML = leads.map(function(lead) {
          var name = escapeHtml(lead.name || 'Unknown');
          var status = escapeHtml(lead.status || 'unknown');
          var summary = escapeHtml(lead.summary || '');
          var phone = escapeHtml(lead.phone || lead.whatsapp_id || lead.telegram_id || '');
          var initials = escapeHtml(initialsFromName(lead.name));
          var badge = statusBadgeClasses(lead.status);
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
                  '</div>' +
                  '<p class="text-sm text-secondary leading-relaxed whitespace-pre-wrap">' + (summary || 'No summary yet') + '</p>' +
                  (phone ? '<p class="text-xs text-outline mt-3">' + phone + '</p>' : '') +
                '</div>' +
              '</div>' +
            '</div>';
        }).join('');
      }
    }

    if (table) {
      if (!leads.length) {
        table.innerHTML = emptyMsg;
      } else {
        table.innerHTML = leads.map(function(lead) {
          var name = escapeHtml(lead.name || 'Unknown');
          var status = escapeHtml(lead.status || 'unknown');
          var summary = escapeHtml(lead.summary || '');
          var initials = escapeHtml(initialsFromName(lead.name));
          var badge = statusBadgeClasses(lead.status);
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
                  '<span class="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md mt-1 ' + badge + '">' + status + '</span>' +
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
        }).join('');
      }
    }

    var dashGrid = document.getElementById('dashboard-grid-rows');
    if (dashGrid) {
      if (!leads.length) {
        dashGrid.innerHTML = emptyMsg;
      } else {
        dashGrid.innerHTML = leads.map(function(lead) {
          var name = escapeHtml(lead.name || 'Unknown');
          var status = escapeHtml(lead.status || 'unknown');
          var summary = escapeHtml(lead.summary || '');
          var initials = escapeHtml(initialsFromName(lead.name));
          var badge = statusBadgeClasses(lead.status);
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
                  '<span class="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md mt-1 ' + badge + '">' + status + '</span>' +
                '</div>' +
              '</div>' +
              (profileLine ? '<p class="text-xs text-secondary leading-relaxed line-clamp-3">' + profileLine + '</p>' : '') +
              '<div class="flex items-start gap-2 pt-1 border-t border-outline-variant/10">' +
                '<span class="material-symbols-outlined text-primary text-base flex-shrink-0 mt-0.5">schedule_send</span>' +
                '<p class="text-xs font-medium text-on-surface leading-snug">' + nextAction + '</p>' +
              '</div>' +
              (phone ? '<p class="text-[11px] text-outline -mt-1">' + phone + '</p>' : '') +
            '</div>';
        }).join('');
      }
    }

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