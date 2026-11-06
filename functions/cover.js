const WIDTH = 1280;
const HEIGHT = 670;

function escapeXml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]);
}

function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function splitTitle(value) {
  const chars = Array.from(String(value || 'こころを整える小さなノート').trim());
  const width = 15;
  const lines = [];
  while (chars.length && lines.length < 2) lines.push(chars.splice(0, width).join(''));
  if (chars.length && lines.length === 2) lines[1] = Array.from(lines[1]).slice(0, width - 1).join('') + '…';
  return lines.length ? lines : ['こころを整える'];
}

function illustration(mode, accent, shade, highlight) {
  if (mode === 'fortune') return `
    <circle cx="1030" cy="326" r="215" fill="${highlight}" opacity=".72"/>
    <circle cx="1042" cy="300" r="112" fill="${accent}"/>
    <circle cx="1090" cy="260" r="112" fill="${highlight}"/>
    <g fill="${shade}" opacity=".82">
      <path d="M890 166l8 23 23 8-23 8-8 23-8-23-23-8 23-8z"/>
      <path d="M1174 365l6 17 17 6-17 6-6 17-6-17-17-6 17-6z"/>
      <circle cx="925" cy="408" r="5"/><circle cx="1128" cy="141" r="5"/><circle cx="1193" cy="235" r="4"/>
    </g>
    <g transform="rotate(8 1015 363)">
      <rect x="930" y="302" width="178" height="226" rx="20" fill="#fffdf8" stroke="${shade}" stroke-opacity=".18" stroke-width="3"/>
      <rect x="950" y="322" width="138" height="186" rx="13" fill="${highlight}"/>
      <circle cx="1018" cy="394" r="42" fill="${accent}" opacity=".82"/>
      <path d="M1008 405c-22-14-20-36-4-39 9-2 15 4 17 11 3-7 9-13 18-11 16 3 18 25-4 39l-14 11z" fill="#fffdf8"/>
      <path d="M977 458h82" stroke="${shade}" stroke-opacity=".38" stroke-width="4" stroke-linecap="round"/>
      <path d="M990 474h55" stroke="${shade}" stroke-opacity=".23" stroke-width="4" stroke-linecap="round"/>
    </g>`;
  if (mode === 'hybrid') return `
    <circle cx="1042" cy="335" r="218" fill="${highlight}" opacity=".76"/>
    <circle cx="1090" cy="236" r="86" fill="${accent}" opacity=".88"/>
    <circle cx="1124" cy="204" r="87" fill="${highlight}"/>
    <g transform="rotate(-7 1007 407)">
      <rect x="867" y="327" width="282" height="172" rx="24" fill="#fffdf8" stroke="${shade}" stroke-opacity=".16" stroke-width="3"/>
      <path d="M884 353l124 91 124-91" fill="none" stroke="${accent}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M884 483l89-69m159 69-89-69" fill="none" stroke="${accent}" stroke-opacity=".55" stroke-width="7" stroke-linecap="round"/>
      <path d="M993 398c-17-11-15-28-3-31 7-1 12 3 14 9 2-6 7-10 14-9 12 3 14 20-3 31l-11 9z" fill="${shade}"/>
    </g>
    <g fill="${shade}" opacity=".8"><path d="M1167 383l7 19 19 7-19 7-7 19-7-19-19-7 19-7z"/><circle cx="892" cy="253" r="5"/><circle cx="1171" cy="161" r="4"/></g>`;
  return `
    <circle cx="1040" cy="335" r="218" fill="${highlight}" opacity=".8"/>
    <circle cx="1065" cy="320" r="146" fill="${accent}" opacity=".34"/>
    <g transform="rotate(-8 1035 339)">
      <rect x="876" y="247" width="314" height="206" rx="27" fill="#fffdf8" stroke="${shade}" stroke-opacity=".16" stroke-width="3"/>
      <path d="M895 276l138 101 138-101" fill="none" stroke="${accent}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M895 432l98-78m178 78-98-78" fill="none" stroke="${accent}" stroke-opacity=".6" stroke-width="8" stroke-linecap="round"/>
      <path d="M1018 322c-23-15-20-38-4-42 9-2 16 5 18 12 3-7 10-14 19-12 16 4 19 27-4 42l-15 12z" fill="${shade}"/>
    </g>
    <g fill="${shade}" opacity=".78"><path d="M1170 166l7 20 20 7-20 7-7 20-7-20-20-7 20-7z"/><path d="M859 405l5 14 14 5-14 5-5 14-5-14-14-5 14-5z"/><circle cx="1190" cy="344" r="5"/></g>`;
}

function makeCoverSvg(draft) {
  const palettes = [
    { bg: '#f7f1e8', accent: '#b76b67', shade: '#604d63', highlight: '#e8d8df' },
    { bg: '#eff3ed', accent: '#66826e', shade: '#3e5649', highlight: '#dce7dd' },
    { bg: '#f3eff8', accent: '#8a77a5', shade: '#554866', highlight: '#e3dcef' },
    { bg: '#f8f0e8', accent: '#bd825e', shade: '#66564b', highlight: '#f0dfd0' },
  ];
  const mode = draft.contentMode === 'fortune' ? 'fortune' : draft.contentMode === 'hybrid' || draft.contentMode === 'both' ? 'hybrid' : 'love';
  const palette = palettes[hashText(draft.title) % palettes.length];
  const titleLines = splitTitle(draft.title).map(escapeXml);
  const titleMarkup = titleLines.map((line, index) => `<tspan x="104" dy="${index ? 1.3 : 0}em">${line}</tspan>`).join('');
  const kind = mode === 'fortune' ? '占いと心の整理' : mode === 'hybrid' ? '恋愛と心の整理' : '恋愛・復縁のノート';
  const label = mode === 'fortune' ? 'FORTUNE JOURNAL' : 'LOVE & HEART JOURNAL';
  const art = illustration(mode, palette.accent, palette.shade, palette.highlight);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${palette.bg}"/>
  <path d="M0 0h1280v26H0z" fill="${palette.shade}" opacity=".9"/>
  <circle cx="52" cy="548" r="180" fill="${palette.highlight}" opacity=".52"/>
  <circle cx="127" cy="96" r="6" fill="${palette.accent}" opacity=".55"/>
  <text x="104" y="128" fill="${palette.shade}" font-family="Arial, sans-serif" font-size="17" font-weight="700" letter-spacing="4">${label}</text>
  <path d="M104 157h70" stroke="${palette.accent}" stroke-width="4" stroke-linecap="round"/>
  <text x="104" y="204" fill="${palette.shade}" font-family="sans-serif" font-size="20" letter-spacing="2">${kind}</text>
  <text x="104" y="307" fill="#292a27" font-family="sans-serif" font-size="52" font-weight="700" letter-spacing="1.5">${titleMarkup}</text>
  <text x="104" y="493" fill="${palette.shade}" opacity=".72" font-family="sans-serif" font-size="18" letter-spacing="2">自分の気持ちを、少しずつほどく。</text>
  <path d="M104 526h286" stroke="${palette.shade}" stroke-opacity=".22" stroke-width="2"/>
  <text x="104" y="570" fill="${palette.shade}" opacity=".52" font-family="Arial, sans-serif" font-size="13" letter-spacing="3">KOKORO ARTICLE LAB</text>
  ${art}
  <circle cx="1210" cy="590" r="4" fill="${palette.accent}" opacity=".7"/>
  </svg>`;
}

export async function generateCoverImage(env, draft) {
  if (!draft?.id || !draft?.createdAt) throw new Error('画像を紐づける記事情報がありません。');
  const svg = makeCoverSvg(draft);
  await env.DRAFTS.put(coverKey(draft), JSON.stringify({ svg, mimeType: 'image/svg+xml' }));
  const metadata = { coverStatus: 'ready', coverImageGeneratedAt: new Date().toISOString(), coverMimeType: 'image/svg+xml' };
  delete draft.coverError;
  Object.assign(draft, metadata);
  return metadata;
}

export async function getCoverImage(request, env) {
  const url = new URL(request.url);
  const id = url.searchParams.get('draftId') || '';
  const createdAt = url.searchParams.get('createdAt') || '';
  if (!id || !createdAt || id.length > 100 || createdAt.length > 80) return json({ error: '記事の情報を確認してください。' }, 400);
  const image = await env.DRAFTS.get(coverKey({ id, createdAt }), 'json');
  if (image?.svg) {
    return new Response(image.svg, { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (!image?.data) return json({ error: '画像がまだありません。' }, 404);
  const binary = atob(image.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Response(bytes, { headers: { 'Content-Type': image.mimeType || 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' } });
}

export async function regenerateCover(request, env) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.draftId || '');
  const createdAt = String(body.createdAt || '');
  if (!id || !createdAt || id.length > 100 || createdAt.length > 80) return json({ error: '画像を作る記事を選んでください。' }, 400);
  const key = `draft:${createdAt}:${id}`;
  const draft = await env.DRAFTS.get(key, 'json');
  if (!draft) return json({ error: '記事が見つかりません。下書き一覧を更新してください。' }, 404);
  try {
    await generateCoverImage(env, draft);
    draft.updatedAt = new Date().toISOString();
    await env.DRAFTS.put(key, JSON.stringify(draft), { metadata: { title: String(draft.title || '').slice(0,90), intent: String(draft.intent || '').slice(0,55), deliverable: String(draft.deliverable || '').slice(0,55) } });
    return json({ draft });
  } catch (error) {
    draft.coverStatus = 'failed';
    draft.coverError = String(error.message || error).slice(0,240);
    draft.updatedAt = new Date().toISOString();
    await env.DRAFTS.put(key, JSON.stringify(draft), { metadata: { title: String(draft.title || '').slice(0,90), intent: String(draft.intent || '').slice(0,55), deliverable: String(draft.deliverable || '').slice(0,55) } });
    return json({ error: draft.coverError, draft }, 502);
  }
}

function coverKey(draft) {
  return `cover:${draft.createdAt}:${draft.id}`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
