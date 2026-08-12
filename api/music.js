// koko-music 音乐状态/命令代理
// GET /api/music?key=xiaomao520&action=state  → 读 VPS 当前播放状态
// POST /api/music?key=xiaomao520&action=state → 写播放状态（前端上报）
// GET /api/music?key=xiaomao520&action=command → 读控制命令（前端轮询，读后自动清空）
const VPS = 'http://149.28.131.92:3201';
const VPS_SECRET = process.env.VPS_SECRET || '3e2fc2a370be41d27cd698410bb7667149a142201878c844ec6e13faa1574940';
const MCP_KEY = process.env.MCP_KEY || 'xiaomao520';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = req.query.key;
  if (key !== MCP_KEY) return res.status(401).json({ error: 'unauthorized' });

  const action = req.query.action;
  if (!['state', 'command'].includes(action)) {
    return res.status(400).json({ error: 'action must be state or command' });
  }

  const url = `${VPS}/music/${action}?secret=${VPS_SECRET}`;

  try {
    const opts = {
      method: req.method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (req.method === 'POST' && req.body) {
      opts.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }
    const r = await fetch(url, opts);
    const data = await r.json();
    return res.json(data);
  } catch (e) {
    return res.status(502).json({ error: 'vps error', msg: e.message });
  }
}
