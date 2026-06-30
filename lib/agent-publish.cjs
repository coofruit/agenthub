/**
 * 智能体上架模块：根据模板生成 HTML 交互页，并写入注册表供首页展示。
 * 模板来源：
 *   - 无文件上传：agent-family.html
 *   - 支持文件上传（native + inline 回退）：agent-document.html
 */
const fs = require('fs');
const path = require('path');
const { listBuiltinAgents } = require('./builtin-agents.cjs');
const {
  HIAGENT_API_BASE_SERVER,
  PUBLISHED_HIAGENT_RUNTIME,
} = require('./hiagent-constants.cjs');

const ROOT = path.join(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'data', 'agents-registry.json');
const TEMPLATE_NO_UPLOAD = path.join(ROOT, 'agent-family.html');
const TEMPLATE_WITH_UPLOAD = path.join(ROOT, 'agent-document.html');

function ensureRegistry() {
  const dir = path.dirname(REGISTRY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(REGISTRY_PATH)) {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify({ nextId: 100, agents: [] }, null, 2));
  }
}

function readRegistry() {
  ensureRegistry();
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
}

function writeRegistry(data) {
  ensureRegistry();
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2));
}

function escapeJsString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\n/g, ' ');
}

function parseSuggestions(input) {
  if (Array.isArray(input)) {
    return input.map(s => String(s).trim()).filter(Boolean).slice(0, 4);
  }
  if (typeof input === 'string' && input.trim()) {
    return input.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 4);
  }
  return [];
}

/** 根据智能体名称、分类与简介，生成首页卡片三条特性（√ 后文案） */
function generateCardFeatures(name, tag, supportsFileUpload, desc) {
  const text = `${name}${desc || ''}`;

  const keywordRules = [
    { test: /娱乐|影视|音乐|综艺|艺人|经纪|版权|直播/, features: ['合同审核与版权合规', '产业链争议研判', '艺人经纪法律支持'] },
    { test: /劳动|工伤|雇佣|劳动合同|辞退|竞业/, features: ['劳动合同风险审查', '工伤认定与赔偿分析', '劳动争议处理策略'] },
    { test: /税务|税筹|发票|增值税|所得税/, features: ['税务合规分析', '节税筹划方案', '稽查应对策略'] },
    { test: /破产|债权|清算|重整/, features: ['债权主体资格审查', '申报材料完整性核验', '审查意见专业输出'] },
    { test: /文书|起草|执行|诉讼/, features: ['法律文书智能起草', '案情材料附件解析', '修改意见与优化建议'] },
    { test: /合规|投资|国企|监管/, features: ['对外投资合规审查', '监管政策实时解读', '交易结构法律分析'] },
    { test: /婚姻|家事|继承|离婚|抚养|财产分割/, features: ['离婚诉讼策略分析', '财产分割方案建议', '子女抚养权评估'] },
    { test: /基金|私募|LP|GP|募集/, features: ['基金设立备案指引', '合格投资者合规审查', '投资协议条款分析'] },
    { test: /客户|需求|沟通/, features: ['沟通要点自动提炼', '需求清单结构化', '优先级与跟进计划'] },
  ];

  for (const rule of keywordRules) {
    if (rule.test.test(text)) return rule.features.slice(0, 3);
  }

  const tagDefaults = {
    民商事: ['民商事纠纷分析', '诉讼策略建议', '法律风险防控'],
    合规: ['合规要点审查', '监管政策解读', '风险条款识别'],
    税务: ['税务合规分析', '节税筹划建议', '稽查应对策略'],
    破产: ['债权审查分析', '材料完整性核验', '专业意见输出'],
    文书: ['法律文书起草', '材料附件解析', '格式规范把关'],
    投资: ['投资合规审查', '交易结构分析', '协议条款研判'],
    助手: ['智能法律问答', '专业分析建议', '处理思路梳理'],
  };

  const base = [...(tagDefaults[tag] || tagDefaults.助手)];

  if (supportsFileUpload) {
    const uploadPhrase = /文书|起草|执行/.test(text)
      ? '裁判材料附件解析'
      : /娱乐|影视|合同/.test(text)
        ? '合同材料附件解析'
        : '附件材料智能解析';
    if (!base.some(f => /附件|材料|上传/.test(f))) base[1] = uploadPhrase;
  }

  return base.slice(0, 3);
}

function resolveCardFeatures(input, content) {
  if (Array.isArray(input.features) && input.features.length) {
    return input.features.map(f => String(f).trim()).filter(Boolean).slice(0, 3);
  }
  return generateCardFeatures(content.name, content.tag, content.supportsFileUpload, content.desc);
}

function buildPageContent(input) {
  const name = String(input.name || '').trim();
  const icon = String(input.icon || '🤖').trim() || '🤖';
  const tag = String(input.tag || '助手').trim() || '助手';
  const status = input.status === 'beta' ? 'beta' : 'online';
  const statusLabel = status === 'beta' ? '内测' : '已上线';
  const desc = String(input.desc || `${name} — 由高领智能体中心提供的智能法律助手`).trim();
  const supportsFileUpload = input.supportsFileUpload === true
    || input.supportsFileUpload === 'true'
    || input.supportsFileUpload === 1
    || input.supportsFileUpload === '1';
  const welcomeTitle = String(input.welcomeTitle || `您好，我是${name}助手`).trim();
  const welcomeDesc = String(input.welcomeDesc || desc).trim();
  const inputPlaceholder = String(
    input.inputPlaceholder || (supportsFileUpload ? `描述您的需求与背景…` : `向${name}提问…`)
  ).trim();
  const suggestions = parseSuggestions(input.suggestions);

  return {
    name,
    icon,
    tag,
    status,
    statusLabel,
    statusText: `${statusLabel} · ${tag}`,
    desc,
    supportsFileUpload,
    welcomeTitle,
    welcomeDesc,
    inputPlaceholder,
    suggestions,
    footTip: String(input.footTip || 'AI 回复仅供参考，不构成正式法律意见').trim(),
    disclaimer: String(
      input.disclaimer || '内容由 AI 生成，仅供参考，不构成正式法律意见。正式文书或意见须由执业律师审核定稿。'
    ).trim(),
  };
}

function validatePublishInput(input) {
  const name = String(input.name || '').trim();
  const appId = String(input.appId || '').trim();
  const apiKey = String(input.apiKey || '').trim();
  if (!name) throw new Error('请填写智能体名称');
  if (name.length > 40) throw new Error('智能体名称不能超过 40 字');
  if (!appId) throw new Error('请填写 App ID');
  if (!/^[a-z0-9]+$/i.test(appId)) throw new Error('App ID 格式不正确');
  if (!apiKey) throw new Error('请填写 API 密钥');
  if (!/^[a-z0-9]+$/i.test(apiKey)) throw new Error('API 密钥格式不正确');
  return { name, appId, apiKey };
}

function buildSlug(registry, appId) {
  const suffix = String(appId).slice(-10).replace(/[^a-z0-9]/gi, '').toLowerCase() || Date.now().toString(36);
  let slug = `agent-${suffix}`;
  let i = 1;
  while (registry.agents.some(a => a.slug === slug) || fs.existsSync(path.join(ROOT, `${slug}.html`))) {
    slug = `agent-${suffix}-${i++}`;
  }
  return slug;
}

function adaptPageContent(html, content) {
  const {
    name, icon, statusText, welcomeTitle, welcomeDesc,
    inputPlaceholder, suggestions, supportsFileUpload, footTip, disclaimer,
  } = content;

  html = html.replace(/当前智能体 · <strong>[^<]+<\/strong>/, `当前智能体 · <strong>${escapeHtml(name)}</strong>`);
  html = html.replace(/(<div class="agent-brand-icon">)[^<]+(<\/div>)/, `$1${icon}$2`);
  html = html.replace(/(<div class="agent-brand-text">\s*<h1>)[^<]+(<\/h1>)/, `$1${escapeHtml(name)}$2`);
  html = html.replace(
    /(<div class="agent-brand-text">\s*<h1>[^<]+<\/h1>\s*<p>)[^<]+(<\/p>)/,
    `$1${escapeHtml(statusText)}$2`
  );
  html = html.replace(
    /(<div class="main-title">\s*<span class="status-dot"><\/span>\s*<span>)[^<]+(<\/span>\s*<span class="status-label">)/,
    `$1${escapeHtml(name)}$2`
  );
  html = html.replace(/(<div class="welcome-icon">)[^<]+(<\/div>)/, `$1${icon}$2`);
  html = html.replace(
    /(<div class="welcome" id="welcome">[\s\S]*?<h2>)[^<]+(<\/h2>)/,
    `$1${escapeHtml(welcomeTitle)}$2`
  );
  html = html.replace(
    /(<div class="welcome" id="welcome">[\s\S]*?<h2>[^<]+<\/h2>\s*<p>)[^<]+(<\/p>)/,
    `$1${escapeHtml(welcomeDesc)}$2`
  );

  const suggestHtml = suggestions.map(q =>
    `            <button class="suggest-btn" data-q="${escapeAttr(q)}">${escapeHtml(q)}</button>`
  ).join('\n');
  if (suggestions.length) {
    html = html.replace(/(<div class="suggest-grid">)[\s\S]*?(<\/div>)/, `$1\n${suggestHtml}\n          $2`);
  } else {
    html = html.replace(/<div class="suggest-grid">[\s\S]*?<\/div>/, '<div class="suggest-grid" hidden></div>');
  }

  html = html.replace(
    /(<textarea id="userInput"[^>]*placeholder=")[^"]+(")/,
    `$1${escapeAttr(inputPlaceholder)}$2`
  );

  if (supportsFileUpload) {
    const withUpload = `${inputPlaceholder}（可上传 PDF、Word 等附件）`;
    html = html.replace(
      /userInput\.placeholder = enabled\s*\?[^;]+;/,
      `userInput.placeholder = enabled ? '${escapeJsString(withUpload)}' : '${escapeJsString(inputPlaceholder)}';`
    );
  } else {
    html = html.replace(
      /userInput\.placeholder = enabled\s*\?[^;]+;/,
      `userInput.placeholder = '${escapeJsString(inputPlaceholder)}';`
    );
    html = html.replace(
      /userInput\.placeholder = '[^']*';/,
      `userInput.placeholder = '${escapeJsString(inputPlaceholder)}';`
    );
  }

  html = html.replace(/(<p class="sidebar-foot-tip">)[^<]+(<\/p>)/, `$1${escapeHtml(footTip)}$2`);
  html = html.replace(/(<p class="disclaimer">)[^<]+(<\/p>)/, `$1${escapeHtml(disclaimer)}$2`);

  return html;
}

function injectPublishedHiAgentRuntime(html) {
  html = html.replace(
    /const HIAGENT_ORIGIN =[\s\S]*?function resolveUploadApiBase\(\) \{[\s\S]*?\n\}/,
    PUBLISHED_HIAGENT_RUNTIME
  );
  html = html.replace(
    /if \(normalized\.some\(f => f\.Url && !f\.Url\.startsWith\(HIAGENT_ORIGIN\)\)\)/g,
    'if (normalized.some(f => f.Url && !isHiAgentServiceUrl(f.Url)))'
  );
  html = html.replace(/if \(!isLocalDemoHost\(\)\) \{\s*\n\s*console\.warn\('\[Goalin\] 附件解析需通过 npm start/g,
    "if (!canUseLocalServices()) {\n    console.warn('[Goalin] 附件解析需通过 npm start");
  return html;
}

async function validateAgentCredentials(appId, apiKey) {
  const url = `${HIAGENT_API_BASE_SERVER}/create_conversation`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Apikey: apiKey,
      },
      body: JSON.stringify({
        AppID: appId,
        UserID: `goalin-check-${Date.now()}`,
      }),
    });
  } catch (e) {
    throw new Error(`无法连接 HiAgent API：${e.message || e}`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  const err = data?.ResponseMetadata?.Error;
  if (err) {
    const msg = err.Message || 'API 验证失败';
    if (/disabled|Not enabled/i.test(msg)) {
      throw new Error(
        'HiAgent 应用未开启 API 服务。请在 HiAgent 控制台 → 应用编排 → 发布/对话设置中开启「API 访问」或「API 服务」，并确认 Apikey 与 App ID 匹配后再上架。'
      );
    }
    if (/Apikey|apikey|密钥|Unauthorized/i.test(msg)) {
      throw new Error(`API 密钥无效或与 App ID 不匹配：${msg}`);
    }
    throw new Error(`API 验证失败：${msg}`);
  }
  if (!data?.Conversation?.AppConversationID) {
    throw new Error('API 验证失败：未能创建测试会话，请检查 App ID 与 Apikey');
  }
  return true;
}

function rebuildPublishedAgentHtml(agentMeta) {
  const features = generateCardFeatures(
    agentMeta.name,
    agentMeta.tag,
    agentMeta.supportsFileUpload,
    agentMeta.desc
  );
  const meta = { ...agentMeta, features };
  const html = generateAgentHtml({
    name: meta.name,
    appId: meta.appId,
    apiKey: meta.apiKey,
    icon: meta.icon,
    tag: meta.tag,
    status: meta.status,
    desc: meta.desc,
    welcomeTitle: meta.welcomeTitle,
    welcomeDesc: meta.welcomeDesc,
    inputPlaceholder: meta.inputPlaceholder,
    suggestions: meta.suggestions,
    supportsFileUpload: meta.supportsFileUpload,
    slug: meta.slug,
  });
  const htmlPath = path.join(ROOT, meta.url || `${meta.slug}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');

  const registry = readRegistry();
  const idx = registry.agents.findIndex(a => a.slug === meta.slug);
  if (idx !== -1) {
    registry.agents[idx].features = features;
    writeRegistry(registry);
  }
  return htmlPath;
}

function rebuildAllPublishedAgents() {
  const registry = readRegistry();
  const rebuilt = [];
  for (const agent of registry.agents) {
    if (!agent.apiKey) continue;
    rebuildPublishedAgentHtml(agent);
    rebuilt.push(agent.slug);
  }
  return rebuilt;
}

function generateAgentHtml(options) {
  const content = buildPageContent(options);
  const templatePath = content.supportsFileUpload ? TEMPLATE_WITH_UPLOAD : TEMPLATE_NO_UPLOAD;
  if (!fs.existsSync(templatePath)) {
    throw new Error(`模板文件不存在: ${path.basename(templatePath)}`);
  }

  let html = fs.readFileSync(templatePath, 'utf8');
  const convPrefix = String(options.slug || 'agent_custom').replace(/[^a-z0-9_]/gi, '_');

  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(content.name)} · 高领智能体中心</title>`);
  html = html.replace(/apiKey:\s*'[^']*'/, `apiKey:  '${escapeJsString(options.apiKey)}'`);
  html = html.replace(/appId:\s*'[^']*'/, `appId:   '${escapeJsString(options.appId)}'`);
  html = html.replace(/agentName:\s*'[^']*'/, `agentName: '${escapeJsString(content.name)}'`);
  html = html.replace(/agentIcon:\s*'[^']*'/, `agentIcon: '${escapeJsString(content.icon)}'`);
  html = html.replace(/const CONV_KEY = '[^']+'/, `const CONV_KEY = '${convPrefix}_conv'`);
  html = html.replace(/const CONV_TITLES_KEY = '[^']+'/, `const CONV_TITLES_KEY = '${convPrefix}_conv_titles'`);
  html = adaptPageContent(html, content);
  html = injectPublishedHiAgentRuntime(html);

  return html;
}

function toPublicAgent(agent) {
  const { apiKey, ...rest } = agent;
  return rest;
}

function listPublishedAgents({ includeSecrets = false } = {}) {
  const registry = readRegistry();
  return registry.agents.map(a => (includeSecrets ? a : toPublicAgent(a)));
}

function listAllAgentsForAdmin() {
  const builtin = listBuiltinAgents();
  const published = listPublishedAgents().map(a => ({ ...a, source: a.source || 'published' }));
  const publishedUrls = new Set(published.map(a => a.url));
  const publishedAppIds = new Set(published.map(a => a.appId).filter(Boolean));
  const merged = [
    ...builtin.filter(a => !publishedUrls.has(a.url) && !(a.appId && publishedAppIds.has(a.appId))),
    ...published.sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))),
  ];
  return merged;
}

async function publishAgent(input) {
  const { name, appId, apiKey } = validatePublishInput(input);
  const registry = readRegistry();

  if (registry.agents.some(a => a.appId === appId)) {
    throw new Error('该 App ID 已上架，请勿重复发布');
  }
  if (listBuiltinAgents().some(a => a.appId === appId)) {
    throw new Error('该 App ID 已被内置智能体使用');
  }

  await validateAgentCredentials(appId, apiKey);

  const content = buildPageContent(input);
  const slug = buildSlug(registry, appId);
  const filename = `${slug}.html`;
  const htmlPath = path.join(ROOT, filename);
  const subtitle = String(input.subtitle || '智能法律助手').trim() || '智能法律助手';
  const features = resolveCardFeatures(input, content);

  const agentMeta = {
    id: registry.nextId,
    slug,
    name: content.name,
    icon: content.icon,
    tag: content.tag,
    status: content.status,
    subtitle,
    url: filename,
    desc: content.desc,
    features,
    supportsFileUpload: content.supportsFileUpload,
    welcomeTitle: content.welcomeTitle,
    welcomeDesc: content.welcomeDesc,
    inputPlaceholder: content.inputPlaceholder,
    suggestions: content.suggestions,
    appId,
    apiKey,
    apiKeyHint: `${apiKey.slice(0, 4)}****`,
    publishedAt: new Date().toISOString(),
    source: 'published',
  };

  const html = generateAgentHtml({
    ...input,
    name: content.name,
    appId,
    apiKey,
    icon: content.icon,
    supportsFileUpload: content.supportsFileUpload,
    slug,
  });

  fs.writeFileSync(htmlPath, html, 'utf8');
  registry.nextId += 1;
  registry.agents.push(agentMeta);
  writeRegistry(registry);

  return {
    ok: true,
    agent: toPublicAgent(agentMeta),
    htmlPath: filename,
    url: filename,
  };
}

function deletePublishedAgent(slugOrId) {
  const key = String(slugOrId || '').trim();
  if (!key) throw new Error('缺少智能体标识');

  const registry = readRegistry();
  const idx = registry.agents.findIndex(a => a.slug === key || String(a.id) === key);
  if (idx === -1) throw new Error('智能体不存在或无法删除');

  const agent = registry.agents[idx];
  const htmlPath = path.join(ROOT, agent.url || `${agent.slug}.html`);
  if (htmlPath.startsWith(ROOT) && fs.existsSync(htmlPath)) {
    fs.unlinkSync(htmlPath);
  }

  registry.agents.splice(idx, 1);
  writeRegistry(registry);

  return { ok: true, agent: toPublicAgent(agent) };
}

function getPublishedAgent(slug) {
  const key = String(slug || '').trim();
  const registry = readRegistry();
  const agent = registry.agents.find(a => a.slug === key);
  if (!agent) throw new Error('智能体不存在');
  return toPublicAgent(agent);
}

async function updatePublishedAgent(slug, input) {
  const key = String(slug || '').trim();
  if (!key) throw new Error('缺少智能体标识');

  const registry = readRegistry();
  const idx = registry.agents.findIndex(a => a.slug === key);
  if (idx === -1) throw new Error('智能体不存在或无法修改');

  const existing = registry.agents[idx];
  const name = String(input.name || existing.name).trim();
  if (!name) throw new Error('请填写智能体名称');
  if (name.length > 40) throw new Error('智能体名称不能超过 40 字');

  const appId = String(input.appId || existing.appId).trim();
  const apiKeyInput = String(input.apiKey || '').trim();
  const apiKey = apiKeyInput || existing.apiKey;

  if (!appId) throw new Error('请填写 App ID');
  if (!apiKey) throw new Error('API 密钥缺失');

  if (appId !== existing.appId) {
    if (registry.agents.some(a => a.slug !== key && a.appId === appId)) {
      throw new Error('该 App ID 已被其他上架智能体使用');
    }
    if (listBuiltinAgents().some(a => a.appId === appId)) {
      throw new Error('该 App ID 已被内置智能体使用');
    }
  }

  if (apiKeyInput || appId !== existing.appId) {
    await validateAgentCredentials(appId, apiKey);
  }

  const supportsFileUpload = input.supportsFileUpload === undefined
    ? existing.supportsFileUpload
    : (input.supportsFileUpload === true
      || input.supportsFileUpload === 'true'
      || input.supportsFileUpload === 1
      || input.supportsFileUpload === '1');

  const mergedInput = {
    name,
    appId,
    apiKey,
    icon: input.icon !== undefined ? input.icon : existing.icon,
    tag: input.tag !== undefined ? input.tag : existing.tag,
    status: input.status !== undefined ? input.status : existing.status,
    subtitle: input.subtitle !== undefined ? input.subtitle : existing.subtitle,
    desc: input.desc !== undefined ? input.desc : existing.desc,
    welcomeTitle: input.welcomeTitle !== undefined ? input.welcomeTitle : existing.welcomeTitle,
    welcomeDesc: input.welcomeDesc !== undefined ? input.welcomeDesc : existing.welcomeDesc,
    inputPlaceholder: input.inputPlaceholder !== undefined ? input.inputPlaceholder : existing.inputPlaceholder,
    suggestions: input.suggestions !== undefined ? input.suggestions : existing.suggestions,
    supportsFileUpload,
  };

  const content = buildPageContent(mergedInput);
  const subtitle = String(mergedInput.subtitle || '智能法律助手').trim() || '智能法律助手';
  const features = resolveCardFeatures(input, content);

  const updated = {
    ...existing,
    name: content.name,
    icon: content.icon,
    tag: content.tag,
    status: content.status,
    subtitle,
    desc: content.desc,
    features,
    supportsFileUpload: content.supportsFileUpload,
    welcomeTitle: content.welcomeTitle,
    welcomeDesc: content.welcomeDesc,
    inputPlaceholder: content.inputPlaceholder,
    suggestions: content.suggestions,
    appId,
    apiKey,
    apiKeyHint: `${apiKey.slice(0, 4)}****`,
    updatedAt: new Date().toISOString(),
  };

  const html = generateAgentHtml({
    ...mergedInput,
    name: content.name,
    appId,
    apiKey,
    icon: content.icon,
    supportsFileUpload: content.supportsFileUpload,
    slug: existing.slug,
    welcomeTitle: content.welcomeTitle,
    welcomeDesc: content.welcomeDesc,
    inputPlaceholder: content.inputPlaceholder,
    suggestions: content.suggestions,
  });

  const htmlPath = path.join(ROOT, existing.url || `${existing.slug}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');

  registry.agents[idx] = updated;
  writeRegistry(registry);

  return {
    ok: true,
    agent: toPublicAgent(updated),
    url: updated.url,
  };
}

module.exports = {
  publishAgent,
  updatePublishedAgent,
  getPublishedAgent,
  deletePublishedAgent,
  listPublishedAgents,
  listAllAgentsForAdmin,
  readRegistry,
  generateAgentHtml,
  buildPageContent,
  generateCardFeatures,
  resolveCardFeatures,
  validateAgentCredentials,
  rebuildPublishedAgentHtml,
  rebuildAllPublishedAgents,
  HIAGENT_API_BASE_SERVER,
};
