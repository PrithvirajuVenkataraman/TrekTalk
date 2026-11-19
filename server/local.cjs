// Run on the trek LAN with a certificate trusted by both phones.
const https = require('node:https');
const fs = require('node:fs');
const {exchange,localStore}=require('./mailbox.cjs');
const [cert,key,port='8443']=process.argv.slice(2);
if(!cert || !key)throw Error('Usage: node server/local.cjs certificate.pem private-key.pem [port]');
const store=localStore();
https.createServer({cert:fs.readFileSync(cert),key:fs.readFileSync(key)},async(req,res)=>{
  const origin=req.headers.origin;
  if(origin && origin!=='https://trektalk.vercel.app'){res.writeHead(403).end();return;}
  res.setHeader('Access-Control-Allow-Origin','https://trektalk.vercel.app');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network','true');
  res.setHeader('Cache-Control','no-store');
  if(req.url!=='/api/pair'){res.writeHead(404).end();return;}
  if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  if(!String(req.headers['content-type']).startsWith('application/json')){res.writeHead(415).end();return;}
  try {
    let body='';
    for await(const part of req){body+=part;if(Buffer.byteLength(body)>30000){res.writeHead(413).end();return;}}
    const [status,result]=await exchange(store,JSON.parse(body));
    res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(result));
  }catch{res.writeHead(400).end();}
}).listen(Number(port),'0.0.0.0',()=>console.log('Local HTTPS pairing service listening on port '+port));
