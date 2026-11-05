const $ = (s) => document.querySelector(s);
const state = { ideas: [], drafts: [], selected: null, busy: false };
const connection = $('#connection');
const toast = $('#toast');
const DRAFTS_KEY = 'note-editorial-studio-drafts-v1';
const PASSWORD_KEY = 'note-editorial-studio-password-v1';

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

async function api(url, options = {}) {
  const password = localStorage.getItem(PASSWORD_KEY) || '';
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(password ? { Authorization: `Bearer ${password}` } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `エラー (${response.status})`);
  return data;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.dataset.original ||= button.querySelector('span')?.textContent || button.textContent;
  const span = button.querySelector('span');
  if (span) span.textContent = busy ? label : button.dataset.original;
  else button.textContent = busy ? label : button.dataset.original;
}

async function checkStatus() {
  try {
    const s = await api('/api/status');
    if (!s.ready) throw new Error('CloudflareのAPIキー設定を確認してください。');
    connection.classList.toggle('ok', s.ready);
    connection.lastElementChild?.remove();
    connection.innerHTML = `<i></i>${s.ready ? '接続済み' : '設定を確認してください'}`;
    if (document.querySelector('#settingsDialog').open) document.querySelector('#settingsDialog').close();
  } catch (error) {
    connection.classList.remove('ok');
    connection.innerHTML = `<i></i>${error.message.includes('パスワード') ? '接続パスワードを入力' : '接続できません'}`;
    if (!document.querySelector('#settingsDialog').open) document.querySelector('#settingsDialog').showModal();
  }
}

function loadDrafts() {
  try { state.drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]'); }
  catch { state.drafts = []; }
  state.selected = state.drafts[0]?.id || null;
  renderDrafts();
}

function saveDrafts() {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(state.drafts));
}

function renderIdeas() {
  const root = $('#ideas');
  $('#ideaCountLabel').textContent = `${state.ideas.length}件`;
  if (!state.ideas.length) {
    root.className = 'ideas empty-state';
    root.innerHTML = '<div class="empty-icon">✎</div><strong>まずは左でテーマを決めます</strong><span>調査が終わると、記事案がここに表示されます。</span>';
    return;
  }
  root.className = 'ideas';
  root.innerHTML = state.ideas.map((idea, i) => `
    <article class="idea-card">
      <h3>${escapeHtml(idea.title || 'タイトル案')}</h3>
      <div class="idea-meta"><span>${escapeHtml(idea.cluster || '記事案')}</span><span>·</span><span>AIのおすすめ度（目安）</span><span class="score">${Number(idea.score || 0)}点</span></div>
      <div class="idea-hook">${escapeHtml(idea.hook || idea.intent || '')}</div>
      <details class="idea-details"><summary>なぜこの案がおすすめ？</summary><p><b>読者が知りたいこと</b><br>${escapeHtml(idea.intent || '調査中')}</p><p><b>需要について見つかったこと</b><br>${escapeHtml(idea.demand_evidence || '十分な情報が見つかりませんでした')}</p><p><b>似た記事</b><br>${escapeHtml(idea.competition || '調査中')}</p><p><b>参考にしたページ</b><br>${(idea.sources || []).map(s => `<a href="${escapeAttr(s.url)}" target="_blank" rel="noreferrer">${escapeHtml(s.title || s.url)}</a>`).join(' · ') || '出典候補なし'}</p></details>
      <button data-draft="${i}">この案で下書きを作る</button>
      <label class="idea-pick"><input type="checkbox" data-pick="${i}">まとめて作る案に入れる</label>
    </article>`).join('');
  root.querySelectorAll('[data-draft]').forEach(button => button.addEventListener('click', () => createDraft(state.ideas[Number(button.dataset.draft)], button)));
  root.querySelectorAll('[data-pick]').forEach(box => box.addEventListener('change', updateBatchButton));
  updateBatchButton();
}

function updateBatchButton() {
  const picked = document.querySelectorAll('[data-pick]:checked').length;
  const button = $('#batchBtn');
  button.disabled = picked === 0 || state.busy;
  button.textContent = picked > 3 ? `先頭の3件を下書き作成 · ${picked}件選択中` : `選んだ企画から下書き作成（${picked || ''}件）`;
}

function renderDrafts() {
  const root = $('#draftList');
  $('#draftCount').textContent = `${state.drafts.length}本`;
  $('#exportAllBtn').disabled = !state.drafts.length;
  if (!state.drafts.length) {
    root.innerHTML = '<div class="empty-small">作った記事の下書きが、ここに並びます。</div>';
    $('#editor').className = 'editor empty-editor';
    $('#editor').innerHTML = '<div class="empty-icon">✎</div><strong>下書きを選ぶと編集できます</strong><span>出典・事実確認メモ・SNS告知案も一緒に保管。</span>';
    state.selected = null;
    return;
  }
  root.innerHTML = state.drafts.map(d => `<div class="draft-row ${d.id === state.selected ? 'active' : ''}" data-id="${d.id}"><strong>${escapeHtml(d.title)}</strong><span>${new Date(d.updatedAt || d.createdAt).toLocaleDateString('ja-JP')} · ${d.price}円想定</span></div>`).join('');
  root.querySelectorAll('.draft-row').forEach(row => row.addEventListener('click', () => { state.selected = row.dataset.id; renderDrafts(); }));
  const draft = state.drafts.find(d => d.id === state.selected) || state.drafts[0];
  if (!state.selected) state.selected = draft.id;
  renderEditor(draft);
}

function renderEditor(d) {
  const root = $('#editor');
  root.className = 'editor';
  root.innerHTML = `
    <div class="editor-toolbar"><strong>記事の下書き · ${escapeHtml(d.category || '未分類')}</strong><div class="editor-buttons"><button class="secondary-button" id="saveBtn">保存</button><button class="secondary-button" id="copyBtn">本文をコピー</button><button class="secondary-button" id="downloadBtn">ファイルに保存</button><button class="secondary-button" id="deleteBtn">削除</button></div></div>
    <label for="editTitle">タイトル</label><input id="editTitle" value="${escapeAttr(d.title)}">
    <label for="editDek">説明文</label><input id="editDek" value="${escapeAttr(d.dek || '')}">
    <label for="editFree">無料部分</label><textarea id="editFree">${escapeHtml(d.freePart || '')}</textarea>
    <label for="editPaid">有料部分</label><textarea id="editPaid">${escapeHtml(d.paidPart || '')}</textarea>
    <details class="editor-section"><summary>出典を見る（${(d.sources || []).length}件）</summary><ul class="source-list">${(d.sources || []).map(s => `<li><a href="${escapeAttr(s.url)}" target="_blank" rel="noreferrer">${escapeHtml(s.title || s.url)}</a> <span>(${escapeHtml(s.checked || '')})</span> — ${escapeHtml(s.supports || '')}</li>`).join('') || '<li>出典なし</li>'}</ul></details>
    <details class="editor-section"><summary>公開前に確認すること</summary><div class="fact-list">${(d.factCheck || []).map(f => `<div class="fact-item"><b>${escapeHtml(f.status || '要確認')}</b>${escapeHtml(f.claim || '')}${f.note ? `<br>${escapeHtml(f.note)}` : ''}</div>`).join('') || '<div class="fact-item">確認項目なし</div>'}${(d.editorNotes || []).map(n => `<div class="fact-item">${escapeHtml(n)}</div>`).join('')}</div></details>
    <div class="editor-section"><label>SNS告知案</label><div class="fact-list">${(d.socialPosts || []).map(p => `<div class="fact-item">${escapeHtml(p)}</div>`).join('') || '<div class="fact-item">告知案なし</div>'}</div></div>
    <div class="editor-section"><label>公開前に確認</label><div class="fact-list">${(d.editorNotes || []).map(n => `<div class="fact-item">${escapeHtml(n)}</div>`).join('') || '<div class="fact-item">要確認事項なし</div>'}</div></div>`;
  $('#saveBtn').addEventListener('click', saveSelected);
  $('#copyBtn').addEventListener('click', () => {
    const references = (d.sources || []).map(s => `- ${s.title || '参考ページ'}: ${s.url}`).join('\n');
    copyText(`# ${$('#editTitle').value}\n\n${$('#editDek').value}\n\n${$('#editFree').value}\n\n--- 有料エリア ---\n\n${$('#editPaid').value}${references ? `\n\n## 参考ページ\n${references}` : ''}`);
  });
  $('#downloadBtn').addEventListener('click', () => downloadMarkdown(d));
  $('#deleteBtn').addEventListener('click', deleteSelected);
}

async function research() {
  if (state.busy) return;
  const button = $('#researchBtn'); state.busy = true; setBusy(button, true, '検索して企画を探しています…'); updateBatchButton();
  try {
    const data = await api('/api/ideas', { method: 'POST', body: JSON.stringify({ themes: $('#themes').value, audience: $('#audience').value, count: $('#ideaCount').value }) });
    state.ideas = data.ideas || []; renderIdeas(); notify(`${state.ideas.length}件の企画候補を作成しました`);
  } catch (error) { notify(error.message); }
  finally { state.busy = false; setBusy(button, false); updateBatchButton(); }
}

async function createDraft(idea, button) {
  if (button.disabled) return;
  button.disabled = true; button.textContent = '調査・執筆中…';
  try {
    const draft = await api('/api/draft', { method: 'POST', body: JSON.stringify({ idea, price: Number($('#articlePrice').value), length: '標準（約1,500〜2,500字）' }) });
    state.drafts.unshift(draft); state.selected = draft.id; saveDrafts(); renderDrafts(); notify('出典と確認メモ付きの下書きを作成しました');
  } catch (error) { notify(error.message); }
  finally { button.disabled = false; button.textContent = '下書き作成'; }
}

async function createBatch() {
  const selected = [...document.querySelectorAll('[data-pick]:checked')].slice(0, 3).map(box => state.ideas[Number(box.dataset.pick)]);
  if (!selected.length || state.busy) return;
  const button = $('#batchBtn'); state.busy = true; setBusy(button, true, `1/${selected.length}件目を調査・執筆中…`);
  const newDrafts = [];
  try {
    for (let i = 0; i < selected.length; i++) {
      setBusy(button, true, `${i + 1}/${selected.length}件目を調査・執筆中…`);
      const draft = await api('/api/draft', { method: 'POST', body: JSON.stringify({ idea: selected[i], price: Number($('#articlePrice').value), length: '標準（約1,500〜2,500字）' }) });
      newDrafts.unshift(draft);
    }
    state.drafts.unshift(...newDrafts); state.selected = newDrafts[0]?.id || state.selected; saveDrafts(); renderDrafts();
    document.querySelectorAll('[data-pick]:checked').forEach(box => { box.checked = false; });
    notify(`${newDrafts.length}件の下書きを作成しました`);
  } catch (error) {
    if (newDrafts.length) { state.drafts.unshift(...newDrafts); state.selected = newDrafts[0].id; saveDrafts(); renderDrafts(); }
    notify(`${error.message}${newDrafts.length ? `（先に作成できた${newDrafts.length}件は保存済み）` : ''}`);
  } finally { state.busy = false; setBusy(button, false); updateBatchButton(); }
}

async function saveSelected() {
  const d = state.drafts.find(x => x.id === state.selected); if (!d) return;
  Object.assign(d, { title: $('#editTitle').value, dek: $('#editDek').value, freePart: $('#editFree').value, paidPart: $('#editPaid').value, updatedAt: new Date().toISOString() });
  saveDrafts(); renderDrafts(); notify('このブラウザに保存しました');
}

async function deleteSelected() {
  const d = state.drafts.find(x => x.id === state.selected); if (!d || !confirm(`「${d.title}」を削除しますか？`)) return;
  state.drafts = state.drafts.filter(x => x.id !== d.id); state.selected = state.drafts[0]?.id || null; saveDrafts(); renderDrafts(); notify('下書きを削除しました');
}

function downloadMarkdown(d) {
  const title = $('#editTitle')?.value || d.title;
  const content = `# ${title}\n\n${$('#editDek')?.value || d.dek}\n\n${$('#editFree')?.value || d.freePart}\n\n---\n\n${$('#editPaid')?.value || d.paidPart}\n\n## 参考・出典\n${(d.sources || []).map(s => `- [${s.title}](${s.url})（${s.checked || ''}確認）`).join('\n')}\n`;
  const safeName = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 70) || 'note-draft';
  downloadFile(`${safeName}.md`, content, 'text/markdown;charset=utf-8');
}

function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

function exportAll() {
  const rows = ['title,price,status,createdAt', ...state.drafts.map(d => [d.title, d.price, d.status, d.createdAt].map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(','))];
  downloadFile('記事下書き一覧.csv', '\ufeff' + rows.join('\n'), 'text/csv;charset=utf-8');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); notify('本文をコピーしました'); }
  catch { notify('コピーできませんでした。テキストを選択してコピーしてください。'); }
}

function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function escapeAttr(value = '') { return escapeHtml(value); }

$('#researchBtn').addEventListener('click', research);
$('#batchBtn').addEventListener('click', createBatch);
$('#settingsBtn').addEventListener('click', () => $('#settingsDialog').showModal());
$('#savePasswordBtn').addEventListener('click', async () => {
  const password = $('#appPassword').value.trim();
  if (!password) { notify('パスワードを入力してください'); return; }
  localStorage.setItem(PASSWORD_KEY, password);
  await checkStatus();
  if (connection.classList.contains('ok')) { $('#appPassword').value = ''; notify('接続しました'); }
  else { localStorage.removeItem(PASSWORD_KEY); $('#appPassword').value = ''; notify('パスワードを確認してください'); }
});
$('#exportAllBtn').addEventListener('click', exportAll);
document.querySelectorAll('.topic-chip').forEach(button => button.addEventListener('click', () => { $('#themes').value = button.textContent; document.querySelectorAll('.topic-chip').forEach(chip => chip.classList.toggle('selected', chip === button)); }));

loadDrafts();
checkStatus();
