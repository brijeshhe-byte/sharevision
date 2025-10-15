/* ShareVision Cross-filter (server-side) — v11 (stable)
   - Click a "Contact" cell in Relationships -> types that name into the "Person" filter of
     General Contact and Professional Contact, then presses Enter (server-side filter).
   - Works across paging/sorting (auto-rebind).
   - Tailored to your sections by headers and page-part anchors (IDs 12618/12619/12620).
*/
(function () {
  const DEBUG = false; // set to true to see console logs
  const IDS = { REL: 12618, GEN: 12619, PROF: 12620 };
  const LAST = 'CF_LAST_PERSON';
  const log = (...a) => DEBUG && console.log('[CF v11]', ...a);
  const norm = s => (s || '').toString().replace(/,+\s*$/,'').trim();

  // ---------- Find the TABLEs within each page-part ----------
  function sectionTables(id) {
    const anchor = document.querySelector(`a[href*="id=${id}"][href*="elem=pagepart"]`);
    if (!anchor) return [];
    const list = [];
    let el = anchor;
    while ((el = el.nextElementSibling)) {
      if (el.matches && el.matches('a[href*="elem=pagepart"]')) break; // reached next section
      if (el.tagName === 'TABLE') list.push(el);
    }
    return list;
  }

  function headerTexts(table, headerRows = 2) {
    if (!table) return [];
    const trs = table.querySelectorAll('tr');
    const out = [];
    for (let i = 0; i < Math.min(trs.length, headerRows); i++) {
      trs[i].querySelectorAll('th').forEach(th => out.push(th.textContent.trim()));
    }
    return out;
  }

  // Score to pick the DATA table (avoid the small "Contains" table)
  function scoreRel(h) {
    let s = 0;
    if (h.includes('Contains')) s -= 5;
    if (h.includes('Individual')) s += 1;
    if (h.includes('Contact')) s += 4;
    if (h.join('|').match(/Relationship to Individual/i)) s += 1;
    return s;
  }
  function scoreGen(h) {
    let s = 0;
    if (h.includes('Contains')) s -= 5;
    if (h.includes('Person')) s += 3;
    if (h.includes('Phone')) s += 1;
    if (h.includes('Mobile Phone')) s += 1;
    if (h.includes('Address')) s += 1;
    if (h.includes('E-Mail') || h.includes('E‑Mail') || h.includes('Email')) s += 1;
    if (h.includes('City')) s += 1;
    if (h.includes('Organization') || h.join('|').match(/Professional Type/i)) s -= 3; // keep General separate
    return s;
  }
  function scoreProf(h) {
    let s = 0;
    if (h.includes('Contains')) s -= 5;
    if (h.includes('Person')) s += 2;
    if (h.includes('Organization')) s += 2;
    if (h.join('|').match(/Professional Type/i)) s += 2;
    return s;
  }

  function pickDataTable(sectionId) {
    const tables = sectionTables(sectionId);
    let best = null, bs = -1;
    const scorer = sectionId === IDS.REL ? scoreRel : sectionId === IDS.GEN ? scoreGen : scoreProf;
    tables.forEach(t => {
      const sc = scorer(headerTexts(t));
      if (sc > bs) { best = t; bs = sc; }
    });
    log('pickDataTable', sectionId, '->', best, 'score', bs);
    return best;
  }

  // Pick the FILTER table (the one with "Contains" cells)
  function pickFilterTable(sectionId) {
    const tables = sectionTables(sectionId);
    let best = null, bs = -1;
    tables.forEach(t => {
      const h = Array.from(t.querySelectorAll('tr th')).map(x => x.textContent.trim());
      let s = 0;
      if (h.some(x => /Contains/i.test(x))) s += 10;
      if (h.includes('Person')) s += 2;
      if (h.includes('Organization') || h.join('|').match(/Professional Type/i)) s += 1;
      if (s > bs) { best = t; bs = s; }
    });
    log('pickFilterTable', sectionId, '->', best, 'score', bs);
    return best;
  }

  function headerIndex(table, headerName) {
    const hs = headerTexts(table, 1).map(x => x.toLowerCase());
    return hs.indexOf(String(headerName).toLowerCase());
  }

  function findPersonFilterInput(filterTable, dataTable) {
    if (!filterTable || !dataTable) return null;
    const col = headerIndex(dataTable, 'Person');
    if (col < 0) return null;
    const rows = Array.from(filterTable.querySelectorAll('tr'));
    const fRow = rows.find(r => /contains/i.test(r.textContent)) || rows[1] || rows[0];
    if (!fRow) return null;
    const cell = fRow.children[col];
    if (!cell) return null;
    return cell.querySelector('input[type="text"],input:not([type]),textarea,select');
  }

  function typeAndSubmit(input, value) {
    if (!input) return false;
    const v = norm(value);
    if (input.tagName === 'SELECT') {
      let ok = false;
      Array.from(input.options).forEach(o => {
        if (o.text.trim().toLowerCase() === v.toLowerCase()) { o.selected = true; ok = true; }
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return ok;
    } else {
      input.focus();
      try { input.select && input.select(); } catch (_) {}
      input.value = v;
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
      input.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
      try { input.blur(); } catch (_) {}
      return true;
    }
  }

  function addClearChip(sectionId, label) {
    const anchor = document.querySelector(`a[href*="id=${sectionId}"][href*="elem=pagepart"]`);
    if (!anchor) return;
    let chip = anchor.parentElement.querySelector('.cf-chip');
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'cf-chip';
      anchor.parentElement.insertBefore(chip, anchor.parentElement.firstChild);
    }
    chip.innerHTML = `Filtered by: <strong>${label}</strong> <button type="button">Clear</button>`;
    chip.querySelector('button').onclick = () => {
      clearServerFilter(sectionId);
      chip.remove();
      if (sessionStorage.getItem(LAST) === label) sessionStorage.removeItem(LAST);
    };
  }

  function applyServerFilter(sectionId, personName) {
    const dt = pickDataTable(sectionId);
    const ft = pickFilterTable(sectionId);
    if (!dt || !ft) { log('applyServerFilter: missing tables for', sectionId); return false; }
    const input = findPersonFilterInput(ft, dt);
    if (!input) { log('applyServerFilter: no filter input for', sectionId); return false; }
    const ok = typeAndSubmit(input, personName);
    log('Applied server filter →', personName, 'section', sectionId, 'ok=', ok);
    return ok;
  }

  function clearServerFilter(sectionId) {
    const dt = pickDataTable(sectionId);
    const ft = pickFilterTable(sectionId);
    if (!dt || !ft) return;
    const input = findPersonFilterInput(ft, dt);
    if (!input) return;
    if (input.tagName === 'SELECT') {
      input.selectedIndex = 0;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      input.value = '';
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
      input.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
    }
  }

  function bindRelationshipClicks() {
    const relDT = pickDataTable(IDS.REL);
    if (!relDT) { log('No Relationships data table found'); return; }
    const cIdx = headerIndex(relDT, 'Contact');
    if (cIdx < 0) { log('No "Contact" column in Relationships'); return; }

    let bound = 0;
    Array.from(relDT.querySelectorAll('tr')).forEach((tr, i) => {
      if (i === 0) return; // header
      const td = tr.children[cIdx];
      if (!td || td.__cfBound) return;
      td.__cfBound = true;
      td.classList.add('cf-clickable');
      td.title = 'Click to filter General & Professional by this person';
      td.addEventListener('click', function (ev) {
        ev.stopPropagation();
        const name = norm(td.textContent);
        if (!name) return;

        sessionStorage.setItem(LAST, name);

        const okG = applyServerFilter(IDS.GEN,  name);
        const okP = applyServerFilter(IDS.PROF, name);

        if (okG) addClearChip(IDS.GEN,  name);
        if (okP) addClearChip(IDS.PROF, name);

        log('Click:', name, '→ applied:', { general: okG, professional: okP });
      }, true);
      bound++;
    });
    log('bindRelationshipClicks → bound', bound, 'cells');
  }

  function reapplyIfNeeded() {
    const last = sessionStorage.getItem(LAST);
    if (!last) return;
    const okG = applyServerFilter(IDS.GEN,  last);
    const okP = applyServerFilter(IDS.PROF, last);
    if (okG) addClearChip(IDS.GEN,  last);
    if (okP) addClearChip(IDS.PROF, last);
    if (okG || okP) log('Re-applied last:', last);
  }

  const mo = new MutationObserver(() => {
    clearTimeout(mo.__t);
    mo.__t = setTimeout(() => {
      bindRelationshipClicks();
      reapplyIfNeeded();
    }, 120);
  });

  bindRelationshipClicks();
  reapplyIfNeeded();
  mo.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      clearServerFilter(IDS.GEN);
      clearServerFilter(IDS.PROF);
      sessionStorage.removeItem(LAST);
      document.querySelectorAll('.cf-chip').forEach(n => n.remove());
      log('Cleared filters (Esc)');
    }
  });

  log('Cross-filter v11 initialized.');
})();