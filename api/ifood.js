// api/ifood.js — Vercel Serverless Function
// Proxy para a API do iFood. Resolve CORS e gerencia autenticação.

const https = require('https');

const CLIENT_ID = process.env.IFOOD_CLIENT_ID;
const CLIENT_SECRET = process.env.IFOOD_CLIENT_SECRET;

// Cache do token (dura enquanto a instância viver)
let cachedToken = null;
let tokenExpiry = 0;

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString()
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Variáveis IFOOD_CLIENT_ID e IFOOD_CLIENT_SECRET não configuradas no Vercel!');
  }

  const body = new URLSearchParams({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    grantType: 'client_credentials'
  }).toString();

  const res = await httpsRequest({
    hostname: 'merchant-api.ifood.com.br',
    path: '/authentication/v1.0/oauth/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);

  if (res.status !== 200) throw new Error(`Erro na autenticação iFood: ${res.body}`);

  const data = JSON.parse(res.body);
  cachedToken = data.accessToken;
  tokenExpiry = Date.now() + ((data.expiresIn || 3600) - 60) * 1000;
  return cachedToken;
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const token = await getToken();

    // Pega o path depois de /api/ifood
    // Ex: /api/ifood/catalog/v1.0/merchants/abc/catalogs
    let targetPath = req.url.replace(/^\/api\/ifood/, '') || '/';
    if (!targetPath.startsWith('/')) targetPath = '/' + targetPath;

    // Monta query string
    const query = req.query ? Object.entries(req.query)
      .filter(([k]) => k !== 'path')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&') : '';

    const fullPath = query ? `${targetPath}?${query}` : targetPath;

    // Lê body da requisição
    const bodyBuffer = await new Promise((resolve) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });

    // Detecta se é multipart (upload de imagem)
    const contentType = req.headers['content-type'] || 'application/json';

    const reqHeaders = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': contentType,
    };

    if (bodyBuffer.length > 0) {
      reqHeaders['Content-Length'] = bodyBuffer.length;
    }

    const ifoodRes = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'merchant-api.ifood.com.br',
        path: fullPath,
        method: req.method,
        headers: reqHeaders
      };

      const request = https.request(options, (r) => {
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => resolve({
          status: r.statusCode,
          headers: r.headers,
          body: Buffer.concat(chunks)
        }));
      });
      request.on('error', reject);
      if (bodyBuffer.length > 0) request.write(bodyBuffer);
      request.end();
    });

    const responseContentType = ifoodRes.headers['content-type'] || 'application/json';
    res.setHeader('Content-Type', responseContentType);
    res.status(ifoodRes.status);
    res.send(ifoodRes.body);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
