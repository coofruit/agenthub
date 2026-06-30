const agentPublish = require('./agent-publish.cjs');

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  return JSON.parse(raw.toString('utf8'));
}

async function handleAgentRoutes(req, res, pathname, corsHeaders, { requireAdmin }) {
  try {
    if (pathname === '/api/agents/published' && req.method === 'GET') {
      const agents = agentPublish.listPublishedAgents();
      return sendJson(res, 200, { ok: true, agents }, corsHeaders);
    }

    if (pathname === '/api/admin/agents' && req.method === 'GET') {
      const admin = await requireAdmin(req);
      if (!admin) return sendJson(res, 403, { error: '需要管理员权限' }, corsHeaders);
      const agents = agentPublish.listAllAgentsForAdmin();
      return sendJson(res, 200, { ok: true, agents }, corsHeaders);
    }

    if (pathname === '/api/admin/agents/publish' && req.method === 'POST') {
      const admin = await requireAdmin(req);
      if (!admin) return sendJson(res, 403, { error: '需要管理员权限' }, corsHeaders);
      const body = await readJson(req);
      const result = await agentPublish.publishAgent(body);
      return sendJson(res, 200, result, corsHeaders);
    }

    const agentSlugMatch = pathname.match(/^\/api\/admin\/agents\/([^/]+)$/);
    if (agentSlugMatch) {
      const slug = decodeURIComponent(agentSlugMatch[1]);
      const admin = await requireAdmin(req);
      if (!admin) return sendJson(res, 403, { error: '需要管理员权限' }, corsHeaders);

      if (req.method === 'GET') {
        const agent = agentPublish.getPublishedAgent(slug);
        return sendJson(res, 200, { ok: true, agent }, corsHeaders);
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const result = await agentPublish.updatePublishedAgent(slug, body);
        return sendJson(res, 200, result, corsHeaders);
      }
      if (req.method === 'DELETE') {
        const result = agentPublish.deletePublishedAgent(slug);
        return sendJson(res, 200, result, corsHeaders);
      }
    }

    const rebuildMatch = pathname.match(/^\/api\/admin\/agents\/([^/]+)\/rebuild$/);
    if (rebuildMatch && req.method === 'POST') {
      const admin = await requireAdmin(req);
      if (!admin) return sendJson(res, 403, { error: '需要管理员权限' }, corsHeaders);
      const registry = agentPublish.readRegistry();
      const agent = registry.agents.find(a => a.slug === decodeURIComponent(rebuildMatch[1]));
      if (!agent) return sendJson(res, 404, { error: '智能体不存在' }, corsHeaders);
      agentPublish.rebuildPublishedAgentHtml(agent);
      return sendJson(res, 200, { ok: true, agent: { slug: agent.slug, url: agent.url } }, corsHeaders);
    }

    return false;
  } catch (e) {
    const msg = String(e.message || e);
    const clientError = /请填写|格式|已上架|已被内置|不存在|无法删除|无法修改|缺少|HiAgent|API |无法连接|验证失败|密钥/.test(msg);
    const status = clientError ? 400 : 500;
    sendJson(res, status, { error: msg }, corsHeaders);
    return true;
  }
}

module.exports = { handleAgentRoutes };
