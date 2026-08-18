let state = { projects: [] };
let activeProjectId = null;
let editingTodoId = null;
let editingProjectMode = null; // 'new' | 'edit'
let activeCategoryId = 'all';
let activeStatusFilter = 'all';
let activeCreatorFilter = 'all';
let viewMode = 'list'; // 'list' | 'kanban'
let currentSubtasks = [];
let lastSyncedJson = null;
let syncInterval = null;
let saveInFlight = false;
let pendingSave = false;

const STATUS_LABELS = {
  offen: 'Offen',
  in_arbeit: 'In Arbeit',
  zu_testen: 'Zu testen',
  fertig: 'Fertig',
};

const STATUS_ORDER = { offen: 0, in_arbeit: 1, zu_testen: 2, fertig: 3 };

const STORAGE_KEY = 'claude_dashboard_data';
const THEME_KEY = 'claude_dashboard_theme';
const USER_KEY = 'claude_dashboard_user';
const USERS = ['Alex', 'Danijel', 'Michele'];
let currentUser = null;

function normalizeState(data) {
  const s = data && data.projects ? data : { projects: [] };
  s.projects.forEach(p => {
    if (!p.categories) p.categories = [];
    p.categories.sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
    if (!p.activityLog) p.activityLog = [];
    p.todos.forEach(t => {
      if (t.categoryId === undefined) t.categoryId = null;
      if (!t.subtasks) t.subtasks = [];
    });
  });
  return s;
}

async function loadData() {
  try {
    const res = await fetch('/api/data');
    const data = await res.json();
    state = normalizeState(data);
    lastSyncedJson = JSON.stringify(state);
  } catch (err) {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = normalizeState(raw ? JSON.parse(raw) : { projects: [] });
    updateSyncStatus('Server nicht erreichbar – lokale Kopie geladen', 'error');
  }
  if (state.projects.length && !activeProjectId) {
    activeProjectId = state.projects[0].id;
  }
  render();
}

async function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (saveInFlight) { pendingSave = true; return; }
  saveInFlight = true;
  try {
    const json = JSON.stringify(state);
    await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    });
    lastSyncedJson = json;
    updateSyncStatus('Zentral gespeichert', 'connected');
  } catch (err) {
    updateSyncStatus('Fehler beim Speichern auf dem Server', 'error');
  } finally {
    saveInFlight = false;
    if (pendingSave) { pendingSave = false; saveData(); }
  }
}

function updateSyncStatus(text, cls) {
  const el = document.getElementById('team-sync-status');
  if (!el) return;
  el.className = 'team-sync-status' + (cls ? ' ' + cls : '');
  el.innerHTML = `<span class="status-dot"></span>${escapeHtml(text)}`;
}

async function pollServerData() {
  try {
    const res = await fetch('/api/data');
    const data = await res.json();
    const json = JSON.stringify(data);
    if (json === lastSyncedJson) return;
    state = normalizeState(data);
    lastSyncedJson = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!state.projects.find(p => p.id === activeProjectId)) {
      activeProjectId = state.projects.length ? state.projects[0].id : null;
    }
    render();
    updateSyncStatus('Zentral gespeichert', 'connected');
  } catch (err) {
    updateSyncStatus('Server nicht erreichbar', 'error');
  }
}

function startServerSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(pollServerData, 5000);
  window.addEventListener('focus', pollServerData);
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `dashboard-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[";\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportProjectToExcel() {
  const project = getActiveProject();
  if (!project) return;
  const todos = sortTodos(getFilteredTodos(project, { applyStatusFilter: false }));
  const header = ['Titel', 'Beschreibung', 'Status', 'Kategorie', 'Teilaufgaben', 'Erstellt am', 'Erstellt von'];
  const rows = todos.map(t => {
    const category = project.categories.find(c => c.id === t.categoryId);
    const subtasks = (t.subtasks || []).map(s => `${s.done ? '[x]' : '[ ]'} ${s.title}`).join(' | ');
    return [
      t.title,
      t.description || '',
      STATUS_LABELS[t.status] || t.status,
      category ? category.name : '',
      subtasks,
      t.createdAt ? new Date(t.createdAt).toLocaleDateString('de-DE') : '',
      t.createdBy || '',
    ];
  });
  const lines = [header, ...rows].map(row => row.map(csvEscape).join(';'));
  const csv = '﻿' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${project.name}-todos-${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!imported.projects) throw new Error('Ungültiges Format');
      if (!confirm('Aktuelle Daten werden durch die importierte Datei ersetzt. Fortfahren?')) return;
      state = imported;
      activeProjectId = state.projects.length ? state.projects[0].id : null;
      saveData();
      loadData();
    } catch (err) {
      alert('Import fehlgeschlagen: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getActiveProject() {
  return state.projects.find(p => p.id === activeProjectId);
}

function logActivity(project, message) {
  project.activityLog.unshift({ id: uid(), message, timestamp: Date.now() });
  if (project.activityLog.length > 200) project.activityLog.length = 200;
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---- User ----

function initUser() {
  const saved = localStorage.getItem(USER_KEY);
  if (saved && USERS.includes(saved)) {
    currentUser = saved;
    updateCurrentUserLabel();
  } else {
    openUserSelectModal();
  }
}

function updateCurrentUserLabel() {
  document.getElementById('current-user-label').textContent = currentUser ? `Angemeldet als: ${currentUser}` : 'Nicht angemeldet';
}

function openUserSelectModal() {
  const list = document.getElementById('user-select-list');
  list.innerHTML = '';
  USERS.forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary btn-block';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      currentUser = name;
      localStorage.setItem(USER_KEY, name);
      updateCurrentUserLabel();
      document.getElementById('user-select-modal').hidden = true;
    });
    list.appendChild(btn);
  });
  document.getElementById('user-select-modal').hidden = false;
}

// ---- Theme ----

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-toggle-btn').textContent = theme === 'light' ? '☀️' : '🌙';
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

// ---- Render ----

function render() {
  renderProjectList();
  const project = getActiveProject();
  document.getElementById('empty-state').hidden = !!project;
  document.getElementById('project-view').hidden = !project;
  if (project) renderProjectView(project);
}

function renderProjectList() {
  const list = document.getElementById('project-list');
  list.innerHTML = '';
  state.projects.forEach(p => {
    const total = p.todos.length;
    const done = p.todos.filter(t => t.status === 'fertig').length;
    const div = document.createElement('div');
    div.className = 'project-item' + (p.id === activeProjectId ? ' active' : '');
    div.innerHTML = `
      <div class="project-item-name">${escapeHtml(p.name)}</div>
      <div class="project-item-progress">${done}/${total} erledigt</div>
    `;
    div.addEventListener('click', () => {
      activeProjectId = p.id;
      activeCategoryId = 'all';
      activeStatusFilter = 'all';
      activeCreatorFilter = 'all';
      document.getElementById('todo-search-input').value = '';
      render();
    });
    list.appendChild(div);
  });
}

function renderProjectView(project) {
  document.getElementById('project-name').textContent = project.name;
  document.getElementById('project-path').textContent = project.path || '';

  const total = project.todos.length;
  const done = project.todos.filter(t => t.status === 'fertig').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-text').textContent = `${done}/${total} erledigt (${pct}%)`;

  renderCategoryTabs(project);
  renderStatusFilter(project);
  renderCreatorFilter(project);

  document.getElementById('todo-list').hidden = viewMode !== 'list';
  document.getElementById('kanban-board').hidden = viewMode !== 'kanban';

  if (viewMode === 'kanban') {
    document.getElementById('todo-list').innerHTML = '';
    renderKanbanBoard(project);
  } else {
    document.getElementById('kanban-board').innerHTML = '';
    renderTodoList(project);
  }
}

function renderCategoryTabs(project) {
  const wrap = document.getElementById('category-tabs');
  wrap.innerHTML = '';

  const allTab = document.createElement('button');
  allTab.className = 'category-tab' + (activeCategoryId === 'all' ? ' active' : '');
  allTab.textContent = 'Alle';
  allTab.addEventListener('click', () => { activeCategoryId = 'all'; render(); });
  wrap.appendChild(allTab);

  project.categories.forEach(cat => {
    const tab = document.createElement('button');
    tab.className = 'category-tab' + (activeCategoryId === cat.id ? ' active' : '');
    tab.textContent = cat.name;
    tab.addEventListener('click', () => { activeCategoryId = cat.id; render(); });
    wrap.appendChild(tab);
  });
}

function renderStatusFilter(project) {
  const wrap = document.getElementById('status-filter');
  wrap.innerHTML = '';

  const counts = { all: project.todos.length };
  Object.keys(STATUS_LABELS).forEach(k => { counts[k] = project.todos.filter(t => t.status === k).length; });

  const allBtn = document.createElement('button');
  allBtn.className = 'status-filter-btn' + (activeStatusFilter === 'all' ? ' active' : '');
  allBtn.innerHTML = `Alle Status <span>${counts.all}</span>`;
  allBtn.addEventListener('click', () => { activeStatusFilter = 'all'; render(); });
  wrap.appendChild(allBtn);

  Object.entries(STATUS_LABELS).forEach(([key, label]) => {
    const btn = document.createElement('button');
    btn.className = 'status-filter-btn' + (activeStatusFilter === key ? ' active' : '');
    btn.innerHTML = `<span class="status-dot ${key}"></span>${label} <span>${counts[key]}</span>`;
    btn.addEventListener('click', () => { activeStatusFilter = key; render(); });
    wrap.appendChild(btn);
  });
}

function renderCreatorFilter(project) {
  const wrap = document.getElementById('creator-filter');
  wrap.innerHTML = '';

  const creatorKey = t => t.createdBy || 'unbekannt';
  const counts = { all: project.todos.length };
  USERS.forEach(u => { counts[u] = project.todos.filter(t => creatorKey(t) === u).length; });
  counts.unbekannt = project.todos.filter(t => creatorKey(t) === 'unbekannt').length;

  const allBtn = document.createElement('button');
  allBtn.className = 'status-filter-btn' + (activeCreatorFilter === 'all' ? ' active' : '');
  allBtn.innerHTML = `Alle Ersteller <span>${counts.all}</span>`;
  allBtn.addEventListener('click', () => { activeCreatorFilter = 'all'; render(); });
  wrap.appendChild(allBtn);

  [...USERS, 'unbekannt'].forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'status-filter-btn' + (activeCreatorFilter === name ? ' active' : '');
    btn.innerHTML = `${name === 'unbekannt' ? 'Unbekannt' : escapeHtml(name)} <span>${counts[name]}</span>`;
    btn.addEventListener('click', () => { activeCreatorFilter = name; render(); });
    wrap.appendChild(btn);
  });
}

function getFilteredTodos(project, { applyStatusFilter } = { applyStatusFilter: true }) {
  const searchQuery = document.getElementById('todo-search-input').value.trim().toLowerCase();

  let todos = [...project.todos];

  if (activeCategoryId !== 'all') todos = todos.filter(t => t.categoryId === activeCategoryId);
  if (applyStatusFilter && activeStatusFilter !== 'all') todos = todos.filter(t => t.status === activeStatusFilter);
  if (activeCreatorFilter !== 'all') todos = todos.filter(t => (t.createdBy || 'unbekannt') === activeCreatorFilter);
  if (searchQuery) {
    todos = todos.filter(t =>
      t.title.toLowerCase().includes(searchQuery) ||
      (t.description || '').toLowerCase().includes(searchQuery)
    );
  }
  return todos;
}

function sortTodos(todos) {
  const sortBy = document.getElementById('sort-by').value;
  todos.sort((a, b) => {
    if (sortBy === 'created_desc') return b.createdAt - a.createdAt;
    if (sortBy === 'created_asc') return a.createdAt - b.createdAt;
    if (sortBy === 'status') return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    return 0;
  });
  return todos;
}

function subtaskBadge(t) {
  if (!t.subtasks || !t.subtasks.length) return '';
  const done = t.subtasks.filter(s => s.done).length;
  return `<span class="subtask-progress">☑ ${done}/${t.subtasks.length}</span>`;
}

function ageBadge(t) {
  if (!t.createdAt) return '';
  const days = Math.floor((Date.now() - t.createdAt) / (1000 * 60 * 60 * 24));
  const createdLabel = new Date(t.createdAt).toLocaleDateString('de-DE');
  if (t.status === 'fertig') {
    return `<span class="badge badge-age" title="Erstellt am ${createdLabel}">${createdLabel}</span>`;
  }
  let level = 'age-ok';
  if (days >= 14) level = 'age-critical';
  else if (days >= 7) level = 'age-warn';
  const dayLabel = days === 0 ? 'heute erstellt' : days === 1 ? 'seit 1 Tag offen' : `seit ${days} Tagen offen`;
  return `<span class="badge badge-age ${level}" title="Erstellt am ${createdLabel}">${dayLabel}</span>`;
}

function renderTodoList(project) {
  const todos = sortTodos(getFilteredTodos(project));

  const container = document.getElementById('todo-list');
  container.innerHTML = '';

  if (!todos.length) {
    container.innerHTML = '<p style="color: var(--text-dim)">Keine ToDos gefunden.</p>';
    return;
  }

  todos.forEach(t => {
    const category = project.categories.find(c => c.id === t.categoryId);
    const card = document.createElement('div');
    card.className = 'todo-card' + (t.status === 'fertig' ? ' fertig' : '');
    card.dataset.status = t.status;
    card.innerHTML = `
      <div class="todo-main">
        <div class="todo-title-row">
          <span class="todo-title">${escapeHtml(t.title)}</span>
          ${category ? `<span class="badge badge-category">${escapeHtml(category.name)}</span>` : ''}
          ${t.createdBy ? `<span class="badge badge-creator">${escapeHtml(t.createdBy)}</span>` : ''}
          ${ageBadge(t)}
          ${subtaskBadge(t)}
        </div>
        ${t.description ? `<p class="todo-desc">${escapeHtml(t.description)}</p>` : ''}
      </div>
      <div class="todo-actions">
        <select class="status-select status-${t.status}" data-id="${t.id}">
          ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <button class="icon-btn edit-todo-btn" data-id="${t.id}" title="Bearbeiten">✎</button>
        <button class="icon-btn delete-todo-btn" data-id="${t.id}" title="Löschen">🗑</button>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', e => {
      const todo = project.todos.find(t => t.id === e.target.dataset.id);
      const oldStatus = todo.status;
      todo.status = e.target.value;
      logActivity(project, `Status von "${todo.title}" geändert: ${STATUS_LABELS[oldStatus]} → ${STATUS_LABELS[todo.status]}`);
      saveData();
      render();
    });
  });

  container.querySelectorAll('.edit-todo-btn').forEach(btn => {
    btn.addEventListener('click', () => openTodoModal('edit', btn.dataset.id));
  });

  container.querySelectorAll('.delete-todo-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteTodo(project, btn.dataset.id));
  });
}

function deleteTodo(project, todoId) {
  const todo = project.todos.find(t => t.id === todoId);
  if (!todo) return;
  if (confirm('ToDo wirklich löschen?')) {
    logActivity(project, `ToDo gelöscht: "${todo.title}"`);
    project.todos = project.todos.filter(t => t.id !== todoId);
    saveData();
    render();
  }
}

// ---- Kanban ----

function renderKanbanBoard(project) {
  const todos = getFilteredTodos(project, { applyStatusFilter: false });
  const board = document.getElementById('kanban-board');
  board.innerHTML = '';

  Object.entries(STATUS_LABELS).forEach(([statusKey, label]) => {
    const column = document.createElement('div');
    column.className = 'kanban-column';
    column.dataset.status = statusKey;

    const columnTodos = todos.filter(t => t.status === statusKey);

    column.innerHTML = `
      <div class="kanban-column-title">
        <span class="kanban-column-title-label"><span class="status-dot ${statusKey}"></span>${label}</span>
        <span>${columnTodos.length}</span>
      </div>
      <div class="kanban-cards" data-status="${statusKey}"></div>
    `;
    board.appendChild(column);

    const cardsWrap = column.querySelector('.kanban-cards');

    columnTodos.forEach(t => {
      const category = project.categories.find(c => c.id === t.categoryId);
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.draggable = true;
      card.dataset.id = t.id;
      card.dataset.status = t.status;
      card.innerHTML = `
        <div class="kanban-card-title">${escapeHtml(t.title)}</div>
        <div class="kanban-card-meta">
          ${category ? `<span class="badge badge-category">${escapeHtml(category.name)}</span>` : ''}
          ${t.createdBy ? `<span class="badge badge-creator">${escapeHtml(t.createdBy)}</span>` : ''}
          ${ageBadge(t)}
          ${subtaskBadge(t)}
        </div>
        <div class="kanban-card-actions">
          <button class="icon-btn edit-todo-btn" data-id="${t.id}" title="Bearbeiten">✎</button>
          <button class="icon-btn delete-todo-btn" data-id="${t.id}" title="Löschen">🗑</button>
        </div>
      `;
      cardsWrap.appendChild(card);

      card.addEventListener('dragstart', e => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', t.id);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));

      card.querySelector('.edit-todo-btn').addEventListener('click', () => openTodoModal('edit', t.id));
      card.querySelector('.delete-todo-btn').addEventListener('click', () => deleteTodo(project, t.id));
    });

    column.addEventListener('dragover', e => {
      e.preventDefault();
      column.classList.add('drag-over');
    });
    column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
    column.addEventListener('drop', e => {
      e.preventDefault();
      column.classList.remove('drag-over');
      const todoId = e.dataTransfer.getData('text/plain');
      const todo = project.todos.find(t => t.id === todoId);
      if (!todo || todo.status === statusKey) return;
      const oldStatus = todo.status;
      todo.status = statusKey;
      logActivity(project, `Status von "${todo.title}" geändert: ${STATUS_LABELS[oldStatus]} → ${STATUS_LABELS[statusKey]}`);
      saveData();
      render();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Global Search ----

function renderSearchResults(query) {
  const resultsBox = document.getElementById('search-results');
  if (!query) {
    resultsBox.hidden = true;
    resultsBox.innerHTML = '';
    return;
  }

  const q = query.toLowerCase();
  const matches = [];
  state.projects.forEach(p => {
    p.todos.forEach(t => {
      if (t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)) {
        matches.push({ project: p, todo: t });
      }
    });
  });

  resultsBox.hidden = false;
  if (!matches.length) {
    resultsBox.innerHTML = '<div class="search-result-empty">Keine Treffer.</div>';
    return;
  }

  resultsBox.innerHTML = matches.slice(0, 30).map(m => `
    <div class="search-result-item" data-project-id="${m.project.id}" data-todo-id="${m.todo.id}">
      <div class="search-result-title">${escapeHtml(m.todo.title)}</div>
      <div class="search-result-meta">${escapeHtml(m.project.name)} · ${STATUS_LABELS[m.todo.status]}</div>
    </div>
  `).join('');

  resultsBox.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      activeProjectId = item.dataset.projectId;
      activeCategoryId = 'all';
      activeStatusFilter = 'all';
      viewMode = 'list';
      updateViewToggleButtons();
      document.getElementById('global-search-input').value = '';
      resultsBox.hidden = true;
      render();
      openTodoModal('edit', item.dataset.todoId);
    });
  });
}

// ---- Project Modal ----

function openProjectModal(mode) {
  editingProjectMode = mode;
  const modal = document.getElementById('project-modal');
  const title = document.getElementById('project-modal-title');
  const nameInput = document.getElementById('project-name-input');
  const pathInput = document.getElementById('project-path-input');
  const descInput = document.getElementById('project-desc-input');

  if (mode === 'edit') {
    const p = getActiveProject();
    title.textContent = 'Projekt bearbeiten';
    nameInput.value = p.name;
    pathInput.value = p.path || '';
    descInput.value = p.description || '';
  } else {
    title.textContent = 'Neues Projekt';
    nameInput.value = '';
    pathInput.value = '';
    descInput.value = '';
  }
  modal.hidden = false;
  nameInput.focus();
}

function closeProjectModal() {
  document.getElementById('project-modal').hidden = true;
}

function saveProjectModal() {
  const name = document.getElementById('project-name-input').value.trim();
  if (!name) { alert('Bitte einen Projektnamen eingeben.'); return; }
  const path = document.getElementById('project-path-input').value.trim();
  const description = document.getElementById('project-desc-input').value.trim();

  if (editingProjectMode === 'new') {
    const project = { id: uid(), name, path, description, todos: [], categories: [], activityLog: [] };
    logActivity(project, `Projekt "${name}" angelegt`);
    state.projects.push(project);
    activeProjectId = project.id;
  } else {
    const p = getActiveProject();
    p.name = name;
    p.path = path;
    p.description = description;
  }
  saveData();
  closeProjectModal();
  render();
}

// ---- Todo Modal ----

function openTodoModal(mode, todoId) {
  editingTodoId = mode === 'edit' ? todoId : null;
  const modal = document.getElementById('todo-modal');
  const title = document.getElementById('todo-modal-title');
  const titleInput = document.getElementById('todo-title-input');
  const descInput = document.getElementById('todo-desc-input');
  const statusInput = document.getElementById('todo-status-input');
  const categoryInput = document.getElementById('todo-category-input');
  const project = getActiveProject();

  categoryInput.innerHTML = '<option value="">Keine Kategorie</option>' +
    project.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

  const creatorInput = document.getElementById('todo-creator-input');
  creatorInput.innerHTML = '<option value="">Unbekannt</option>' +
    USERS.map(u => `<option value="${u}">${u}</option>`).join('');

  if (mode === 'edit') {
    const t = project.todos.find(t => t.id === todoId);
    title.textContent = 'ToDo bearbeiten';
    titleInput.value = t.title;
    descInput.value = t.description || '';
    statusInput.value = t.status;
    categoryInput.value = t.categoryId || '';
    creatorInput.value = t.createdBy || '';
    currentSubtasks = (t.subtasks || []).map(s => ({ ...s }));
  } else {
    title.textContent = 'Neues ToDo';
    titleInput.value = '';
    descInput.value = '';
    statusInput.value = 'offen';
    categoryInput.value = activeCategoryId !== 'all' ? activeCategoryId : '';
    creatorInput.value = currentUser || '';
    currentSubtasks = [];
  }
  renderSubtaskList();
  document.getElementById('new-subtask-input').value = '';
  modal.hidden = false;
  titleInput.focus();
}

function closeTodoModal() {
  document.getElementById('todo-modal').hidden = true;
  currentSubtasks = [];
}

function renderSubtaskList() {
  const list = document.getElementById('subtask-list');
  list.innerHTML = '';

  if (!currentSubtasks.length) {
    list.innerHTML = '<p style="color: var(--text-dim); font-size: 13px;">Noch keine Unteraufgaben.</p>';
    return;
  }

  currentSubtasks.forEach(s => {
    const row = document.createElement('div');
    row.className = 'subtask-item' + (s.done ? ' done' : '');
    row.innerHTML = `
      <input type="checkbox" ${s.done ? 'checked' : ''} data-id="${s.id}" class="subtask-toggle">
      <input type="text" value="${escapeHtml(s.title)}" data-id="${s.id}" class="subtask-title-input">
      <button class="icon-btn subtask-delete-btn" data-id="${s.id}" title="Löschen">🗑</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('.subtask-toggle').forEach(cb => {
    cb.addEventListener('change', e => {
      const s = currentSubtasks.find(s => s.id === e.target.dataset.id);
      s.done = e.target.checked;
      renderSubtaskList();
    });
  });

  list.querySelectorAll('.subtask-title-input').forEach(input => {
    input.addEventListener('change', e => {
      const s = currentSubtasks.find(s => s.id === e.target.dataset.id);
      const val = e.target.value.trim();
      if (!val) { e.target.value = s.title; return; }
      s.title = val;
    });
  });

  list.querySelectorAll('.subtask-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSubtasks = currentSubtasks.filter(s => s.id !== btn.dataset.id);
      renderSubtaskList();
    });
  });
}

function addSubtask() {
  const input = document.getElementById('new-subtask-input');
  const title = input.value.trim();
  if (!title) return;
  currentSubtasks.push({ id: uid(), title, done: false });
  input.value = '';
  renderSubtaskList();
  input.focus();
}

function saveTodoModal() {
  const title = document.getElementById('todo-title-input').value.trim();
  if (!title) { alert('Bitte einen Titel eingeben.'); return; }
  const description = document.getElementById('todo-desc-input').value.trim();
  const status = document.getElementById('todo-status-input').value;
  const categoryId = document.getElementById('todo-category-input').value || null;
  const createdBy = document.getElementById('todo-creator-input').value || null;

  const project = getActiveProject();

  if (editingTodoId) {
    const t = project.todos.find(t => t.id === editingTodoId);
    const oldStatus = t.status;
    t.title = title;
    t.description = description;
    t.status = status;
    t.categoryId = categoryId;
    t.createdBy = createdBy;
    t.subtasks = currentSubtasks;
    if (oldStatus !== status) {
      logActivity(project, `Status von "${title}" geändert: ${STATUS_LABELS[oldStatus]} → ${STATUS_LABELS[status]}`);
    } else {
      logActivity(project, `ToDo bearbeitet: "${title}"`);
    }
  } else {
    project.todos.push({
      id: uid(),
      title,
      description,
      status,
      categoryId,
      subtasks: currentSubtasks,
      createdAt: Date.now(),
      createdBy,
    });
    logActivity(project, `ToDo angelegt von ${createdBy || 'Unbekannt'}: "${title}"`);
  }
  saveData();
  closeTodoModal();
  render();
}

// ---- Categories Modal ----

function openCategoriesModal() {
  renderCategoryManageList();
  document.getElementById('new-category-input').value = '';
  document.getElementById('categories-modal').hidden = false;
}

function closeCategoriesModal() {
  document.getElementById('categories-modal').hidden = true;
  render();
}

function renderCategoryManageList() {
  const project = getActiveProject();
  const list = document.getElementById('category-manage-list');
  list.innerHTML = '';

  if (!project.categories.length) {
    list.innerHTML = '<p style="color: var(--text-dim); font-size: 13px;">Noch keine Kategorien angelegt.</p>';
    return;
  }

  project.categories.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'category-manage-item';
    row.innerHTML = `
      <input type="text" value="${escapeHtml(cat.name)}" data-id="${cat.id}">
      <button class="icon-btn delete-category-btn" data-id="${cat.id}" title="Löschen">🗑</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', e => {
      const cat = project.categories.find(c => c.id === e.target.dataset.id);
      const newName = e.target.value.trim();
      if (!newName) { e.target.value = cat.name; return; }
      cat.name = newName;
      saveData();
    });
  });

  list.querySelectorAll('.delete-category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Kategorie löschen? Zugeordnete ToDos verlieren die Kategorie.')) return;
      const catId = btn.dataset.id;
      project.categories = project.categories.filter(c => c.id !== catId);
      project.todos.forEach(t => {
        if (t.categoryId === catId) t.categoryId = null;
      });
      if (activeCategoryId === catId) activeCategoryId = 'all';
      saveData();
      renderCategoryManageList();
    });
  });
}

function addCategory() {
  const input = document.getElementById('new-category-input');
  const name = input.value.trim();
  if (!name) return;
  const project = getActiveProject();
  project.categories.push({ id: uid(), name });
  project.categories.sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
  saveData();
  input.value = '';
  renderCategoryManageList();
}

// ---- Activity Log Modal ----

function openActivityLogModal() {
  const project = getActiveProject();
  const list = document.getElementById('activity-log-list');
  list.innerHTML = '';

  if (!project.activityLog.length) {
    list.innerHTML = '<p class="activity-log-empty">Noch keine Aktivitäten.</p>';
  } else {
    list.innerHTML = project.activityLog.map(entry => `
      <div class="activity-log-item">
        <div class="activity-log-message">${escapeHtml(entry.message)}</div>
        <div class="activity-log-time">${formatTimestamp(entry.timestamp)}</div>
      </div>
    `).join('');
  }

  document.getElementById('activity-log-modal').hidden = false;
}

function closeActivityLogModal() {
  document.getElementById('activity-log-modal').hidden = true;
}

// ---- View toggle ----

function updateViewToggleButtons() {
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewMode);
  });
}

function setViewMode(mode) {
  viewMode = mode;
  updateViewToggleButtons();
  document.getElementById('todo-list').hidden = viewMode !== 'list';
  document.getElementById('kanban-board').hidden = viewMode !== 'kanban';
  render();
}

// ---- Event wiring ----

document.getElementById('add-project-btn').addEventListener('click', () => openProjectModal('new'));
document.getElementById('edit-project-btn').addEventListener('click', () => openProjectModal('edit'));
document.getElementById('project-cancel-btn').addEventListener('click', closeProjectModal);
document.getElementById('project-save-btn').addEventListener('click', saveProjectModal);

document.getElementById('delete-project-btn').addEventListener('click', () => {
  const p = getActiveProject();
  if (!p) return;
  if (confirm(`Projekt "${p.name}" und alle zugehörigen ToDos wirklich löschen?`)) {
    state.projects = state.projects.filter(x => x.id !== p.id);
    activeProjectId = state.projects.length ? state.projects[0].id : null;
    saveData();
    render();
  }
});

document.getElementById('add-todo-btn').addEventListener('click', () => openTodoModal('new'));
document.getElementById('todo-cancel-btn').addEventListener('click', closeTodoModal);
document.getElementById('todo-save-btn').addEventListener('click', saveTodoModal);

document.getElementById('add-subtask-btn').addEventListener('click', addSubtask);
document.getElementById('new-subtask-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addSubtask(); }
});

document.getElementById('manage-categories-btn').addEventListener('click', openCategoriesModal);
document.getElementById('categories-close-btn').addEventListener('click', closeCategoriesModal);
document.getElementById('add-category-btn').addEventListener('click', addCategory);
document.getElementById('new-category-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addCategory(); }
});

document.getElementById('activity-log-btn').addEventListener('click', openActivityLogModal);
document.getElementById('excel-export-btn').addEventListener('click', exportProjectToExcel);
document.getElementById('activity-log-close-btn').addEventListener('click', closeActivityLogModal);

document.getElementById('sort-by').addEventListener('change', render);
document.getElementById('todo-search-input').addEventListener('input', render);

document.getElementById('view-list-btn').addEventListener('click', () => setViewMode('list'));
document.getElementById('view-kanban-btn').addEventListener('click', () => setViewMode('kanban'));

document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);

document.getElementById('global-search-input').addEventListener('input', e => {
  renderSearchResults(e.target.value.trim());
});
document.addEventListener('click', e => {
  const searchInput = document.getElementById('global-search-input');
  const results = document.getElementById('search-results');
  if (!searchInput.contains(e.target) && !results.contains(e.target)) {
    results.hidden = true;
  }
});

document.getElementById('export-btn').addEventListener('click', exportData);
document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});
document.getElementById('import-file-input').addEventListener('change', e => {
  if (e.target.files[0]) importData(e.target.files[0]);
  e.target.value = '';
});

document.getElementById('switch-user-btn').addEventListener('click', openUserSelectModal);

initTheme();
initUser();
loadData().then(startServerSync);
