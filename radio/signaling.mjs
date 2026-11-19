const utf8 = new TextEncoder();
const hex = bytes => Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
export function newId() {return hex(crypto.getRandomValues(new Uint8Array(16)));}
export function pairingURL(input) {
  if (!input.trim()) return new URL('/api/pair',location.origin).href;
  const url=new URL(input.trim());
  if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash)
    throw Error('Enter the HTTPS address of your local pairing service.');
  return new URL('/api/pair',url.origin).href;
}
export async function mailbox(secret, name, url, signal) {
  const raw=Uint8Array.from(secret.match(/../g), x=>parseInt(x,16));
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
  const box=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(secret+'/'+name))));
  const aad=utf8.encode(box);
  async function request(body) {
    const payload = JSON.stringify({...body, box});
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) throw Error('Pairing ended.');
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, {once:true});
      const timer = setTimeout(abort, 5500);
      let retryable = true;
      try {
        const response = await fetch(url, {
          method:'POST', credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer',
          headers:{'Content-Type':'application/json'}, body:payload, signal:controller.signal
        });
        retryable = response.status === 408 || response.status >= 500;
        if (!response.ok) throw Error('The pairing service returned HTTP ' + response.status + '. Check Pairing settings.');
        return await response.json();
      } catch (error) {
        if (signal.aborted) throw Error('Pairing ended.');
        if (!retryable) throw error;
        if (attempt === 1) throw Error('Pairing service unreachable. Check the internet connection or the local service in Pairing settings.');
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }
  return {
    async send(message) {
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,utf8.encode(JSON.stringify(message))));
      const data=new Uint8Array(12+cipher.length);data.set(iv);data.set(cipher,12);
      await request({op:'write',packet:btoa(String.fromCharCode(...data))});
    },
    async read() {
      const {packet}=await request({op:'read'});
      if(!packet)return null;
      try {
        const bytes=Uint8Array.from(atob(packet),c=>c.charCodeAt(0));
        const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12),additionalData:aad},key,bytes.subarray(12));
        return JSON.parse(new TextDecoder().decode(clear));
      } catch {return null;}
    }
  };
}
