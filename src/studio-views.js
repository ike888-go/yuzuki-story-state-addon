function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function text(value, fallback = '暂无') {
  if (value === null || value === undefined || value === '') return fallback;
  return escapeHtml(value);
}

function array(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return String(value).split(/[\n、,，]+/).map((item) => item.trim()).filter(Boolean);
}

function clamp(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function tags(values, className = 'yssa-tag') {
  const items = array(values);
  return items.length
    ? items.map((item) => `<span class="${className}">${text(typeof item === 'object' ? item.name || item.title : item)}</span>`).join('')
    : '<span class="yssa-muted">暂无</span>';
}

function progress(value, label = '') {
  const percent = clamp(value);
  return `<div class="yssa-progress" aria-label="${escapeHtml(label)} ${percent}%"><span style="width:${percent}%"></span></div>`;
}

export function normalizeStoryState(state = {}) {
  if (state.scene && state.protagonist) return state;
  const tensionNumber = Number(state.tension);
  return {
    scene: {
      chapter: state.chapter || '当前剧情', time: state.time || '未知', location: state.location || '未知',
      weather: state.weather || '未知', summary: state.note || state.objective || '等待生成剧情摘要',
      participants: array(state.participants),
    },
    protagonist: {
      objective: state.objective || '未知', condition: state.condition || '未知',
      tension: ({ 平静: 18, 微妙: 42, 紧张: 68, 危险: 88 }[state.tension] ?? (Number.isFinite(tensionNumber) ? tensionNumber : 0)),
      relationship: state.relationship || '未知',
    },
    relations: [],
    clues: array(state.clues).map((title) => ({ title, detail: '', status: '已记录' })),
    tasks: array(state.next).map((title) => ({ title, progress: 0, status: '待推进' })),
    play: { energy: 0, selected: [], guidance: state.next || '尚未生成玩法建议', itemsEnabled: false },
    shop: { currency: 0, offers: [] },
    next: array(state.next),
  };
}

export function normalizeInvestigationState(state = {}) {
  if (state.meta && state.portrait && state.appeal) return state;
  const metric = (value) => {
    const match = String(value || '').match(/\d+/);
    return { value: match ? Number(match[0]) : 0, note: String(value || '').replace(/^\d+\s*\/\s*100\s*[—-]?\s*/, '') };
  };
  return {
    meta: { target: state.target || '', gender: state.gender || '未知', age: state.age || '未知', updatedAt: state.updatedAt || '' },
    portrait: { portrait: state.portrait || '', bodyData: state.bodyData || '', dailyStyle: state.dailyStyle || '', privateStyle: state.privateStyle || '', makeupStyle: state.makeupStyle || '' },
    psychology: { orientation: state.orientation || '', kinks: array(state.kinks), shame: metric(state.shame), confidence: metric(state.confidence), openness: metric(state.openness) },
    purity: { isVirgin: state.virginity || '未知', firstPartner: state.firstPartner || '', score: Number(String(state.purityScore || '').match(/\d+/)?.[0]) || 0, details: array(state.purityDetails).map((item) => ({ part: item, status: String(item).includes('已失') ? '已失' : '未失', note: '' })) },
    sexualStats: { count: Number(String(state.sexCount || '').match(/\d+/)?.[0]) || 0, partnerCount: Number(String(state.partnerCount || '').match(/\d+/)?.[0]) || 0, partners: array(state.partners).map((name) => ({ name })), frequency: state.frequency || '', positions: array(state.positions).map((name) => ({ name })), locations: array(state.locations).map((name) => ({ name })) },
    fertility: { summary: state.fertilitySummary || '', history: array(state.fertilityHistory).map((note) => ({ note })) },
    development: {
      oral: { stats: '', description: state.oralDevelopment || '' }, hand: { stats: '', description: state.handDevelopment || '' },
      foot: { stats: '', description: state.footDevelopment || '' }, breast: { stats: '', description: state.breastDevelopment || '' },
      penis: { stats: '', description: state.penisDevelopment || '' }, genital: { stats: '', description: state.genitalDevelopment || '' },
      anal: { stats: '', description: state.analDevelopment || '' },
    },
    masturbation: { count: Number(String(state.masturbationCount || '').match(/\d+/)?.[0]) || 0, frequency: state.masturbationFrequency || '', first: state.firstMasturbation || '', method: state.masturbationMethod || '' },
    experiences: { first: state.firstExperience || '', recent: state.recentExperience || '', best: state.bestExperience || '' },
    appeal: { types: array(state.charmTypes), tags: array(state.eroticTags), rank: state.globalRank || '', grade: state.grade || '', advantages: array(state.advantages), disadvantages: array(state.disadvantages), attractivePart: state.attractivePart || '', voice: { daily: state.voiceProfile || '', teased: '', building: '', climax: '' }, rumors: array(state.rumors).map((value) => ({ source: '传闻', text: value })), userNote: state.userNote || '', selfReview: state.selfReview || '' },
  };
}

export function normalizeAchievementState(state = {}) {
  if (state.summary && Array.isArray(state.achievements)) return state;
  const achievements = [];
  for (let index = 1; index <= 4; index += 1) {
    const name = state[`a${index}Name`];
    if (name) achievements.push({ id: `legacy-${index}`, name, description: state[`a${index}Desc`] || '', time: state[`a${index}Time`] || '', category: '特别', rarity: index === 1 ? '史诗' : '稀有', unlocked: true, progress: 100 });
  }
  return { summary: { total: Number(state.total) || achievements.length, level: Math.max(1, Math.ceil((Number(state.total) || achievements.length) / 4)), streak: 0, latest: state.latest || achievements[0]?.name || '尚无' }, achievements, nextGoals: array(state.progress) };
}

export function normalizeSocialState(state = {}) {
  if (state.profile && Array.isArray(state.posts)) return state;
  const posts = [];
  for (let index = 1; index <= 3; index += 1) {
    if (!state[`p${index}Title`] && !state[`p${index}Body`]) continue;
    posts.push({
      id: `legacy-${index}`, author: state.author || '剧情记录员', handle: state.handle || 'story_notes', avatar: state.avatar || '记',
      title: state[`p${index}Title`] || '生活记录', body: state[`p${index}Body`] || '', tags: array(state[`p${index}Tag`]),
      time: '剧情中', location: '', coverTone: ['雾粉', '鼠尾草绿', '暮蓝'][index - 1], likes: Number(state[`p${index}Likes`]) || 0,
      favorites: 0, liked: false, collected: false, comments: array(state[`p${index}Comments`]).map((body) => ({ author: '路人', body, time: '刚刚', likes: 0 })),
    });
  }
  return { profile: { name: state.author || '剧情记录员', handle: state.handle || 'story_notes', bio: state.bio || '', avatar: state.avatar || '记' }, posts, note: state.note || '' };
}

export function renderStoryState(rawState = {}) {
  const state = normalizeStoryState(rawState);
  const relations = array(state.relations).map((item) => `
    <article class="yssa-relation-card">
      <div class="yssa-avatar">${text(item.name, '人').slice(0, 1)}</div>
      <div><strong>${text(item.name)}</strong><small>${text(item.role)} · ${text(item.mood)}</small><p>${text(item.thought)}</p>${progress(item.closeness, '亲密度')}</div>
      <b>${clamp(item.closeness)}</b>
    </article>`).join('') || '<p class="yssa-empty-card">还没有人物关系数据</p>';
  const clues = array(state.clues).map((item) => `<li><span>${text(item.status, '记录')}</span><div><strong>${text(item.title || item)}</strong><p>${text(item.detail, '')}</p></div></li>`).join('') || '<li class="is-empty">暂无确认线索</li>';
  const tasks = array(state.tasks).map((item) => `<article><div><strong>${text(item.title || item)}</strong><small>${text(item.status)}</small></div>${progress(item.progress, item.title)}</article>`).join('') || '<p class="yssa-empty-card">暂无任务</p>';
  const offers = array(state.shop?.offers).map((item) => `<article class="yssa-shop-card"><span>${text(item.rarity, '普通')}</span><div><small>${text(item.type)}</small><strong>${text(item.name)}</strong><p>${text(item.effect)}</p></div><b>◇ ${text(item.price, '0')}</b></article>`).join('') || '<p class="yssa-empty-card">商店会在生成状态后出现灵感商品</p>';
  return `
    <section class="yssa-state-hero">
      <div class="yssa-state-kicker"><span>${text(state.scene.time)}</span><span>${text(state.scene.weather)}</span></div>
      <h2>${text(state.scene.chapter)}</h2><p>${text(state.scene.summary)}</p>
      <div class="yssa-state-place">⌖ ${text(state.scene.location)} <span>${array(state.scene.participants).map((name) => text(name)).join(' · ')}</span></div>
    </section>
    <nav class="yssa-subnav" data-yssa-subnav><button class="is-active" data-yssa-tab="now">此刻</button><button data-yssa-tab="people">人物</button><button data-yssa-tab="play">玩法</button><button data-yssa-tab="shop">商店</button></nav>
    <section class="yssa-tab-panel is-active" data-yssa-panel="now">
      <div class="yssa-metric-row"><article><small>紧张度</small><strong>${clamp(state.protagonist.tension)}</strong>${progress(state.protagonist.tension)}</article><article><small>关系气氛</small><p>${text(state.protagonist.relationship)}</p></article></div>
      <article class="yssa-paper-card"><small>CURRENT OBJECTIVE</small><h3>${text(state.protagonist.objective)}</h3><p>${text(state.protagonist.condition)}</p></article>
      <div class="yssa-section-title"><span>线索簿</span><small>${array(state.clues).length} 条</small></div><ul class="yssa-clue-list">${clues}</ul>
      <div class="yssa-section-title"><span>任务进度</span></div><div class="yssa-task-list">${tasks}</div>
      <div class="yssa-section-title"><span>下一步</span></div><ol class="yssa-next-list">${array(state.next).map((item) => `<li>${text(item)}</li>`).join('') || '<li>等待生成</li>'}</ol>
    </section>
    <section class="yssa-tab-panel" data-yssa-panel="people"><div class="yssa-relation-list">${relations}</div></section>
    <section class="yssa-tab-panel" data-yssa-panel="play">
      <article class="yssa-play-energy"><div><small>PLAY ENERGY</small><strong>${clamp(state.play?.energy)}</strong></div>${progress(state.play?.energy)}<p>${text(state.play?.guidance)}</p></article>
      <div class="yssa-chip-cloud">${tags(state.play?.selected, 'yssa-play-chip')}</div>
      <div class="yssa-item-toggle"><span>物品使用</span><b>${state.play?.itemsEnabled ? 'ON' : 'OFF'}</b></div>
    </section>
    <section class="yssa-tab-panel" data-yssa-panel="shop"><div class="yssa-shop-wallet"><span>灵感余额</span><strong>◇ ${text(state.shop?.currency, '0')}</strong></div><div class="yssa-shop-list">${offers}</div></section>`;
}

function metricCard(label, metric) {
  return `<article><small>${label}</small><strong>${clamp(metric?.value)}</strong>${progress(metric?.value)}<p>${text(metric?.note, '')}</p></article>`;
}

function detailRows(items, empty = '暂无记录') {
  return array(items).map((item) => {
    if (typeof item !== 'object') return `<li><p>${text(item)}</p></li>`;
    const title = item.name || item.part || item.time || item.source || item.title || '记录';
    const body = item.note || item.text || item.description || [item.identity, item.relationship, item.result].filter(Boolean).join(' · ');
    return `<li><div><strong>${text(title)}</strong>${item.status ? `<span class="is-${item.status === '已失' ? 'lost' : 'safe'}">${text(item.status)}</span>` : ''}</div><p>${text(body, '')}</p></li>`;
  }).join('') || `<li class="is-empty">${empty}</li>`;
}

export function renderInvestigation(rawState = {}) {
  const state = normalizeInvestigationState(rawState);
  const devLabels = { oral: '口部', hand: '手部', foot: '足部', breast: '乳部', penis: '阳具', genital: '阴部', anal: '肛部' };
  const developments = Object.entries(state.development || {}).map(([key, item]) => `
    <details class="yssa-dossier-detail"><summary><span>${devLabels[key] || key}开发</span><small>${text(item?.stats, '查看')}</small></summary><p>${text(item?.description)}</p></details>`).join('');
  const voice = state.appeal?.voice || {};
  return `
    <section class="yssa-dossier-cover">
      <div class="yssa-dossier-seal">密</div><small>CLASSIFIED · PRIVATE DOSSIER</small>
      <h2>${text(state.meta?.target, '等待选择调查对象')}</h2><p>${text(state.meta?.gender)} · ${text(state.meta?.age)} · ${text(state.meta?.updatedAt, '尚未生成')}</p>
      <div class="yssa-dossier-grade"><strong>${text(state.appeal?.grade, '--')}</strong><span>${text(state.appeal?.rank, '未排名')}</span></div>
    </section>
    <nav class="yssa-dossier-nav" data-yssa-subnav><button class="is-active" data-yssa-tab="profile">档案</button><button data-yssa-tab="purity">纯洁</button><button data-yssa-tab="history">经历</button><button data-yssa-tab="appeal">魅力</button></nav>
    <section class="yssa-tab-panel is-active" data-yssa-panel="profile">
      <div class="yssa-section-title"><span>壹 · 基础档案</span><small>BASIC PROFILE</small></div>
      <article class="yssa-dossier-prose"><h3>人物特写</h3><p>${text(state.portrait?.portrait)}</p><blockquote>${text(state.portrait?.bodyData)}</blockquote></article>
      <div class="yssa-style-grid"><article><small>日常服装</small><p>${text(state.portrait?.dailyStyle)}</p></article><article><small>私密服装</small><p>${text(state.portrait?.privateStyle)}</p></article><article><small>妆容风格</small><p>${text(state.portrait?.makeupStyle)}</p></article></div>
      <div class="yssa-section-title"><span>贰 · 心理性向</span><small>PSYCHOLOGY</small></div>
      <article class="yssa-orientation-card"><small>性取向</small><strong>${text(state.psychology?.orientation)}</strong><div class="yssa-chip-cloud">${tags(state.psychology?.kinks, 'yssa-dossier-tag')}</div></article>
      <div class="yssa-index-grid">${metricCard('羞耻指数', state.psychology?.shame)}${metricCard('性自信', state.psychology?.confidence)}${metricCard('开放度', state.psychology?.openness)}</div>
    </section>
    <section class="yssa-tab-panel" data-yssa-panel="purity">
      <div class="yssa-purity-head"><div class="yssa-purity-ring" style="--score:${clamp(state.purity?.score)}"><strong>${clamp(state.purity?.score)}%</strong><small>纯洁评分</small></div><div><small>贞洁状态</small><h3>${text(state.purity?.isVirgin)}</h3><p>${text(state.purity?.firstPartner)}</p></div></div>
      <ul class="yssa-dossier-list">${detailRows(state.purity?.details, '暂无纯洁度明细')}</ul>
      <div class="yssa-stat-triplet"><article><small>性爱次数</small><strong>${text(state.sexualStats?.count, '0')}</strong></article><article><small>性爱人数</small><strong>${text(state.sexualStats?.partnerCount, '0')}</strong></article><article><small>频率</small><p>${text(state.sexualStats?.frequency)}</p></article></div>
      <div class="yssa-section-title"><span>主要名单</span></div><ul class="yssa-dossier-list">${detailRows(state.sexualStats?.partners)}</ul>
      <div class="yssa-percent-columns"><article><small>常用体位</small>${tags(state.sexualStats?.positions, 'yssa-percent-chip')}</article><article><small>场所分布</small>${tags(state.sexualStats?.locations, 'yssa-percent-chip')}</article></div>
      <div class="yssa-section-title"><span>生育记录</span></div><article class="yssa-dossier-prose"><h3>${text(state.fertility?.summary)}</h3><ul class="yssa-dossier-list">${detailRows(state.fertility?.history)}</ul></article>
    </section>
    <section class="yssa-tab-panel" data-yssa-panel="history">
      <div class="yssa-section-title"><span>叁 · 开发状态</span><small>DEVELOPMENT</small></div>${developments}
      <div class="yssa-section-title"><span>肆 · 自慰档案</span></div><article class="yssa-dossier-prose"><h3>${text(state.masturbation?.count, '0')} 次 · ${text(state.masturbation?.frequency)}</h3><p>${text(state.masturbation?.first)}</p><blockquote>${text(state.masturbation?.method)}</blockquote></article>
      <div class="yssa-section-title"><span>伍 · 性经历</span></div>
      <details class="yssa-experience" open><summary>第一次性经历</summary><p>${text(state.experiences?.first)}</p></details><details class="yssa-experience"><summary>最近一次性经历</summary><p>${text(state.experiences?.recent)}</p></details><details class="yssa-experience"><summary>最强烈的一次</summary><p>${text(state.experiences?.best)}</p></details>
    </section>
    <section class="yssa-tab-panel" data-yssa-panel="appeal">
      <div class="yssa-section-title"><span>陆 · 综合魅力</span><small>APPEAL</small></div><div class="yssa-chip-cloud">${tags([...(state.appeal?.types || []), ...(state.appeal?.tags || [])], 'yssa-dossier-tag')}</div>
      <article class="yssa-attractive-card"><small>MOST ATTRACTIVE</small><h3>${text(state.appeal?.attractivePart)}</h3></article>
      <div class="yssa-adv-grid"><article><small>排名优势</small><ul>${array(state.appeal?.advantages).map((item) => `<li>${text(item)}</li>`).join('') || '<li>暂无</li>'}</ul></article><article><small>排名劣势</small><ul>${array(state.appeal?.disadvantages).map((item) => `<li>${text(item)}</li>`).join('') || '<li>暂无</li>'}</ul></article></div>
      <div class="yssa-section-title"><span>声音档案</span></div><div class="yssa-voice-timeline"><article><small>日常</small><p>${text(voice.daily)}</p></article><article><small>被撩拨</small><p>${text(voice.teased)}</p></article><article><small>累积</small><p>${text(voice.building)}</p></article><article><small>高潮</small><p>${text(voice.climax)}</p></article></div>
      <div class="yssa-section-title"><span>流言与评价</span></div><ul class="yssa-rumor-list">${detailRows(state.appeal?.rumors, '暂无流言')}</ul>
      <article class="yssa-private-note"><small>使用者备注</small><p>${text(state.appeal?.userNote)}</p></article><article class="yssa-private-note is-self"><small>人物自评</small><p>${text(state.appeal?.selfReview)}</p></article>
    </section>`;
}

export function renderAchievements(rawState = {}) {
  const state = normalizeAchievementState(rawState);
  const cards = array(state.achievements).map((item, index) => `
    <article class="yssa-achievement-card rarity-${escapeHtml(item.rarity || '普通')} ${item.unlocked ? 'is-unlocked' : 'is-locked'}">
      <div class="yssa-medal">${item.unlocked ? ['✦', '◇', '❖', '✧'][index % 4] : '⌁'}</div>
      <small>${text(item.category, '特别')} · ${text(item.rarity, '普通')}</small><h3>${text(item.name, '隐藏成就')}</h3><p>${text(item.description)}</p>
      <footer>${item.unlocked ? `<span>${text(item.time, '已解锁')}</span>` : `${progress(item.progress, item.name)}<span>${clamp(item.progress)}%</span>`}</footer>
    </article>`).join('') || '<p class="yssa-empty-card">生成一次后，这里会成为完整的剧情成就卡册。</p>';
  return `
    <section class="yssa-achievement-hero"><div><small>COLLECTION LEVEL</small><strong>Lv.${text(state.summary?.level, '1')}</strong></div><div><span>${text(state.summary?.total, '0')}</span><small>已解锁</small></div><div><span>${text(state.summary?.streak, '0')}</span><small>连续记录</small></div></section>
    <article class="yssa-latest-achievement"><span>最新解锁</span><strong>${text(state.summary?.latest, '尚无')}</strong></article>
    <div class="yssa-achievement-filter"><button class="is-active">全部</button><button>已解锁</button><button>进行中</button></div>
    <section class="yssa-achievement-grid">${cards}</section>
    <section class="yssa-goal-card"><small>NEXT GOALS</small>${array(state.nextGoals).map((item) => `<p>→ ${text(item)}</p>`).join('') || '<p>尚未发现新的目标</p>'}</section>`;
}

export function renderSocial(rawState = {}, selectedPostId = '') {
  const state = normalizeSocialState(rawState);
  const selected = state.posts.find((post) => String(post.id) === String(selectedPostId));
  if (selected) {
    const comments = array(selected.comments).map((item) => `<article class="yssa-xhs-comment"><span>${text(item.author, '路').slice(0, 1)}</span><div><strong>${text(item.author, '路人')}</strong><p>${text(item.body)}</p><small>${text(item.time, '刚刚')} · ♡ ${text(item.likes, '0')}</small></div></article>`).join('') || '<p class="yssa-empty-card">还没有评论</p>';
    return `<section class="yssa-xhs-detail">
      <button class="yssa-xhs-back" data-yssa-action="social-feed">‹ 返回</button>
      <div class="yssa-xhs-cover tone-${escapeHtml(selected.coverTone || '雾粉')}"><span>${text(selected.tags?.[0], '剧情')}</span><em>${text(selected.location, '')}</em></div>
      <header><div class="yssa-avatar">${text(selected.avatar || selected.author, '记').slice(0, 1)}</div><div><strong>${text(selected.author)}</strong><small>@${text(selected.handle)}</small></div><button>关注</button></header>
      <article><h2>${text(selected.title)}</h2><p>${text(selected.body)}</p><div class="yssa-chip-cloud">${tags(selected.tags, 'yssa-xhs-tag')}</div><small>${text(selected.time)}</small></article>
      <section class="yssa-xhs-comments"><div class="yssa-section-title"><span>共 ${array(selected.comments).length} 条评论</span></div>${comments}</section>
      <footer><span>说点什么…</span><button data-yssa-social-toggle="liked" data-post-id="${escapeHtml(selected.id)}">${selected.liked ? '♥' : '♡'} ${text(selected.likes, '0')}</button><button data-yssa-social-toggle="collected" data-post-id="${escapeHtml(selected.id)}">${selected.collected ? '★' : '☆'} ${text(selected.favorites, '0')}</button></footer>
    </section>`;
  }
  const cards = state.posts.map((post) => `<article class="yssa-xhs-card" data-yssa-post-id="${escapeHtml(post.id)}">
    <button class="yssa-xhs-open" data-yssa-action="open-post" data-post-id="${escapeHtml(post.id)}"><div class="yssa-xhs-cover tone-${escapeHtml(post.coverTone || '雾粉')}"><span>${text(post.tags?.[0], '生活')}</span><em>${text(post.location, '')}</em></div><h3>${text(post.title)}</h3></button>
    <div><span class="yssa-avatar">${text(post.avatar || post.author, '记').slice(0, 1)}</span><small>${text(post.author)}</small><button data-yssa-social-toggle="liked" data-post-id="${escapeHtml(post.id)}">${post.liked ? '♥' : '♡'} ${text(post.likes, '0')}</button></div>
  </article>`).join('') || '<p class="yssa-empty-card">点击“生成信息流”，这里会出现和旧版小红书一样的双列笔记。</p>';
  return `<section class="yssa-xhs-profile"><div class="yssa-avatar">${text(state.profile?.avatar || state.profile?.name, '记').slice(0, 1)}</div><div><strong>${text(state.profile?.name)}</strong><small>@${text(state.profile?.handle)}</small><p>${text(state.profile?.bio)}</p></div></section><div class="yssa-xhs-toolbar"><button class="is-active">发现</button><button>关注</button><span>${text(state.note, '')}</span></div><section class="yssa-xhs-feed">${cards}</section>`;
}

export function renderToolState(toolKey, state, selectedPostId = '') {
  if (toolKey === 'story') return renderStoryState(state);
  if (toolKey === 'investigation') return renderInvestigation(state);
  if (toolKey === 'achievements') return renderAchievements(state);
  if (toolKey === 'social') return renderSocial(state, selectedPostId);
  return '<p class="yssa-empty-card">未知页面</p>';
}
