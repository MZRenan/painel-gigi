const axios = require('axios');
require('dotenv').config();

const clientId = process.env.IFOOD_CLIENT_ID;
const clientSecret = process.env.IFOOD_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Missing IFOOD_CLIENT_ID or IFOOD_CLIENT_SECRET environment variables.');
  process.exit(1);
}

async function getToken() {
  const params = new URLSearchParams({
    clientId,
    clientSecret,
    grantType: 'client_credentials'
  });
  const response = await axios.post(
    'https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token',
    params.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  console.log('Token:', response.data);
}

getToken().catch(e => console.log('Erro:', e.response?.data || e.message));