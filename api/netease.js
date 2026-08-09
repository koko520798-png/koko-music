// Serverless: 代理转发到VPS上的NeteaseCloudMusicApi（通过3201端口内部转发到3000）
// ⚠️ 注意：网易云API的 /login/qr/create 等接口自己也有 key 参数（网易云的）
//   认证时先从所有key里找 xiaomao520，其余的key原样透传给网易云，不会冲突
const VPS = 'http://149.28.131.92:3201';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 认证：key 可能有多个值（我们的 xiaomao520 + 网易云的 key）
  const keys = [].concat(req.query.key || []);
  if (!keys.includes('xiaomao520')) return res.status(401).json({ error: 'unauthorized' });

  // 拿 path 参数
  const { path: apiPath, key: _allKeys, ...rest } = req.query;
  if (!apiPath) return res.status(400).json({ error: 'missing path' });

  // 把网易云自己的 key（非 xiaomao520 的那些）透传过去
  const neteaseKeys = keys.filter(k => k !== 'xiaomao520');
  const params = { ...rest };
  if (neteaseKeys.length === 1) params.key = neteaseKeys[0];
  else if (neteaseKeys.length > 1) params.key = neteaseKeys;

  // 构建目标URL
  const qs = new URLSearchParams(params).toString();
  const url = `${VPS}/netease${apiPath}${qs ? '?' + qs : ''}`;

  try {
    const opts = { method: req.method, headers: { 'Content-Type': 'application/json' } };
    if (req.method === 'POST' && req.body) {
      opts.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }
    // 透传cookie（登录态）
    if (req.headers.cookie) opts.headers['Cookie'] = req.headers.cookie;

    const vpsRes = await fetch(url, opts);
    const data = await vpsRes.json();

    // 把 Set-Cookie 同时放进响应体（前端 JS 读不到响应头的 Set-Cookie，走响应体取）
    const setCookie = vpsRes.headers.get('set-cookie');
    if (setCookie) {
      res.setHeader('Set-Cookie', setCookie);
      data._cookie = setCookie; // 前端从这里取 cookie 字符串
    }

    return res.status(vpsRes.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'vps error', msg: e.message });
  }
}
