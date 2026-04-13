// ---- Globals ----
var _userName = '';
var _supabaseClient = null;
var _authToken = null;
var _settings = { hide_personal_contacts: false };
var _searchSelectedIdx = -1;
var _leadsById = {};
var _tenantTags = [];
var _clientModalTagIds = [];
var _clientModalPinned = false;
var _customerTagsByLeadId = {};
var _clientModalEvents = [];
var _fpDealDate = null;
var _fpEventDate = null;
var _fpEventTime = null;
var _dealsById = {};
var _typewriterTimer = null;
var _dashView = 'grid';

// ---- Dashboard view toggle ----
function toggleDashView(mode) {
  console.log('toggleDashView called:', mode);
  _dashView = mode;
  var listWrap = document.getElementById('dashboard-list-wrap');
  var gridWrap = document.getElementById('dashboard-grid-rows');
  var btnList = document.getElementById('dash-view-list');
  var btnGrid = document.getElementById('dash-view-grid');
  if (mode === 'grid') {
    listWrap.style.display = 'none';
    gridWrap.style.display = 'grid';
    btnGrid.classList.add('bg-surface-container-lowest', 'shadow-sm', 'text-primary');
    btnGrid.classList.remove('text-secondary');
    btnList.classList.remove('bg-surface-container-lowest', 'shadow-sm', 'text-primary');
    btnList.classList.add('text-secondary');
  } else {
    gridWrap.style.display = 'none';
    listWrap.style.display = '';
    btnList.classList.add('bg-surface-container-lowest', 'shadow-sm', 'text-primary');
    btnList.classList.remove('text-secondary');
    btnGrid.classList.remove('bg-surface-container-lowest', 'shadow-sm', 'text-primary');
    btnGrid.classList.add('text-secondary');
  }
}

// ---- Sidebar ----
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('sidebar-hidden');
  document.getElementById('main-content').classList.toggle('sidebar-hidden');
  document.getElementById('search-wrapper').classList.toggle('sidebar-hidden');
}

// ---- Auth ----
function _showApp(session) {
  _authToken = session.access_token;
  _userName = (session.user.email || '').split('@')[0];
  document.getElementById('login-overlay').style.display = 'none';

  var nameEl = document.getElementById('settings-name');
  var displayEl = document.getElementById('profile-display-name');
  var emailEl = document.getElementById('settings-email');
  var sigEl = document.getElementById('settings-signature');
  if (nameEl) nameEl.value = _userName;
  if (displayEl) displayEl.textContent = _userName;
  if (emailEl) emailEl.value = session.user.email || '';
  if (sigEl && !sigEl.value) sigEl.value = 'Best, ' + _userName + ' \u2014 ATTRA';

  loadSettings().then(function() { startTypewriter(); loadAllLeadData(); });
  loadDeals();
  loadTenantTags();
}

function _showSetPasswordPanel(subtitle) {
  document.getElementById('login-panel').classList.add('hidden');
  document.getElementById('forgot-password-panel').classList.add('hidden');
  document.getElementById('set-password-panel').classList.remove('hidden');
  document.getElementById('set-password-subtitle').textContent = subtitle || 'Set your password';
}

async function initAuth() {
  var config = await fetch('/api/config').then(function(r) { return r.json(); });
  _supabaseClient = supabase.createClient(config.supabase_url, config.supabase_anon_key);

  var hash = window.location.hash;
  var hashParams = new URLSearchParams(hash.replace(/^#/, ''));
  var urlType = hashParams.get('type');

  _supabaseClient.auth.onAuthStateChange(function(event, session) {
    if (event === 'PASSWORD_RECOVERY') {
      _authToken = session ? session.access_token : null;
      _showSetPasswordPanel('Reset your password');
      return;
    }
    if (event === 'TOKEN_REFRESHED' && session) {
      _authToken = session.access_token;
      return;
    }
    if (event === 'SIGNED_OUT') {
      _authToken = null;
      document.getElementById('login-panel').classList.remove('hidden');
      document.getElementById('forgot-password-panel').classList.add('hidden');
      document.getElementById('set-password-panel').classList.add('hidden');
      document.getElementById('login-overlay').style.display = 'flex';
      return;
    }
    if (event === 'SIGNED_IN' && session && urlType === 'invite') {
      _authToken = session.access_token;
      _showSetPasswordPanel('Welcome! Set your password to continue');
      return;
    }
  });

  var sessionResult = await _supabaseClient.auth.getSession();
  var session = sessionResult.data.session;
  if (session) {
    if (urlType === 'recovery') {
      _authToken = session.access_token;
      _showSetPasswordPanel('Reset your password');
    } else if (urlType === 'invite') {
      _authToken = session.access_token;
      _showSetPasswordPanel('Welcome! Set your password to continue');
    } else {
      _showApp(session);
    }
  }
}

// ---- Greeting / Typewriter ----
function getGreeting() {
  var h = new Date().getHours();
  if (h < 5)  return 'Good night, ' + _userName + '.';
  if (h < 12) return 'Good morning, ' + _userName + '.';
  if (h < 17) return 'Good afternoon, ' + _userName + '.';
  if (h < 22) return 'Good evening, ' + _userName + '.';
  return 'Good night, ' + _userName + '.';
}

function startTypewriter() {
  if (_typewriterTimer) clearTimeout(_typewriterTimer);
  var el = document.getElementById('home-greeting');
  var cursor = document.querySelector('.typewriter-cursor');
  var subtitle = document.getElementById('home-subtitle');
  var text = getGreeting();
  el.textContent = '';
  subtitle.style.opacity = '0';
  cursor.style.display = 'inline-block';
  cursor.style.animation = 'blink-cursor 0.75s step-end infinite';
  var i = 0;
  function type() {
    if (i < text.length) {
      el.textContent += text[i];
      i++;
      _typewriterTimer = setTimeout(type, 55 + Math.random() * 35);
    } else {
      setTimeout(function() {
        cursor.style.animation = 'none';
        cursor.style.opacity = '0';
        subtitle.style.opacity = '1';
      }, 400);
    }
  }
  _typewriterTimer = setTimeout(type, 450);
}

// ---- Navigation ----
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.remove('text-[#0058be]', 'bg-[#ffffff]/60', 'translate-x-1', 'shadow-sm');
    a.classList.add('text-[#495e8a]');
    a.querySelector('.material-symbols-outlined').style.fontVariationSettings = "'FILL' 0";
  });
  const activeDesktop = document.querySelector('.nav-link[data-page="' + pageId + '"]');
  if (activeDesktop) {
    activeDesktop.classList.add('text-[#0058be]', 'bg-[#ffffff]/60', 'translate-x-1', 'shadow-sm');
    activeDesktop.classList.remove('text-[#495e8a]');
    activeDesktop.querySelector('.material-symbols-outlined').style.fontVariationSettings = "'FILL' 1";
  }
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.classList.remove('text-[#0058be]', 'bg-[#0058be]/10', 'scale-95');
    btn.classList.add('text-[#495e8a]');
    btn.querySelector('.material-symbols-outlined').style.fontVariationSettings = "'FILL' 0";
  });
  const activeMobile = document.querySelector('.mobile-nav-btn[data-mobile-page="' + pageId + '"]');
  if (activeMobile) {
    activeMobile.classList.add('text-[#0058be]', 'bg-[#0058be]/10', 'scale-95');
    activeMobile.classList.remove('text-[#495e8a]');
    activeMobile.querySelector('.material-symbols-outlined').style.fontVariationSettings = "'FILL' 1";
  }
  if (pageId === 'page-home') startTypewriter();
}

function showClientDetail(id) {
  document.getElementById('clients-grid').classList.add('hidden');
  document.querySelectorAll('.client-detail').forEach(d => d.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  window.scrollTo({top: 0, behavior: 'smooth'});
}
function closeClientDetail() {
  document.querySelectorAll('.client-detail').forEach(d => d.classList.add('hidden'));
  document.getElementById('clients-grid').classList.remove('hidden');
  window.scrollTo({top: 0, behavior: 'smooth'});
}

// ---- Settings ----
async function loadSettings() {
  try {
    var res = await fetch('/api/settings', { headers: { 'Authorization': 'Bearer ' + _authToken } });
    if (!res.ok) return;
    var data = await res.json();
    _settings = data;
    var btn = document.getElementById('toggle-hide-personal-contacts');
    if (btn) _applyToggleState(btn, !!data.hide_personal_contacts);
    if (data.display_name) {
      _userName = data.display_name;
      var nameEl = document.getElementById('settings-name');
      var displayEl = document.getElementById('profile-display-name');
      if (nameEl) nameEl.value = _userName;
      if (displayEl) displayEl.textContent = _userName;
    }
    var beeperEl = document.getElementById('settings-beeper-name');
    if (beeperEl && data.username) beeperEl.value = data.username;
  } catch (_) {}
}

function _applyToggleState(btn, on) {
  btn.dataset.on = on ? 'true' : 'false';
  btn.classList.toggle('bg-primary', on);
  btn.classList.toggle('bg-surface-container-high', !on);
  btn.querySelector('span').classList.toggle('translate-x-5', on);
}

function toggleSetting(btn) {
  var on = btn.dataset.on === 'true';
  _applyToggleState(btn, !on);
}

async function toggleApiSetting(btn, key) {
  var on = btn.dataset.on === 'true';
  var newVal = !on;
  _applyToggleState(btn, newVal);
  _settings[key] = newVal;
  try {
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _authToken },
      body: JSON.stringify({ [key]: newVal }),
    });
  } catch (_) {}
  if (key === 'hide_personal_contacts') loadAllLeadData();
}

function selectTone(btn) {
  document.querySelectorAll('.tone-btn').forEach(function(b) {
    b.classList.remove('border-primary', 'bg-primary/10', 'text-primary');
    b.classList.add('border-outline-variant/30', 'text-secondary');
  });
  btn.classList.add('border-primary', 'bg-primary/10', 'text-primary');
  btn.classList.remove('border-outline-variant/30', 'text-secondary');
}

function setTheme(theme, btn) {
  document.querySelectorAll('.theme-btn').forEach(function(b) {
    b.classList.remove('border-primary', 'bg-primary/5');
    b.classList.add('border-outline-variant/20');
    b.querySelector('p').classList.remove('text-primary');
    b.querySelector('p').classList.add('text-secondary');
  });
  btn.classList.add('border-primary', 'bg-primary/5');
  btn.classList.remove('border-outline-variant/20');
  btn.querySelector('p').classList.add('text-primary');
  btn.querySelector('p').classList.remove('text-secondary');
  document.documentElement.className = theme;
}

function updateName(val) {
  if (!val.trim()) return;
  _userName = val.trim();
  document.getElementById('profile-display-name').textContent = _userName;
}

async function saveProfileSettings() {
  var name = (document.getElementById('settings-name').value || '').trim();
  var beeperName = (document.getElementById('settings-beeper-name').value || '').trim();
  var msgEl = document.getElementById('settings-profile-msg');
  if (!name) { if (msgEl) msgEl.textContent = 'Display name cannot be empty.'; return; }
  _userName = name;
  document.getElementById('profile-display-name').textContent = _userName;
  if (msgEl) msgEl.textContent = 'Saving\u2026';
  try {
    var payload = { display_name: _userName };
    if (beeperName) payload.username = beeperName;
    var res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _authToken },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (msgEl) { msgEl.textContent = 'Saved.'; setTimeout(function() { msgEl.textContent = ''; }, 2000); }
    startTypewriter();
  } catch (e) {
    if (msgEl) msgEl.textContent = 'Error: ' + e.message;
  }
}

// ---- Search ----
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

// ---- Date pickers ----
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

// ---- Tags ----
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

// ---- Pinned Clients ----
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
        '<button onclick="(async function(){var r=await fetch(\'/api/leads/' + lead.id + '\',{method:\'PATCH\',headers:{\'Content-Type\':\'application/json\',\'Authorization\':\'Bearer \'+_authToken},body:JSON.stringify({pinned:false})});if(r.ok&&_leadsById[' + lead.id + '])_leadsById[' + lead.id + '].pinned=false;_renderPinnedClients();})()" class="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-primary hover:bg-primary/10 transition-all" title="Unpin">' +
          '<span class="material-symbols-outlined text-base" style="font-variation-settings:\'FILL\' 1">push_pin</span>' +
        '</button>' +
      '</div>';
  }).join('');
}

// ---- Action Required ----
function _renderActionRequired(container, events) {
  if (!container) return;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 30);

  // Filter: last 30 days + all future; deduplicate by customer keeping earliest event
  var seen = {};
  var candidates = [];
  events.forEach(function(ev) {
    var d = new Date(ev.event_date + 'T00:00:00');
    if (d < cutoff) return;
    if (seen[ev.customer_id]) return;
    seen[ev.customer_id] = true;
    candidates.push(ev);
  });
  // events already ordered by event_date ASC from API:
  // overdue (past) appear first, then today, then upcoming — exactly what we want

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

// ---- Lead data ----
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

    // --- Clients grid ---
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

    // --- Dashboard table ---
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

    // --- Dashboard grid view ---
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

    // --- Home: Pinned Clients ---
    _renderPinnedClients();

    // --- Home: Action Required (upcoming/overdue events) ---
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

// ---- Deals ----
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

// ---- Deal modal ----
function _dealModalSetClientMode(isNew) {
  document.getElementById('deal-modal-client').classList.toggle('hidden', isNew);
  document.getElementById('deal-modal-client-select').classList.toggle('hidden', !isNew);
}

function _populateClientSelect() {
  var sel = document.getElementById('deal-modal-client-select');
  sel.innerHTML = '<option value="">\u2014 Select client \u2014</option>';
  Object.values(_leadsById).sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); }).forEach(function(lead) {
    var opt = document.createElement('option');
    opt.value = lead.id;
    opt.textContent = lead.name || ('ID ' + lead.id);
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

// ---- Client modal ----
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
  _clientModalTagIds = [];
  _renderTagPills();
  _clientModalEvents = [];
  _renderClientEvents();
  cancelEventForm();
  document.getElementById('client-modal-events-section').classList.add('hidden');
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
  document.getElementById('client-modal-name').value = lead.name || '';
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

function closeClientModal() {
  document.getElementById('client-modal').classList.add('hidden');
}

async function saveClient() {
  var id = document.getElementById('client-modal-id').value;
  var isNew = !id;
  var msg = document.getElementById('client-modal-status-msg');
  var payload = {
    name: document.getElementById('client-modal-name').value,
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
    setTimeout(closeClientModal, 600);
    loadAllLeadData();
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
  }
}

// ---- Global event listeners ----
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { closeDealModal(); closeClientModal(); closeSearch(); }
});

document.addEventListener('click', function(e) {
  var wrapper = document.getElementById('search-wrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    document.getElementById('search-results').classList.add('hidden');
    _searchSelectedIdx = -1;
  }
});

document.addEventListener('DOMContentLoaded', function() {
  // Login form listeners
  document.getElementById('login-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var email = document.getElementById('login-email').value;
    var password = document.getElementById('login-password').value;
    var errorEl = document.getElementById('login-error');
    errorEl.classList.add('hidden');
    var result = await _supabaseClient.auth.signInWithPassword({ email: email, password: password });
    if (result.error) {
      errorEl.textContent = result.error.message;
      errorEl.classList.remove('hidden');
      return;
    }
    _showApp(result.data.session);
  });

  document.getElementById('forgot-password-link').addEventListener('click', function() {
    document.getElementById('login-panel').classList.add('hidden');
    document.getElementById('forgot-password-panel').classList.remove('hidden');
  });

  document.getElementById('back-to-login-link').addEventListener('click', function() {
    document.getElementById('forgot-password-panel').classList.add('hidden');
    document.getElementById('login-panel').classList.remove('hidden');
  });

  document.getElementById('forgot-password-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var email = document.getElementById('reset-email').value;
    var errorEl = document.getElementById('forgot-password-error');
    var successEl = document.getElementById('forgot-password-success');
    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');
    var result = await _supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (result.error) {
      errorEl.textContent = result.error.message;
      errorEl.classList.remove('hidden');
      return;
    }
    successEl.textContent = 'Reset link sent \u2014 check your email.';
    successEl.classList.remove('hidden');
  });

  document.getElementById('set-password-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var password = document.getElementById('new-password').value;
    var confirm = document.getElementById('confirm-password').value;
    var errorEl = document.getElementById('set-password-error');
    errorEl.classList.add('hidden');
    if (password !== confirm) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.classList.remove('hidden');
      return;
    }
    var result = await _supabaseClient.auth.updateUser({ password: password });
    if (result.error) {
      errorEl.textContent = result.error.message;
      errorEl.classList.remove('hidden');
      return;
    }
    history.replaceState(null, '', window.location.pathname);
    var sessionResult = await _supabaseClient.auth.getSession();
    if (sessionResult.data.session) {
      _showApp(sessionResult.data.session);
    }
  });

  initAuth();

  // Search placeholder cycling
  var hints = [
    'Search clients...',
    'Search leads...',
    'Search activity...',
    'Search messages...',
    'Search deals...',
    'Search invoices...',
    'Search reminders...',
    'Search notes...',
  ];
  var idx = 0;
  var active = 0;
  var slots = [document.getElementById('ph-a'), document.getElementById('ph-b')];
  var wrap = document.getElementById('search-ph-wrap');
  var input = document.getElementById('main-search');

  slots[0].textContent = hints[0];
  slots[1].textContent = hints[1];

  input.addEventListener('focus', function() { wrap.style.opacity = '0'; });
  input.addEventListener('blur',  function() { if (!input.value) wrap.style.opacity = '1'; });
  input.addEventListener('input', function() { wrap.style.opacity = input.value ? '0' : '1'; });

  function cycle() {
    if (document.activeElement === input || input.value) return;
    var next = 1 - active;
    var nextIdx = (idx + 1) % hints.length;
    slots[next].textContent = hints[nextIdx];
    slots[active].style.opacity = '0';
    slots[next].style.opacity = '1';
    active = next;
    idx = nextIdx;
  }

  setInterval(cycle, 2800);

  // Date pickers
  _initDatePickers();

  // Dashboard view toggle
  var btnDashList = document.getElementById('dash-view-list');
  var btnDashGrid = document.getElementById('dash-view-grid');
  console.log('toggle buttons found:', btnDashList, btnDashGrid);
  if (btnDashList) btnDashList.addEventListener('click', function() { toggleDashView('list'); });
  if (btnDashGrid) btnDashGrid.addEventListener('click', function() { toggleDashView('grid'); });
});
