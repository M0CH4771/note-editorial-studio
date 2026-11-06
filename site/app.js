const $ = (s) => document.querySelector(s);
const state = { ideas: [], drafts: [], selected: null, busy: false, retryingFailures: new Set(), draftFilter: 'all', coverUrls: new Map() };
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
  const { timeoutMs = 90000, ...requestOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...requestOptions, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(password ? { Authorization: `Bearer ${password}` } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `エラー (${response.status})`);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('通信が時間切れになりました。接続を確認して、もう一度お試しください。');
    throw error;
  } finally { clearTimeout(timeout); }
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.classList.toggle('is-loading', busy);
  button.dataset.original ||= button.querySelector('span')?.textContent || button.textContent;
  const span = button.querySelector('span');
  if (span) span.textContent = busy ? label : button.dataset.original;
  else button.textContent = busy ? label : button.dataset.original;
}


function setWorkflowStep(active, message, busy = false) {
  document.querySelectorAll('[data-flow-step]').forEach(node => {
    const step = Number(node.dataset.flowStep);
    node.classList.toggle('active', step === active);
    node.classList.toggle('done', step < active);
  });
  const status = $('#workflowStatus');
  if (status) {
    status.textContent = message;
    status.classList.toggle('busy', busy);
  }
}
function selectedContentMode() {
  return document.querySelector('input[name="contentMode"]:checked')?.value || 'both';
}
function modeLabel(mode) {
  return mode === 'fortune' ? '占い' : mode === 'hybrid' || mode === 'both' ? '両方・ミックス' : '恋愛・復縁';
}
function updateModeCards() {
  document.querySelectorAll('.mode-card').forEach(card => card.classList.toggle('selected', card.querySelector('input')?.checked));
}

async function checkStatus() {
  try {
    const s = await api('/api/status');
    if (!s.ready) throw new Error('CloudflareのAPIキー設定を確認してください。');
    await syncDrafts();
    await refreshThreadsStatus();
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

async function refreshThreadsStatus() {
  try {
    const data = await api('/api/threads/status');
    const label = $('#threadsState');
    label.textContent = data.connected ? '接続済み' : '未接続';
    label.classList.toggle('ok', !!data.connected);
    $('#threadsAccount').textContent = data.connected ? (data.username ? '@' + data.username : 'Threadsアカウント接続済み') : 'Metaの公式連携を使います。';
    $('#connectThreadsBtn').textContent = data.connected ? 'Threadsを再接続' : 'Threadsを接続';
    const t = data.totals || {};
    $('#threadsMetrics').innerHTML = '<div>投稿 <b>' + Number(data.sent || 0) + '</b></div><div>表示 <b>' + Number(t.views || 0).toLocaleString('ja-JP') + '</b></div><div>反応 <b>' + (Number(t.likes || 0) + Number(t.replies || 0) + Number(t.reposts || 0) + Number(t.quotes || 0)).toLocaleString('ja-JP') + '</b></div><div>待機 <b>' + Number(data.queued || 0) + '</b></div>';
  } catch (e) {
    $('#threadsState').textContent = '未接続';
    $('#threadsMetrics').innerHTML = '<div>Threads投稿連携の状態を読み込めません。</div>';
  }
}

function loadDrafts() {
  try { state.drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]'); }
  catch { state.drafts = []; }
  state.selected = state.drafts[0]?.id || null;
  renderDrafts();
}

function saveDrafts() {
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(state.drafts)); } catch { notify('端末の保存容量が不足しています'); }
}

async function syncDrafts() {
  const data = await api('/api/drafts');
  const remote = data.drafts || [];
  const remoteIds = new Set(remote.map(d => d.id));
  state.drafts = [...remote, ...state.drafts.filter(d => !remoteIds.has(d.id))];
  state.drafts.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  state.selected = state.drafts[0]?.id || null;
  saveDrafts();
  renderDrafts();
  refreshFailures().catch(()=>notify('再作成の一覧を取得できませんでした'));
}

function renderIdeas() {
  const root = $('#ideas');
  $('#ideaCountLabel').textContent = `${state.ideas.length}件`;
  if (!state.ideas.length) {
    root.className = 'ideas empty-state';
    root.innerHTML = '<div class="empty-illustration"><span>✦</span><span>♡</span><span>☾</span></div><strong>気になるテーマから始めよう</strong><span>企画を探すと、候補とおすすめの理由がここに並びます。</span>';
    return;
  }
  root.className = 'ideas';
  root.innerHTML = state.ideas.map((idea, i) => `
    <article class="idea-card" style="animation-delay:${Math.min(i*35,210)}ms">
      <h3>${escapeHtml(idea.title || 'タイトル案')}</h3>
      <div class="idea-meta"><span class="idea-mode">${escapeHtml(modeLabel(idea.contentMode))}</span><span>${escapeHtml(idea.cluster || '記事案')}</span><span>·</span><span class="score">${Number(idea.score || 0)}点</span></div>
      <div class="idea-hook">${escapeHtml(idea.hook || idea.intent || '')}</div>
      <details class="idea-details"><summary>おすすめの理由と参考情報</summary><p><b>読者が知りたいこと</b><br>${escapeHtml(idea.intent || '調査中')}</p><p><b>需要について</b><br>${escapeHtml(idea.demand_evidence || '十分な情報が見つかりませんでした')}</p><p><b>似た記事・競合</b><br>${escapeHtml(idea.competition || '調査中')}</p><p><b>参考にしたページ</b><br>${(idea.sources || []).map(s => `<a href="${escapeAttr(s.url)}" target="_blank" rel="noreferrer">${escapeHtml(s.title || s.url)}</a>`).join(' · ') || '出典候補なし'}</p></details>
      <button data-draft="${i}">この案で下書きを作る</button>
      <label class="idea-pick"><input type="checkbox" data-pick="${i}">まとめて作る</label>
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
  renderLead();
  const root = $('#draftList');
  $('#draftCount').textContent = `${state.drafts.length}本`;
  $('#exportAllBtn').disabled = !state.drafts.length;
  if (!state.drafts.length) {
    root.innerHTML = '<div class="empty-small">作った記事はここに表示されます。</div>';
    $('#editor').className = 'editor empty-editor';
    $('#editor').innerHTML = '<div class="empty-illustration"><span>✎</span></div><strong>記事を選ぶと、ここで編集できます</strong><span>本文やThreads案を確認できます。</span>';
    state.selected = null;
    return;
  }
  const visible = state.drafts.filter(d => { const mode = d.contentMode || 'love'; return state.draftFilter === 'all' || (state.draftFilter === 'hybrid' ? ['hybrid','both'].includes(mode) : mode === state.draftFilter); });
  if (!visible.length) {
    root.innerHTML = '<div class="empty-small">この分類の記事はまだありません。別の表示を選ぶと、ほかの記事を確認できます。</div>';
    state.selected = null;
    $('#editor').className = 'editor empty-editor';
    $('#editor').innerHTML = '<div class="empty-illustration"><span>✎</span></div><strong>この分類の記事はまだありません</strong><span>「すべて」に戻すと、ほかの記事を確認できます。</span>';
    return;
  }
  root.innerHTML = visible.map(d => `<div class="draft-row ${d.id === state.selected ? 'active' : ''}" data-id="${escapeAttr(d.id)}"><strong>${escapeHtml(d.title)}</strong><span>${escapeHtml(modeLabel(d.contentMode))} · ${new Date(d.updatedAt || d.createdAt).toLocaleDateString('ja-JP')} · ${Number(d.price || 0)}円</span></div>`).join('');
  root.querySelectorAll('.draft-row').forEach(row => row.addEventListener('click', () => { state.selected = row.dataset.id; renderDrafts(); }));
  const draft = visible.find(d => d.id === state.selected) || visible[0];
  state.selected = draft.id;
  renderEditor(draft);
}

function renderEditor(d) {
  const root = $('#editor');
  root.className = 'editor';
  root.innerHTML = `
    <div class="editor-toolbar"><strong>記事の下書き · ${escapeHtml(modeLabel(d.contentMode))} · ${escapeHtml(d.category || '未分類')}</strong><div class="editor-buttons"><button class="secondary-button" id="saveBtn">保存</button><button class="secondary-button" id="copyBtn">本文をコピー</button><button class="secondary-button" id="downloadBtn">ファイルに保存</button><button class="secondary-button" id="deleteBtn">削除</button></div></div>
    <label for="editTitle">タイトル</label><input id="editTitle" value="${escapeAttr(d.title)}">
    <label for="editDek">説明文</label><input id="editDek" value="${escapeAttr(d.dek || '')}">
    <label for="editFree">無料部分</label><textarea id="editFree">${escapeHtml(d.freePart || '')}</textarea>
    <label for="editPaid">有料部分</label><textarea id="editPaid">${escapeHtml(d.paidPart || '')}</textarea>
    <details class="editor-section"><summary>出典を見る（${(d.sources || []).length}件）</summary><ul class="source-list">${(d.sources || []).map(s => `<li><a href="${escapeAttr(s.url)}" target="_blank" rel="noreferrer">${escapeHtml(s.title || s.url)}</a> <span>(${escapeHtml(s.checked || '')})</span> — ${escapeHtml(s.supports || '')}</li>`).join('') || '<li>出典なし</li>'}</ul></details>
    <details class="editor-section"><summary>公開前に確認すること</summary><div class="fact-list">${(d.factCheck || []).map(f => `<div class="fact-item"><b>${escapeHtml(f.status || '要確認')}</b>${escapeHtml(f.claim || '')}${f.note ? `<br>${escapeHtml(f.note)}` : ''}</div>`).join('') || '<div class="fact-item">確認項目なし</div>'}${(d.editorNotes || []).map(n => `<div class="fact-item">${escapeHtml(n)}</div>`).join('')}</div></details>
    <div class="editor-section"><label>Threads投稿案（7本）</label><div class="fact-list">${(d.socialPosts || []).slice(0, 7).map(p => `<div class="fact-item">${escapeHtml(p)}</div>`).join('') || '<div class="fact-item">Threads投稿案なし</div>'}</div></div>
    <details class="editor-section" open><summary>夜中に読む人の目線で見直した点</summary><div class="fact-list">${(d.nightReview || []).map(n => `<div class="fact-item">${escapeHtml(n)}</div>`).join('') || '<div class="fact-item">夜に一人で読む場面を想定し、押しつけや決めつけがないか確認しています。</div>'}</div></details>
    <div class="editor-section"><label>公開前に確認</label><div class="fact-list">${(d.editorNotes || []).map(n => `<div class="fact-item">${escapeHtml(n)}</div>`).join('') || '<div class="fact-item">要確認事項なし</div>'}</div></div>`;
  const cover = document.createElement('section');
  cover.className = 'editor-section cover-editor';
  cover.innerHTML = `
    <div class="cover-heading"><div><label>note用の見出し画像</label><p id="coverInfo" class="microcopy">${d.coverImageGeneratedAt ? '画像を読み込み中…' : d.coverError ? escapeHtml(d.coverError) : '記事タイトルとテーマから画像を作成します。'}</p></div><button id="generateCoverBtn" class="secondary-button">${d.coverImageGeneratedAt ? '画像を作り直す' : '画像を作成'}</button></div>
    <img id="coverPreview" class="cover-preview" alt="${escapeAttr(d.title)}の記事用見出し画像" hidden>
    <a id="downloadCoverBtn" class="secondary-button cover-download" hidden>PNG画像を保存</a>
    <p class="cover-cost-note">画像はサイト内のテンプレートで作成します。画像生成AIのAPI利用料はかかりません。</p>`;
  root.append(cover);
  const coverPreview = cover.querySelector('#coverPreview');
  const coverInfo = cover.querySelector('#coverInfo');
  const downloadCover = cover.querySelector('#downloadCoverBtn');
  let coverFilename = 'note-cover.png';
  async function loadCover() {
    if (!d.coverImageGeneratedAt) return;
    try {
      const password = localStorage.getItem(PASSWORD_KEY) || '';
      const response = await fetch('/api/cover?draftId=' + encodeURIComponent(d.id) + '&createdAt=' + encodeURIComponent(d.createdAt), { headers: password ? { Authorization: `Bearer ${password}` } : {} });
      if (!response.ok) throw new Error('画像を読み込めませんでした');
      const blob = await response.blob();
      if (state.coverUrls.has(d.id)) URL.revokeObjectURL(state.coverUrls.get(d.id));
      const objectUrl = URL.createObjectURL(blob);
      state.coverUrls.set(d.id, objectUrl);
      coverPreview.src = objectUrl;
      coverPreview.hidden = false;
      coverFilename = ((d.title || 'note-cover').replace(/[\\/:*?"<>|]/g, '_').slice(0,60) || 'note-cover') + '-cover.png';
      downloadCover.href = objectUrl;
      downloadCover.download = coverFilename;
      downloadCover.onclick = event => {
        event.preventDefault();
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 1280;
          canvas.height = 670;
          const context = canvas.getContext('2d');
          if (!context) { coverInfo.textContent = 'PNG画像を作成できませんでした。'; return; }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(png => {
            if (!png) { coverInfo.textContent = 'PNG画像を保存できませんでした。'; return; }
            const pngUrl = URL.createObjectURL(png);
            const link = document.createElement('a');
            link.href = pngUrl;
            link.download = coverFilename;
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
          }, 'image/png');
        };
        image.onerror = () => { coverInfo.textContent = '画像をPNGに変換できませんでした。'; };
        image.src = objectUrl;
      };
      downloadCover.hidden = false;
      coverInfo.textContent = '画像ができました。PNGで保存してnoteの見出し画像に設定できます。';
    } catch (error) { coverInfo.textContent = error.message; }
  }
  if (d.coverImageGeneratedAt) loadCover();
  cover.querySelector('#generateCoverBtn').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '画像を作成中…';
    coverInfo.textContent = '記事に合わせた見出し画像を作成しています。';
    try {
      const result = await api('/api/cover', { method: 'POST', timeoutMs: 60000, body: JSON.stringify({ draftId: d.id, createdAt: d.createdAt }) });
      Object.assign(d, result.draft);
      saveDrafts();
      notify('記事用の見出し画像を作成しました');
      renderDrafts();
    } catch (error) {
      coverInfo.textContent = error.message;
      button.disabled = false;
      button.textContent = 'もう一度作成';
    }
  };
  const publish = document.createElement('div');
  publish.className='editor-section';
  publish.innerHTML='<label>公開したnoteのURL<input type="url" placeholder="https://note.com/…/n/…" value="'+escapeAttr(d.noteUrl||'')+'"></label><button class="secondary-button">'+(d.noteUrl?'公開URLを更新':'公開した')+'</button>';
  root.append(publish);
  publish.querySelector('button').onclick=async()=>{
    try{
      const url=new URL(publish.querySelector('input').value.trim());
      if(url.origin!=='https://note.com'||url.pathname.split('/').filter(Boolean).length!==3||url.pathname.split('/')[2]!=='n') throw new Error('公開したnote記事のURLを入力してください');
      const edited={...d,title:$('#editTitle').value,dek:$('#editDek').value,freePart:$('#editFree').value,paidPart:$('#editPaid').value,status:'published',noteUrl:url.origin+url.pathname,publishedAt:d.publishedAt||new Date().toISOString()};
      const {draft}=await api('/api/drafts',{method:'PUT',body:JSON.stringify(edited)});
      Object.assign(d,draft); saveDrafts(); renderDrafts(); notify('公開済みに登録しました');
    }catch(e){notify(e.message);}
  };
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
  const button = $('#researchBtn'); state.busy = true; setWorkflowStep(1, '検索結果を確認しながら企画を考えています', true); setBusy(button, true, '企画を調べています…'); updateBatchButton();
  try {
    setWorkflowStep(1, 'テーマを調べて、恋愛系と占い系の候補を準備しています', true);
    const data = await api('/api/ideas', { method: 'POST', body: JSON.stringify({ themes: $('#themes').value, audience: $('#audience').value, count: $('#ideaCount').value, contentMode: selectedContentMode() }) });
    state.ideas = data.ideas || []; renderIdeas(); setWorkflowStep(2, `${state.ideas.length}件の候補ができました。気になる案を選んでください`); notify(`${state.ideas.length}件の企画候補を作成しました`);
  } catch (error) { setWorkflowStep(1, '企画を作れませんでした。少し待ってからもう一度試してください'); notify(error.message); }
  finally { state.busy = false; setBusy(button, false); updateBatchButton(); }
}

async function waitForDraftJob(idea, price, onProgress = () => {}) {
  const { jobId } = await api('/api/draft-jobs', { method: 'POST', timeoutMs: 30000, body: JSON.stringify({ idea, price }) });
  if (!jobId) throw new Error('下書きの作成を開始できませんでした。');
  const startedAt = Date.now();
  const maxWait = 12 * 60 * 1000;
  while (Date.now() - startedAt < maxWait) {
    const job = await api('/api/draft-jobs?id=' + encodeURIComponent(jobId), { timeoutMs: 15000 });
    if (job.status === 'completed') {
      let draft;
      for (let attempt = 0; attempt < 6; attempt++) {
        await syncDrafts();
        draft = state.drafts.find(item => item.id === job.draftId);
        if (draft) break;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      if (!draft) throw new Error('記事は作成されましたが、一覧への反映に時間がかかっています。下書き一覧を更新してください。');
      state.selected = draft.id; renderDrafts();
      return draft;
    }
    if (job.status === 'failed') throw new Error(job.error || '記事の作成に失敗しました。内容を確認して再度お試しください。');
    onProgress(job, Math.floor((Date.now() - startedAt) / 1000));
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error('作成処理はバックグラウンドで続いています。下書き一覧を更新して、完了を確認してください。');
}

async function createDraft(idea, button) {
  if (button.disabled) return;
  const original = button.textContent;
  let completed = false;
  button.disabled = true; button.textContent = '作成を準備中…'; setWorkflowStep(3, '選んだ企画から記事を作成しています', true);
  try {
    const price = Number($('#articlePrice').value);
    const draft = await waitForDraftJob(idea, price, (_, seconds) => { button.textContent = `記事を作成中… ${Math.floor(seconds / 60)}分`; setWorkflowStep(3, `記事を執筆しています · ${Math.floor(seconds / 60)}分経過`, true); });
    completed = true;
    setWorkflowStep(3, '下書きができました。内容を確認してnoteへ');
    document.querySelector('#drafts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    notify('下書きができました。本文を確認してください');
  } catch (error) { notify(error.message); }
  finally { button.disabled = false; button.textContent = original; if (!completed) setWorkflowStep(2, '下書きを作れませんでした。内容を確認してもう一度試してください'); }
}

async function createBatch() {
  const selected = [...document.querySelectorAll('[data-pick]:checked')].slice(0, 3).map(box => state.ideas[Number(box.dataset.pick)]);
  if (!selected.length || state.busy) return;
  const button = $('#batchBtn'); state.busy = true; setWorkflowStep(3, '選んだ企画から記事を順番に作成しています', true); setBusy(button, true, `1/${selected.length}件目を作成中…`);
  const newDrafts = [];
  try {
    for (let i = 0; i < selected.length; i++) {
      setBusy(button, true, `${i + 1}/${selected.length}件目を作成中…`);
      const draft = await waitForDraftJob(selected[i], Number($('#articlePrice').value), (_, seconds) => { setBusy(button, true, `${i + 1}/${selected.length}件目を作成中…`); setWorkflowStep(3, `${i + 1}/${selected.length}件目 · 記事を執筆しています`, true); });
      newDrafts.unshift(draft);
    }
    document.querySelectorAll('[data-pick]:checked').forEach(box => { box.checked = false; });
    setWorkflowStep(3, `${newDrafts.length}本の下書きができました。内容を確認してください`);
    document.querySelector('#drafts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    notify(`${newDrafts.length}件の下書きを作成しました`);
  } catch (error) {
    if (newDrafts.length) { state.selected = newDrafts[0].id; renderDrafts(); }
    setWorkflowStep(newDrafts.length ? 3 : 2, newDrafts.length ? '作成できた記事を確認してください。残りは再実行できます' : '下書き作成が止まりました。もう一度お試しください');
    notify(`${error.message}${newDrafts.length ? `（先に作成できた${newDrafts.length}件は保存済み）` : ''}`);
  } finally { state.busy = false; setBusy(button, false); updateBatchButton(); }
}

async function saveSelected() {
  const d = state.drafts.find(x => x.id === state.selected); if (!d) return;
  Object.assign(d, { title: $('#editTitle').value, dek: $('#editDek').value, freePart: $('#editFree').value, paidPart: $('#editPaid').value, updatedAt: new Date().toISOString() });
  saveDrafts(); renderDrafts();
  try { await api('/api/drafts', { method: 'PUT', body: JSON.stringify(d) }); notify('下書きを保存しました'); }
  catch { notify('このブラウザには保存しました。サーバー同期はできませんでした'); }
}

async function deleteSelected() {
  const d = state.drafts.find(x => x.id === state.selected); if (!d || !confirm(`「${d.title}」を削除しますか？`)) return;
  try { await api('/api/drafts?id=' + encodeURIComponent(d.id) + '&createdAt=' + encodeURIComponent(d.createdAt), { method: 'DELETE' }); }
  catch { notify('削除をサーバーに反映できませんでした'); return; }
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

$('#connectThreadsBtn').addEventListener('click', async () => { try { const data = await api('/api/threads/connect'); location.href = data.url; } catch(e) { notify(e.message); } });
if (new URLSearchParams(location.search).get('threads') === 'connected') { history.replaceState({}, '', location.pathname); notify('Threadsを接続しました。公開済み記事の告知案は毎日1本ずつ投稿されます。'); }
if (new URLSearchParams(location.search).get('threads') === 'error') { history.replaceState({}, '', location.pathname); notify('Threads連携に失敗しました。Metaアプリ設定を確認してください。'); }
$('#refreshDraftsBtn').addEventListener('click', async () => {
  const button = $('#refreshDraftsBtn');
  button.disabled = true; button.textContent = '更新中…';
  try { await syncDrafts(); notify('下書き一覧を更新しました'); }
  catch (error) { notify(error.message); }
  finally { button.disabled = false; button.textContent = '下書き一覧を更新'; }
});
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
document.querySelectorAll('.topic-chip').forEach(button => button.addEventListener('click', () => { $('#themes').value = button.textContent; document.querySelectorAll('.topic-chip').forEach(chip => chip.classList.toggle('selected', chip === button)); const mode = button.dataset.topicMode; if (mode) { const radio = document.querySelector(`input[name="contentMode"][value="${mode}"]`); if (radio) { radio.checked = true; updateModeCards(); } } }));
document.querySelectorAll('input[name="contentMode"]').forEach(input => input.addEventListener('change', updateModeCards));
$('#draftModeFilter').addEventListener('change', event => { state.draftFilter = event.target.value; state.selected = null; renderDrafts(); });

loadDrafts();
checkStatus();

function renderLead(){
  const latest=state.drafts.filter(d=>d.automated).map(d=>d.date).sort().at(-1);
  const picks=state.drafts.filter(d=>d.automated&&d.date===latest).sort((a,b)=>(a.rank||99)-(b.rank||99));
  const d=picks.find(x=>x.status==='published')||picks[0];
  const box=$('#lead');
  if(!d){box.textContent='自動作成した下書きが届くと、ここにおすすめの1本が出ます。';return;}
  const link=d.evidence&&/^https?:\/\//i.test(d.evidence)?'<a target="_blank" rel="noreferrer" href="'+escapeAttr(d.evidence)+'">根拠を読む</a>':'根拠ページは要確認';
  box.innerHTML='<small>'+escapeHtml(latest)+' 作成 · '+(d.status==='published'?'公開済み':'おすすめ')+'</small><h3>'+escapeHtml(d.title)+'</h3><p>'+escapeHtml(d.reason||d.dek)+'</p>'+link+' <button>下書きを開く</button>';
  box.querySelector('button').onclick=()=>{state.selected=d.id;renderDrafts();$('#editor').scrollIntoView();};
}
async function refreshFailures(){
  const {items=[]}=await api('/api/failures');
  const box=$('#failures');box.replaceChildren();
  for(const item of items){
    const btn=document.createElement('button');
    const pending=state.retryingFailures.has(item.id);
    btn.textContent=pending?'再作成中…':item.title+' を再作成';
    btn.disabled=pending;
    box.append(btn);
    btn.onclick=async()=>{
      if(state.retryingFailures.has(item.id))return;
      state.retryingFailures.add(item.id);btn.disabled=true;btn.textContent='再作成を開始中…';
      try{
        await api('/api/failures',{method:'POST',body:JSON.stringify({id:item.id})});
      }catch(e){state.retryingFailures.delete(item.id);btn.disabled=false;btn.textContent=item.title+' を再作成';notify(e.message);return;}
      notify('再作成を受け付けました。完了まで一覧で確認します');
      await refreshFailures().catch(()=>{});
      watchFailure(item.id,Date.now());
    };
  }
}
async function watchFailure(id,startedAt){
  try{
    const {items=[]}=await api('/api/failures',{timeoutMs:15000});
    if(!items.some(item=>item.id===id)){
      state.retryingFailures.delete(id);
      await syncDrafts();
      notify('再作成が完了しました。下書き一覧に追加しました');
      return;
    }
  }catch{}
  if(Date.now()-startedAt>=600000){
    state.retryingFailures.delete(id);
    await refreshFailures().catch(()=>{});
    notify('再作成に時間がかかっています。表示を更新しました。');
    return;
  }
  setTimeout(()=>watchFailure(id,startedAt),8000);
}
const weekInput=$('#weekDay');
weekInput.value=new Date(Date.now()+9*3600000-7*86400000).toISOString().slice(0,10);
weekInput.onchange=()=>$('#weekRows').replaceChildren();
$('#loadWeek').onclick=async()=>{
  const day=weekInput.value;
  const path='/api/weekly?day='+encodeURIComponent(day);
  try{
    const {rows}=await api(path);if(weekInput.value!==day)return;
    const monday=new Date(day+'T00:00:00Z'); monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
    const sunday=new Date(+monday+6*86400000).toISOString().slice(0,10);
    const pubs=new Map(rows.map(r=>[r.id,r]));
    for(const d of state.drafts.filter(d=>d.status==='published'&&(!d.publishedAt||new Date(Date.parse(d.publishedAt)+9*3600000).toISOString().slice(0,10)<=sunday))) if(!pubs.has(d.id))pubs.set(d.id,d);
    const box=$('#weekRows');box.replaceChildren();
    if(!pubs.size){box.textContent='この週に集計できる記事がありません。下書きに公開URLを登録してください。';return;}
    const caption=document.createElement('p');caption.textContent=monday.toISOString().slice(0,10)+' 〜 '+sunday+' の期間分を入力（空欄は未集計）';box.append(caption);
    const fields=[];
    for(const r of pubs.values()){
      const row=document.createElement('fieldset');const label=document.createElement('legend');label.textContent=r.title;row.append(label);
      for(const [key,name] of [['views','ビュー'],['purchases','購入件数'],['revenue','売上（円）']]){
        const el=document.createElement('label');el.textContent=name;const input=document.createElement('input');input.type='number';input.min='0';input.value=r[key]??'';el.append(input);row.append(el);
      }box.append(row);fields.push([r,row]);
    }
    const save=document.createElement('button');save.textContent='この週の実績を保存';box.append(save);
    save.onclick=async()=>{try{
      const output=[];for(const [r,row] of fields){const v=[...row.querySelectorAll('input')].map(x=>x.value);
        if(v.every(x=>x===''))continue;
        if(v.some(x=>x===''||!Number.isSafeInteger(+x)||+x<0))throw new Error('集計する記事は3項目とも0以上の整数を入力してください');
        output.push({id:r.id,title:r.title,views:+v[0],purchases:+v[1],revenue:+v[2]});
      }await api(path,{method:'PUT',body:JSON.stringify(output)});notify('週の実績を保存しました');
    }catch(e){notify(e.message);}};
  }catch(e){notify(e.message);}
};
