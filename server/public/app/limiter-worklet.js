/* Eight millisecond lookahead sample-peak limiter, from desktop tempo-worklet.
   Processing stays in the audio thread and sanitizes non-finite input. */
'use strict';
class LolzCloudLimiter extends AudioWorkletProcessor{
  static get parameterDescriptors(){return[{name:'ceilingDb',defaultValue:-3,minValue:-24,maxValue:0,automationRate:'k-rate'}];}
  constructor(){super();this.delay=Math.max(1,Math.ceil(sampleRate*.008));this.buffers=[];this.cursor=0;this.gain=1;this.hold=0;this.attack=Math.exp(-1/(sampleRate*.001));this.release=Math.exp(-1/(sampleRate*.16));this.frames=this.totalFrames=this.peak=0;this.minimumGain=1;}
  process(inputs,outputs,parameters){
    const input=inputs[0]||[],output=outputs[0]||[],frames=output[0]?.length||128,ceiling=10**(parameters.ceilingDb[0]/20);let peak=0;
    for(const channel of input)for(const sample of channel)if(Number.isFinite(sample))peak=Math.max(peak,Math.abs(sample));
    const desired=peak>ceiling?ceiling/peak:1;if(desired<this.gain)this.hold=Math.ceil(sampleRate*.035);
    while(this.buffers.length<output.length)this.buffers.push(new Float32Array(this.delay));
    for(let i=0;i<frames;i++){
      if(desired<this.gain)this.gain=desired+this.attack*(this.gain-desired);else if(this.hold<=0)this.gain=desired+this.release*(this.gain-desired);this.hold=Math.max(0,this.hold-1);
      for(let channel=0;channel<output.length;channel++){const buffer=this.buffers[channel],value=buffer[this.cursor]*this.gain,sample=input[channel]?.[i]??input[0]?.[i]??0;buffer[this.cursor]=Number.isFinite(sample)?sample:0;output[channel][i]=Number.isFinite(value)?Math.max(-ceiling,Math.min(ceiling,value)):0;}
      this.cursor=(this.cursor+1)%this.delay;
    }
    this.peak=Math.max(this.peak,peak);this.minimumGain=Math.min(this.minimumGain,this.gain);this.frames+=frames;if(input.length)this.totalFrames+=frames;
    if(this.frames>=sampleRate*.1){this.port.postMessage({processedFrames:this.totalFrames,peakDb:this.peak?Math.max(-96,20*Math.log10(this.peak)):-96,reductionDb:Math.max(0,-20*Math.log10(this.minimumGain))});this.frames=0;this.peak=0;this.minimumGain=1;}
    return true;
  }
}
registerProcessor('lolzcloud-limiter',LolzCloudLimiter);
