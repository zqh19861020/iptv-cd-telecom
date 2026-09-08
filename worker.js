export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');

    // 只处理 /udpxy/xxx 路径
    if (pathParts[1] !== 'udpxy' || !pathParts[2]) {
      return new Response('Not Found', { status: 404 });
    }

    // 构建 context 参数
    const context = {
      params: { domain: pathParts[2] },
      request: request
    };

    // 调用代理逻辑
    return await onRequest(context);
  }
};

// ========== 完整代理逻辑 ==========
async function onRequest(context) {
  if (!context.params.domain) {
    return new Response('udpxy参数错误，例：https://iptv.zsdc.eu.org/udpxy/192.168.100.1:4022');
  }

  const response = await fetch('https://iptv.zsdc.eu.org/home/udpxy_iptv.m3u8', { method: 'GET' });
  let m3uText = await response.text();

  const url = new URL(context.request.url);
  if (url.searchParams.get('aptv')) {
    m3uText = m3uText.replaceAll('{utc:YmdHMS}-{utcend:YmdHMS}', '${(b)yyyyMMddHHmmss}-${(e)yyyyMMddHHmmss}');
  }

  const parts = context.params.domain.split('-');
  const schema = parts.length > 1 ? parts[0] : 'http';
  const domain = parts.length > 1 ? parts[1] : parts[0];
  m3uText = m3uText.replaceAll('http://192.168.100.1:4022', `${schema}://${domain}`);

  const fcc = url.searchParams.get('fcc');
  const r2hToken = url.searchParams.get('r2hToken');
  const excludeParam = url.searchParams.get('exclude');
  let rtspProxy = url.searchParams.get('rtspProxy');
  if (rtspProxy && !rtspProxy.startsWith('http')) {
    rtspProxy = `http://${rtspProxy}`;
  }

  // 黑名单过滤
  if (excludeParam) {
    const keywords = excludeParam.split(',').map(k => k.trim());
    const out = [];
    let pending = [];
    let drop = false;
    for (const line of m3uText.split('\n')) {
      if (line.startsWith('#KODIPROP')) {
        pending.push(line);
      } else if (line.startsWith('#EXTINF')) {
        const name = ((line.match(/tvg-name="([^"]*)"/) || [])[1] || '').toLowerCase();
        drop = keywords.some(k => name.includes(k.toLowerCase()));
        if (!drop) out.push(...pending, line);
        pending = [];
      } else {
        if (!drop) out.push(line);
        if (!line.startsWith('#')) drop = false;
      }
    }
    m3uText = out.join('\n');
  }

  let lines = m3uText.split('\n');
  lines.forEach((line, index) => {
    if (fcc && line.indexOf('/udp/') > 0) {
      const urlObj = new URL(line);
      line = line + `${urlObj.searchParams.size > 0 ? '&' : '?'}fcc=${fcc}`;
      if (r2hToken) {
        const urlObj2 = new URL(line);
        line = line + `${urlObj2.searchParams.size > 0 ? '&' : '?'}r2h-token=${r2hToken}`;
      }
    }
    if (rtspProxy && line.indexOf('catchup-source="rtsp://') > 0) {
      line = line.replaceAll('catchup-source="rtsp://', `catchup-source="${rtspProxy}/rtsp/`);
      line = line.replaceAll('/PLTV/', ':554/PLTV/');
      if (r2hToken) {
        const match = line.match(/catchup-source="([^"]+)"/);
        if (match) {
          const urlObj = new URL(match[1]);
          const tmp = `${match[1]}${urlObj.searchParams.size > 0 ? '&' : '?'}r2h-token=${r2hToken}`;
          line = line.replaceAll(match[1], tmp);
        }
      }
    }
    lines[index] = line;
  });
  m3uText = lines.join('\n');

  return new Response(m3uText, {
    headers: { 'Content-Type': 'application/vnd.apple.mpegurl' }
  });
}
