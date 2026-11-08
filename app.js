(function () {
  'use strict';

  let isRendered = true;
  let activeFilter = 'all';
  let searchQuery = '';

  const grid = document.getElementById('token-grid');
  const masterToggle = document.getElementById('master-toggle');
  const toggleLabel = document.getElementById('toggle-label');
  const floatingBtn = document.getElementById('floating-toggle-btn');
  const fabLabel = document.getElementById('fab-label');
  const searchInput = document.getElementById('search-input');
  const filterBtns = document.querySelectorAll('.filter-btn');
  const visibleCountEl = document.getElementById('visible-count');

  function escapeHtml(str) {
    if (typeof str !== 'string') str = String(str);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getTokenType(t) {
    if (t.startsWith('<') && t.endsWith('>')) return 'angle';
    if (t.startsWith('[') && t.endsWith(']')) return 'square';
    if (t.startsWith('(') && t.endsWith(')')) return 'paren';
    return 'other';
  }

  function renderGrid() {
    grid.innerHTML = '';
    let visible = 0;
    const frag = document.createDocumentFragment();

    (window.ALL_TOKENS || []).forEach((token, idx) => {
      const type = getTokenType(token);

      if (activeFilter !== 'all' && activeFilter !== type) return;
      if (searchQuery && !token.toLowerCase().includes(searchQuery)) return;

      visible++;

      const card = document.createElement('div');
      card.className = 'token-card';
      card.setAttribute('data-token-type', type);

      let badgeClass = 'badge-square';
      let tagText = 'Square []';
      if (type === 'angle') {
        badgeClass = 'badge-angle';
        tagText = 'Angled <>';
      } else if (type === 'paren') {
        badgeClass = 'badge-paren';
        tagText = 'Round ()';
      }

      card.innerHTML = `
        <div class="card-meta">
          <span class="token-index">#${idx + 1}</span>
          <span class="badge-pill ${badgeClass}">${tagText}</span>
        </div>
        <div class="token-target-area" data-instruction="true">${escapeHtml(token)}</div>
        <div class="raw-preview">${escapeHtml(token)}</div>
      `;

      frag.appendChild(card);
    });

    grid.appendChild(frag);
    if (visibleCountEl) visibleCountEl.textContent = visible;
  }

  function updateToggleState(enabled) {
    isRendered = enabled;
    try {
      localStorage.setItem('aifx_enabled', String(isRendered));
    } catch (e) {}

    if (isRendered) {
      document.documentElement.classList.remove('aifx-disabled');
      if (masterToggle) masterToggle.classList.remove('extension-disabled');
      if (toggleLabel) toggleLabel.textContent = 'Rendered Mode';
      if (floatingBtn) floatingBtn.classList.remove('fab-disabled');
      if (fabLabel) fabLabel.textContent = 'Rendered Mode';
    } else {
      document.documentElement.classList.add('aifx-disabled');
      if (masterToggle) masterToggle.classList.add('extension-disabled');
      if (toggleLabel) toggleLabel.textContent = 'Extension Disabled';
      if (floatingBtn) floatingBtn.classList.add('fab-disabled');
      if (fabLabel) fabLabel.textContent = 'Extension Disabled';
    }

    const aifxBtn = document.getElementById('aifx-toggle-container');
    if (aifxBtn) {
      if (isRendered) {
        aifxBtn.classList.remove('aifx-off');
        aifxBtn.setAttribute('title', 'Disable block graphics');
      } else {
        aifxBtn.classList.add('aifx-off');
        aifxBtn.setAttribute('title', 'Enable block graphics');
      }
    }
  }

  if (masterToggle) {
    masterToggle.addEventListener('click', () => updateToggleState(!isRendered));
  }
  if (floatingBtn) {
    floatingBtn.addEventListener('click', () => updateToggleState(!isRendered));
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.getAttribute('data-filter');
      renderGrid();
    });
  });

  let debounceTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        searchQuery = (e.target.value || '').toLowerCase().trim();
        renderGrid();
      }, 150);
    });
  }

  try {
    const saved = localStorage.getItem('aifx_enabled');
    if (saved !== null) {
      isRendered = (saved === 'true');
    }
  } catch (e) {}

  updateToggleState(isRendered);
  renderGrid();
})();
