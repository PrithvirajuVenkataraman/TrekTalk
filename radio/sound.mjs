// Eight independent 4-FSK bands carry two bytes per symbol at 16 kHz.
// A guard interval lets room reflections decay before the detector samples.
export const RATE = 16000;
const WINDOW = 256, GUARD = 128, SYMBOL = WINDOW + GUARD;
const SWEEP = 512, GAP = 256, BLOCK = 16;
const waves = Array.from({length:32}, (_, i) => {
  const omega = 2 * Math.PI * (12 + 2*i) / WINDOW;
  return {cos:2*Math.cos(omega), samples:Float32Array.from({length:SYMBOL}, (_, t) =>
    Math.sin(omega*t + (i >> 2)**2 * Math.PI/8))};
});
const chirp = Float32Array.from({length:SWEEP}, (_, t) =>
  Math.sin(2*Math.PI*(1100*t/RATE + 2700*t*t/(2*RATE*SWEEP))) * Math.sin(Math.PI*t/SWEEP));
const referencePower = chirp.reduce((s,x)=>s+x*x,0);
function multiply(a,b) {
  let v=0;
  while(b){if(b&1)v^=a;b>>=1;a=(a<<1)^((a&128)?0x11d:0);}
  return v;
}
// Two parity bytes recover a single corrupt byte per interleaved block.
function parity(block) {
  let p=0,q=0;
  for(let i=0;i<BLOCK;i++){p^=block[i];q^=multiply(i+1,block[i]);}
  return [p,q];
}
function protectedBytes(payload) {
  const rows=Math.ceil(payload.length/BLOCK), out=new Uint8Array(rows*(BLOCK+2));
  for(let r=0;r<rows;r++){
    const row=new Uint8Array(BLOCK+2);
    row.set(payload.subarray(r*BLOCK,(r+1)*BLOCK));
    row.set(parity(row),BLOCK);
    row.forEach((b,i)=>{out[i*rows+r]=b;});
  }
  return out;
}
function recover(bytes,size) {
  const rows=Math.ceil(size/BLOCK), out=new Uint8Array(rows*BLOCK);
  for(let r=0;r<rows;r++){
    const row=Uint8Array.from({length:BLOCK+2},(_,i)=>bytes[i*rows+r]);
    const [p,q]=parity(row), diff=p^row[BLOCK], weighted=q^row[BLOCK+1];
    if(diff && weighted){
      const index=row.subarray(0,BLOCK).findIndex((_,i)=>multiply(i+1,diff)===weighted);
      if(index<0)return null;
      row[index]^=diff;
    }
    out.set(row.subarray(0,BLOCK),r*BLOCK);
  }
  return out.subarray(0,size);
}
export function renderTone(bytes) {
  if(!bytes.length || bytes.length>2048)throw Error('Pairing reply is too large.');
  const protectedData=protectedBytes(bytes);
  const symbols=new Uint8Array(14+protectedData.length);
  // Four calibration symbols exercise each frequency on this speaker and microphone.
  for(let i=0;i<4;i++)symbols.fill(i*85,i*2,i*2+2);
  symbols.set([84,75,bytes.length>>8,bytes.length&255,255^(bytes.length>>8),255^(bytes.length&255)],8);
  symbols.set(protectedData,14);
  const offset=SWEEP+GAP;
  const out=new Float32Array(offset+symbols.length/2*SYMBOL+GAP);
  out.set(chirp.map(x=>x*0.42));
  for(let i=0;i<symbols.length;i+=2){
    const start=offset+i/2*SYMBOL;
    for(let band=0;band<8;band++){
      const tone=(symbols[i+(band>>2)]>>(2*(band%4)))&3;
      const wave=waves[band*4+tone].samples;
      for(let t=0;t<SYMBOL;t++)out[start+t]+=wave[t]*0.102;
    }
    for(let t=0;t<12;t++){out[start+t]*=t/12;out[start+SYMBOL-1-t]*=t/12;}
  }
  return out;
}
export class ToneReader {
  constructor(receive){this.receive=receive;this.buffer=new Float32Array();this.reset();}
  reset(){this.symbol=-1;this.bytes=[];this.gains=new Float64Array(32).fill(1);this.length=0;}
  findSync(data) {
    // Coarse search at two-sample steps, then align to the strongest nearby peak.
    const limit=data.length-SWEEP;
    const score=start=>{
      let dot=0,energy=0;
      for(let i=0;i<SWEEP;i+=2){const v=data[start+i];dot+=v*chirp[i];energy+=v*v;}
      return dot*dot/(energy*referencePower/2+1e-8);
    };
    for(let s=0;s<=limit;s+=2){
      if(score(s)<0.26)continue;
      let best=s,peak=score(s);
      for(let n=s+1;n<=Math.min(limit,s+14);n++){const strength=score(n);if(strength>peak){best=n;peak=strength;}}
      return best;
    }
    return -1;
  }
  push(chunk) {
    const data=new Float32Array(this.buffer.length+chunk.length);
    data.set(this.buffer);data.set(chunk,this.buffer.length);
    let pos=0;
    while(pos<data.length){
      if(this.symbol<0){
        const start=this.findSync(data.subarray(pos));
        if(start<0){pos=Math.max(pos,data.length-SWEEP+1);break;}
        if(data.length-pos-start<SWEEP+GAP){pos+=start;break;}
        pos+=start+SWEEP+GAP;this.symbol=0;
      }
      if(data.length-pos<SYMBOL)break;
      const values=[0,0];
      for(let band=0;band<8;band++){
        let best=0,max=-1;
        for(let n=0;n<4;n++){
          const k=band*4+n, c=waves[k].cos;
          let a=0,b=0;
          for(let t=0;t<WINDOW;t++){const next=data[pos+GUARD-16+t]+c*a-b;b=a;a=next;}
          const power=Math.max(1e-9,a*a+b*b-c*a*b);
          if(this.symbol===n)this.gains[k]=power;
          const normalized=power/Math.max(1e-7,this.gains[k]);
          if(normalized>max){max=normalized;best=n;}
        }
        values[band>>2]|=best<<(2*(band%4));
      }
      pos+=SYMBOL;
      if(this.symbol++<4)continue;
      this.bytes.push(...values);
      if(this.bytes.length===6){
        const [a,b,h,l,ih,il]=this.bytes;
        this.length=h*256+l;
        if(a!==84||b!==75||(h^ih)!==255||(l^il)!==255||!this.length||this.length>2048){this.reset();continue;}
      }
      if(this.length && this.bytes.length===6+Math.ceil(this.length/BLOCK)*(BLOCK+2)){
        const packet=recover(this.bytes.slice(6),this.length);
        this.reset();
        if(packet)this.receive(packet);
      }
    }
    this.buffer=data.slice(pos);
  }
}
