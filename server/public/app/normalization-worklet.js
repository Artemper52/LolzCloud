/* K-weighted, gated loudness matching, adapted from LolzCloud's desktop DSP.
   This is bounded loudness matching; no certified LUFS/true-peak claim. */
'use strict';
class LolzCloudLoudness extends AudioWorkletProcessor{
  constructor(){
    super();
    const coefficients=(frequency,q,gain)=>{const k=Math.tan(Math.PI*frequency/sampleRate),a0=1+k/q+k*k;if(gain===undefined)return[1,-2,1,2*(k*k-1)/a0,(1-k/q+k*k)/a0];const vh=10**(gain/20),vb=vh**.4996667741545416;return[(vh+vb*k/q+k*k)/a0,2*(k*k-vh)/a0,(vh-vb*k/q+k*k)/a0,2*(k*k-1)/a0,(1-k/q+k*k)/a0];};
    this.shelf=coefficients(1681.974450955533,.7071752369554196,3.999843853973347);this.highpass=coefficients(38.13547087602444,.5003270373238773);
    this.key='';this.enabled=false;this.channels=[];this.blocks=[];this.energy=this.count=this.totalFrames=this.postFrames=this.gainDb=this.targetDb=0;this.loudness=null;
    this.port.onmessage=event=>{
      const value=event.data||{},enabled=value.enabled===true;
      if(typeof value.key!=='string'||value.key.length>100)return;
      if(value.key!==this.key||enabled&&!this.enabled){this.key=value.key;this.channels=[];this.blocks=[];this.energy=this.count=this.totalFrames=this.postFrames=0;this.loudness=null;this.targetDb=enabled&&Number.isFinite(value.gainDb)?Math.max(-8,Math.min(8,value.gainDb)):0;this.gainDb=this.targetDb;}
      this.enabled=enabled;
    };
  }
  filter(value,c,m){const out=c[0]*value+m[0];m[0]=c[1]*value-c[3]*out+m[1];m[1]=c[2]*value-c[4]*out;return out;}
  process(inputs,outputs){
    const input=inputs[0]||[],output=outputs[0]||[],frames=output[0]?.length||128;
    while(this.channels.length<input.length)this.channels.push([new Float64Array(2),new Float64Array(2)]);
    const destination=this.enabled?this.targetDb:0,step=frames/sampleRate*(this.enabled?1:160);this.gainDb+=Math.max(-step,Math.min(step,destination-this.gainDb));const gain=10**(this.gainDb/20);
    for(let i=0;i<frames;i++){
      for(let channel=0;channel<output.length;channel++){const sample=input[channel]?.[i]??input[0]?.[i]??0;output[channel][i]=Number.isFinite(sample)?sample*gain:0;}
      if(this.enabled){for(let channel=0;channel<input.length;channel++){const raw=input[channel][i],sample=Number.isFinite(raw)?raw:0,m=this.channels[channel],weighted=this.filter(this.filter(sample,this.shelf,m[0]),this.highpass,m[1]);this.energy+=weighted*weighted;}this.count++;this.totalFrames++;}
      this.postFrames++;
      if(this.count>=sampleRate*.4){
        const energy=this.energy/this.count,loudness=-.691+10*Math.log10(Math.max(energy,1e-12));
        if(loudness> -70){this.blocks.push(energy);if(this.blocks.length>1500)this.blocks.shift();const mean=this.blocks.reduce((a,b)=>a+b,0)/this.blocks.length,gated=this.blocks.filter(value=>value>=mean/10);this.loudness=-.691+10*Math.log10(gated.reduce((a,b)=>a+b,0)/Math.max(1,gated.length));if(this.totalFrames>=sampleRate*3)this.targetDb=Math.max(-8,Math.min(8,-14-this.loudness));}
        this.energy=this.count=0;
      }
    }
    if(this.postFrames>=sampleRate){this.postFrames=0;this.port.postMessage({key:this.key,enabled:this.enabled,measured:this.blocks.length>=8,loudness:Number.isFinite(this.loudness)?this.loudness:null,gainDb:this.gainDb,targetDb:this.targetDb,processedFrames:this.totalFrames});}
    return true;
  }
}
registerProcessor('lolzcloud-normalization',LolzCloudLoudness);
