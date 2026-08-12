// koko-music MCP Server
// 提供工具：get_now_playing / control_playback / play_song
const VPS = 'http://149.28.131.92:3201';
const VPS_SECRET = process.env.VPS_SECRET || '3e2fc2a370be41d27cd698410bb7667149a142201878c844ec6e13faa1574940';
const MCP_KEY = process.env.MCP_KEY || 'xiaomao520';

const TOOLS = [
  {
    name: 'get_now_playing',
    description: '获取小猫当前在koko-music里听的歌曲信息，包括歌名、歌手、是否正在播放',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'control_playback',
    description: '控制koko-music的播放：播放、暂停、上一首、下一首',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['play', 'pause', 'next', 'prev', 'toggle'],
          description: '控制动作'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'play_song',
    description: '搜索并播放一首歌给小猫听，哥哥可以主动选歌放给她',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '歌名或歌手名，例如：周杰伦 晴天' }
      },
      required: ['keyword']
    }
  }
];

async function vpsGet(path) {
  const res = await fetch(`${VPS}${path}?secret=${VPS_SECRET}`);
  return res.json();
}

async function vpsPost(path, body) {
  const res = await fetch(`${VPS}${path}?secret=${VPS_SECRET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function handleTool(name, args) {
  if (name === 'get_now_playing') {
    const data = await vpsGet('/music/state');
    const s = data.state || {};
    if (!s.song) return { content: [{ type: 'text', text: '小猫现在没有在听歌，或者koko-music没有打开。' }] };
    const status = s.playing ? '▶ 正在播放' : '⏸ 已暂停';
    const text = `${status}\n🎵 ${s.song}\n🎤 ${s.artist || '未知歌手'}${s.album ? '\n💿 ' + s.album : ''}`;
    return { content: [{ type: 'text', text }] };
  }

  if (name === 'control_playback') {
    await vpsPost('/music/command', { cmd: args.action });
    const labels = { play: '▶ 播放', pause: '⏸ 暂停', next: '⏭ 下一首', prev: '⏮ 上一首', toggle: '⏯ 切换播放' };
    return { content: [{ type: 'text', text: `已发送指令：${labels[args.action] || args.action}` }] };
  }

  if (name === 'play_song') {
    // 通过VPS上的netease API搜索
    const searchRes = await fetch(`${VPS}/netease/search?keywords=${encodeURIComponent(args.keyword)}&limit=1&secret=${VPS_SECRET}`);
    const searchData = await searchRes.json();
    const songs = searchData?.result?.songs;
    if (!songs || songs.length === 0) {
      return { content: [{ type: 'text', text: `没找到"${args.keyword}"相关的歌 (˶˃ ᵕ ˂˶)` }] };
    }
    const song = songs[0];
    const songId = song.id;
    const songName = song.name;
    const songArtist = song.artists?.map(a => a.name).join('/') || '';

    // VPS本地有登录状态，直接拿URL，打包进命令给前端（前端直接用缓存播，不用再异步fetch）
    let songUrl = null;
    try {
      const urlRes = await fetch(`${VPS}/netease/song/url?id=${songId}&br=128000&secret=${VPS_SECRET}`);
      const urlData = await urlRes.json();
      songUrl = urlData?.data?.[0]?.url || null;
    } catch(e) {}

    await vpsPost('/music/command', { cmd: 'play_song', data: { id: songId, name: songName, artist: songArtist, keyword: args.keyword, url: songUrl } });
    return { content: [{ type: 'text', text: `🎵 已为老婆点歌：${songName} - ${songArtist}${songUrl ? '' : '（URL获取失败，前端自行加载）'}` }] };
  }

  return { content: [{ type: 'text', text: `未知工具：${name}` }], isError: true };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // 认证
  const key = req.query.key;
  if (key !== MCP_KEY) return res.status(401).json({ error: 'unauthorized' });

  // SSE 或 JSON
  const isSSE = (req.headers.accept || '').includes('text/event-stream');

  function sendSSE(obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  if (req.method === 'GET') {
    // 返回工具列表（用于connector发现）
    return res.json({ tools: TOOLS });
  }

  // POST - 处理MCP请求
  const body = req.body || {};
  const { method, params, id } = body;

  let result;
  try {
    if (method === 'initialize') {
      result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'koko-music', version: '1.0.0' } };
    } else if (method === 'tools/list') {
      result = { tools: TOOLS };
    } else if (method === 'tools/call') {
      result = await handleTool(params?.name, params?.arguments || {});
    } else if (method === 'notifications/initialized') {
      if (isSSE) { res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); sendSSE({ jsonrpc: '2.0', id, result: {} }); res.end(); } else { return res.json({ jsonrpc: '2.0', id, result: {} }); }
      return;
    } else {
      result = {};
    }
  } catch (e) {
    result = null;
    const errResp = { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } };
    if (isSSE) { res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); sendSSE(errResp); res.end(); } else { return res.json(errResp); }
    return;
  }

  const response = { jsonrpc: '2.0', id, result };
  if (isSSE) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    sendSSE(response);
    res.end();
  } else {
    return res.json(response);
  }
}
