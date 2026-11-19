const {exchange} = require('../server/mailbox.cjs');
module.exports = async function pair(req, res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') return res.status(405).json({});
  if (!String(req.headers['content-type']).startsWith('application/json')) return res.status(415).json({});
  try {
    const {getCache} = await import('@vercel/functions');
    const [status,data] = await exchange(getCache(),req.body);
    return res.status(status).json(data);
  } catch { return res.status(503).json({error:'Pairing service unavailable'}); }
};
