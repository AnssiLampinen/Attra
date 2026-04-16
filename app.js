// ---- Globals ----
var _userName = '';
var _supabaseClient = null;
var _authToken = null;
var _settings = { hide_personal_contacts: false, voice_note_append_to_notes: true };
var _searchSelectedIdx = -1;
var _leadsById = {};
var _customerTagsByLeadId = {};
var _tenantTags = [];
var _clientModalTagIds = [];
var _clientModalPinned = false;
var _clientModalEvents = [];
var _fpDealDate = null;
var _fpEventDate = null;
var _fpEventTime = null;
var _dealsById = {};
var _typewriterTimer = null;
var _dashView = 'grid';
var _filterQuery = '';
var _filterStatuses = [];
var _filterTagIds = [];

// ---- API helper ----
function _apiFetch(method, url, body) {
  var opts = { method: method, headers: { 'Authorization': 'Bearer ' + _authToken } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(url, opts);
}

// ---- Dashboard view toggle ----
function toggleDashView(mode) {
  _dashView = mode;
  var listWrap = document.getElementById('dashboard-list-wrap');
  var gridWrap = document.getElementById('dashboard-grid-rows');
  var btnList = document.getElementById('dash-view-list');
  var btnGrid = document.getElementById('dash-view-grid');
  if (mode === 'grid') {
    if (listWrap) listWrap.style.display = 'none';
    if (gridWrap) gridWrap.style.display = 'grid';
    if (btnGrid) {
      btnGrid.classList.add('bg-surface-container-lowest', 'shadow-sm', 'text-primary');
      btnGrid.classList.remove('text-secondary');
    }
    if (btnList) {
      btnList.classList.remove('bg-surface-container-lowest', 'shadow-sm', 'text-primary');
      btnList.classList.add('text-secondary');
    }
  } else {
    if (gridWrap) gridWrap.style.display = 'none';
    if (listWrap) listWrap.style.display = '';
    if (btnList) {
      btnList.classList.add('bg-surface-container-lowest', 'shadow-sm', 'text-primary');
      btnList.classList.remove('text-secondary');
    }
    if (btnGrid) {
      btnGrid.classList.remove('bg-surface-container-lowest', 'shadow-sm', 'text-primary');
      btnGrid.classList.add('text-secondary');
    }
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
  document.body.classList.remove('auth-mode');

  var nameEl = document.getElementById('settings-name');
  var displayEl = document.getElementById('profile-display-name');
  var emailEl = document.getElementById('settings-email');
  var sigEl = document.getElementById('settings-signature');
  if (nameEl) nameEl.value = _userName;
  if (displayEl) displayEl.textContent = _userName;
  if (emailEl) emailEl.value = session.user.email || '';
  if (sigEl && !sigEl.value) sigEl.value = 'Best, ' + _userName + ' - ATTRA';

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
      document.body.classList.add('auth-mode');
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
  if (!el || !cursor || !subtitle) return;
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
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  var page = document.getElementById(pageId);
  if (page) page.classList.add('active');
  document.querySelectorAll('.nav-link').forEach(function(a) {
    a.classList.remove('text-[#0058be]', 'bg-[#ffffff]/60', 'translate-x-1', 'shadow-sm');
    a.classList.add('text-[#495e8a]');
    var icon = a.querySelector('.material-symbols-outlined');
    if (icon) icon.style.fontVariationSettings = "'FILL' 0";
  });
  var activeDesktop = document.querySelector('.nav-link[data-page="' + pageId + '"]');
  if (activeDesktop) {
    activeDesktop.classList.add('text-[#0058be]', 'bg-[#ffffff]/60', 'translate-x-1', 'shadow-sm');
    activeDesktop.classList.remove('text-[#495e8a]');
    var desktopIcon = activeDesktop.querySelector('.material-symbols-outlined');
    if (desktopIcon) desktopIcon.style.fontVariationSettings = "'FILL' 1";
  }
  document.querySelectorAll('.mobile-nav-btn').forEach(function(btn) {
    btn.classList.remove('text-[#0058be]', 'bg-[#0058be]/10', 'scale-95');
    btn.classList.add('text-[#495e8a]');
    var mobileIcon = btn.querySelector('.material-symbols-outlined');
    if (mobileIcon) mobileIcon.style.fontVariationSettings = "'FILL' 0";
  });
  var activeMobile = document.querySelector('.mobile-nav-btn[data-mobile-page="' + pageId + '"]');
  if (activeMobile) {
    activeMobile.classList.add('text-[#0058be]', 'bg-[#0058be]/10', 'scale-95');
    activeMobile.classList.remove('text-[#495e8a]');
    var mobileActiveIcon = activeMobile.querySelector('.material-symbols-outlined');
    if (mobileActiveIcon) mobileActiveIcon.style.fontVariationSettings = "'FILL' 1";
  }
  if (pageId === 'page-home') startTypewriter();
  if (pageId === 'page-settings') loadTagSettings();
}

function showClientDetail(id) {
  document.getElementById('clients-grid').classList.add('hidden');
  document.querySelectorAll('.client-detail').forEach(function(d) { d.classList.add('hidden'); });
  document.getElementById(id).classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeClientDetail() {
  document.querySelectorAll('.client-detail').forEach(function(d) { d.classList.add('hidden'); });
  document.getElementById('clients-grid').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Settings ----
async function loadSettings() {
  try {
    var res = await _apiFetch('GET', '/api/settings');
    if (!res.ok) return;
    var data = await res.json();
    _settings = data;
    var btn = document.getElementById('toggle-hide-personal-contacts');
    if (btn) _applyToggleState(btn, !!data.hide_personal_contacts);
    var vnBtn = document.getElementById('toggle-voice-note-append');
    if (vnBtn) _applyToggleState(vnBtn, data.voice_note_append_to_notes !== false);
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
  var knob = btn.querySelector('span');
  if (knob) knob.classList.toggle('translate-x-5', on);
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
    await _apiFetch('PATCH', '/api/settings', { [key]: newVal });
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
    var p = b.querySelector('p');
    if (p) {
      p.classList.remove('text-primary');
      p.classList.add('text-secondary');
    }
  });
  btn.classList.add('border-primary', 'bg-primary/5');
  btn.classList.remove('border-outline-variant/20');
  var label = btn.querySelector('p');
  if (label) {
    label.classList.add('text-primary');
    label.classList.remove('text-secondary');
  }
  document.documentElement.className = theme;
}

function updateName(val) {
  if (!val.trim()) return;
  _userName = val.trim();
  var displayEl = document.getElementById('profile-display-name');
  if (displayEl) displayEl.textContent = _userName;
}

async function saveProfileSettings() {
  var name = (document.getElementById('settings-name').value || '').trim();
  var beeperName = (document.getElementById('settings-beeper-name').value || '').trim();
  var msgEl = document.getElementById('settings-profile-msg');
  if (!name) {
    if (msgEl) msgEl.textContent = 'Display name cannot be empty.';
    return;
  }
  _userName = name;
  var displayEl = document.getElementById('profile-display-name');
  if (displayEl) displayEl.textContent = _userName;
  if (msgEl) msgEl.textContent = 'Saving...';
  try {
    var payload = { display_name: _userName };
    if (beeperName) payload.username = beeperName;
    var res = await _apiFetch('PATCH', '/api/settings', payload);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (msgEl) {
      msgEl.textContent = 'Saved.';
      setTimeout(function() { msgEl.textContent = ''; }, 2000);
    }
    startTypewriter();
  } catch (e) {
    if (msgEl) msgEl.textContent = 'Error: ' + e.message;
  }
}

// ---- Global event listeners ----
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { closeDealModal(); closeClientModal(); closeMergePicker(); closeFeedbackModal(); closeSearch(); }
});

document.addEventListener('click', function(e) {
  var wrapper = document.getElementById('search-wrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    document.getElementById('search-results').classList.add('hidden');
    _searchSelectedIdx = -1;
  }
});

document.addEventListener('DOMContentLoaded', function() {
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
    successEl.textContent = 'Reset link sent - check your email.';
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

  if (slots[0]) slots[0].textContent = hints[0];
  if (slots[1]) slots[1].textContent = hints[1];

  if (input && wrap) {
    input.addEventListener('focus', function() { wrap.style.opacity = '0'; });
    input.addEventListener('blur', function() { if (!input.value) wrap.style.opacity = '1'; });
    input.addEventListener('input', function() { wrap.style.opacity = input.value ? '0' : '1'; });
  }

  function cycle() {
    if (!input || document.activeElement === input || input.value) return;
    var next = 1 - active;
    var nextIdx = (idx + 1) % hints.length;
    if (slots[next]) slots[next].textContent = hints[nextIdx];
    if (slots[active]) slots[active].style.opacity = '0';
    if (slots[next]) slots[next].style.opacity = '1';
    active = next;
    idx = nextIdx;
  }

  setInterval(cycle, 2800);
  _initDatePickers();
  var btnDashList = document.getElementById('dash-view-list');
  var btnDashGrid = document.getElementById('dash-view-grid');
  if (btnDashList) btnDashList.addEventListener('click', function() { toggleDashView('list'); });
  if (btnDashGrid) btnDashGrid.addEventListener('click', function() { toggleDashView('grid'); });
});

// ── Tooltip ───────────────────────────────────────────────────────────────────
(function() {
  var tip = document.getElementById('tooltip');
  if (!tip) return;
  var _timer = null;
  var DELAY = 600; // ms before showing

  function show(text, target) {
    tip.textContent = text;
    tip.style.opacity = '0';
    tip.style.display = 'block';

    var rect = target.getBoundingClientRect();
    var tw = tip.offsetWidth;
    var th = tip.offsetHeight;
    var margin = 6;

    // Prefer below, fall back to above
    var top = rect.bottom + margin;
    if (top + th > window.innerHeight - 8) top = rect.top - th - margin;

    // Prefer centred on target, clamp to viewport
    var left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));

    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
    tip.style.opacity = '1';
  }

  function hide() {
    clearTimeout(_timer);
    _timer = null;
    tip.style.opacity = '0';
  }

  document.addEventListener('mouseover', function(e) {
    var el = e.target.closest('[title]');
    if (!el) return;
    var text = el.getAttribute('title');
    if (!text) return;
    // Swap title → data-tooltip so browser native tooltip doesn't also appear
    el.setAttribute('data-tooltip', text);
    el.removeAttribute('title');
    clearTimeout(_timer);
    _timer = setTimeout(function() { show(text, el); }, DELAY);
  });

  document.addEventListener('mouseout', function(e) {
    var el = e.target.closest('[data-tooltip]');
    if (!el) return;
    // Restore title so it's available next hover
    el.setAttribute('title', el.getAttribute('data-tooltip'));
    el.removeAttribute('data-tooltip');
    hide();
  });

  // Hide immediately on click or scroll
  document.addEventListener('click', hide, true);
  document.addEventListener('scroll', hide, true);
})();
