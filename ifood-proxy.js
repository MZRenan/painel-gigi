// netlify/functions/ifood-proxy.js
// Proxy para a API do iFood - resolve CORS e gerencia autenticação

const https = require('https');
const http = require('http');

const IFOOD_BASE = 'https://merchant-api.ifood.com.br';
const CLIENT_ID = process.env.IFOOD_CLIENT_ID;
const CLIENT_SECRET = process.env.IFOOD_CLIENT_SECRET;

// Cache simples do token em memória (dura enquanto a function viver)
let cachedToken = null;
let tokenExpiry = 0;

async function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const body = new URLSearchParams({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    grantType: 'client_credentials'
  }).toString();

  const res = await httpRequest({
    hostname: 'merchant-api.ifood.com.br',
    path: '/authentication/v1.0/oauth/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);

  if (res.status !== 200) throw new Error(`Auth failed: ${res.body}`);

  const data = JSON.parse(res.body);
  cachedToken = data.accessToken;
  tokenExpiry = Date.now() + (data.expiresIn - 60) * 1000;
  return cachedToken;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Rota especial: autenticação
  if (event.path.endsWith('/auth/token')) {
    try {
      const token = await getToken();
      return { statusCode: 200, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: token }) };
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  // Todas as outras rotas: proxy para o iFood
  try {
    const token = await getToken();
    const params = event.queryStringParameters || {};
    const queryStr = Object.keys(params).length > 0 ? '?' + new URLSearchParams(params).toString() : '';

    // Remove o prefixo /.netlify/functions/ifood-proxy do path
    let targetPath = event.path.replace(/^\/.netlify\/functions\/ifood-proxy/, '');
    if (!targetPath || targetPath === '/') targetPath = '/';

    const method = event.httpMethod;
    const contentType = event.headers['content-type'] || 'application/json';

    // Upload de imagem: multipart
    let reqBody = event.body;
    let isBase64 = event.isBase64Encoded;

    const reqHeaders = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': contentType,
    };

    if (reqBody) {
      const bodyBuffer = isBase64 ? Buffer.from(reqBody, 'base64') : Buffer.from(reqBody || '', 'utf8');
      reqHeaders['Content-Length'] = bodyBuffer.length;

      const res = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'merchant-api.ifood.com.br',
          path: targetPath + queryStr,
          method,
          headers: reqHeaders
        }, (r) => {
          const chunks = [];
          r.on('data', c => chunks.push(c));
          r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString(), headers: r.headers }));
        });
        req.on('error', reject);
        req.write(bodyBuffer);
        req.end();
      });

      return {
        statusCode: res.status,
        headers: { ...headers, 'Content-Type': res.headers['content-type'] || 'application/json' },
        body: res.body
      };
    } else {
      const res = await httpRequest({
        hostname: 'merchant-api.ifood.com.br',
        path: targetPath + queryStr,
        method,
        headers: reqHeaders
      });

      return {
        statusCode: res.status,
        headers: { ...headers, 'Content-Type': res.headers['content-type'] || 'application/json' },
        body: res.body
      };
    }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
