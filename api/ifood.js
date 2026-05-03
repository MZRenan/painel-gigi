// api/ifood.js — Vercel Serverless Function
const https = require('https');

const CLIENT_ID = process.env.IFOOD_CLIENT_ID;
const CLIENT_SECRET = process.env.IFOOD_CLIENT_SECRET;

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
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Variáveis IFOOD_CLIENT_ID e IFOOD_CLIENT_SECRET não configuradas!');

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

  if (res.status !== 200) throw new Error(`Erro na autenticação iFood: ${res.body.toString()}`);
  const data = JSON.parse(res.body.toString());
  cachedToken = data.accessToken;
  tokenExpiry = Date.now() + ((data.expiresIn || 3600) - 60) * 1000;
  return cachedToken;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const token = await getToken();

    // ✅ CORREÇÃO: O Vercel passa o path como query param "path" no rewrite
    // Ex: req.query.path = "catalog/v1.0/merchants/abc/catalogs"
    let targetPath = '';

    if (req.query && req.query.path) {
      // Vem do rewrite do vercel.json como ?path=catalog/v1.0/...
      targetPath = '/' + (Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path);
    } else {
      // Fallback: tenta extrair do req.url diretamente
      targetPath = req.url.split('?')[0].replace(/^\/api\/ifood/, '') || '/';
    }

    if (!targetPath.startsWith('/')) targetPath = '/' + targetPath;

    // Monta query string sem o param "path" (que é interno)
    const extraQuery = req.query ? Object.entries(req.query)
      .filter(([k]) => k !== 'path')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&') : '';

    const fullPath = extraQuery ? `${targetPath}?${extraQuery}` : targetPath;

    // Lê body
    const bodyBuffer = await new Promise((resolve) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const contentType = req.headers['content-type'] || 'application/json';
    const reqHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': contentType };
    if (bodyBuffer.length > 0) reqHeaders['Content-Length'] = bodyBuffer.length;

    const ifoodRes = await new Promise((resolve, reject) => {
      const r = https.request({
        hostname: 'merchant-api.ifood.com.br',
        path: fullPath,
        method: req.method,
        headers: reqHeaders
      }, (response) => {
        const chunks = [];
        response.on('data', c => chunks.push(c));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      });
      r.on('error', reject);
      if (bodyBuffer.length > 0) r.write(bodyBuffer);
      r.end();
    });

    res.setHeader('Content-Type', ifoodRes.headers['content-type'] || 'application/json');
    res.status(ifoodRes.status).send(ifoodRes.body);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};