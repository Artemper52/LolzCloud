#include "include/LCPitchCore.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>

enum { MAX_FFT=16384, OVERLAP=8 };
static const double PI=3.1415926535897932384626433832795;
struct LCPitchCore {
    uint32_t n,hop,channels,position,hopCount,warm,rampFrames,fadeRemaining;
    uint64_t epoch,frames;
    double ratio,target,mix,mixStep;
    double *memory,*input[2],*output[2],*real[2],*imag[2],*phase[2];
    double *window,*cosine,*sine,*magnitude[2],*frequency,*weight,*relativeReal[2],*relativeImag[2],*sumPhase;
    uint64_t *tags,*inputTags,*outputTags;
    uint32_t *reverse,*owners,*previousOwners,*peaks;
    int firstSpectrum,stage;
};
static double clean_sample(double value){return isfinite(value)?fmax(-1e6,fmin(1e6,value)):0;}
static double wrapped(double value){return value-2*PI*floor((value+PI)/(2*PI));}
LCPitchCore *LCPitchCreate(void){return calloc(1,sizeof(LCPitchCore));}
void LCPitchUnprepare(LCPitchCore *s){if(s){free(s->memory);free(s->tags);free(s->reverse);memset(s,0,sizeof *s);}}
void LCPitchDestroy(LCPitchCore *s){if(s){LCPitchUnprepare(s);free(s);}}
int LCPitchPrepare(LCPitchCore *s,double rate,uint32_t channels){
    if(!s||!isfinite(rate)||rate<8000||rate>384000||channels<1||channels>2)return 0;
    LCPitchUnprepare(s);uint32_t n=512;while(n<rate*.04&&n<MAX_FFT)n*=2;
    /* 31*N doubles (<4 MiB at the highest supported rate), fixed 2*N rings.
       Reserve both channels even for mono so the render structure is fixed. */
    s->memory=calloc((size_t)n*31,sizeof(double));s->tags=calloc((size_t)n*4,sizeof(uint64_t));s->reverse=calloc((size_t)n*4,sizeof(uint32_t));
    if(!s->memory||!s->tags||!s->reverse){LCPitchUnprepare(s);return 0;}
    s->n=n;s->hop=n/OVERLAP;s->channels=channels;s->rampFrames=(uint32_t)fmax(64,rate*.025);s->epoch=1;s->ratio=s->target=1;
    double *p=s->memory;
    for(unsigned ch=0;ch<2;ch++){s->input[ch]=p;p+=2*n;s->output[ch]=p;p+=2*n;s->real[ch]=p;p+=n;s->imag[ch]=p;p+=n;s->phase[ch]=p;p+=n;}
    s->window=p;p+=n;s->cosine=p;p+=n;s->sine=p;p+=n;
    for(unsigned ch=0;ch<2;ch++){s->magnitude[ch]=p;p+=n;s->relativeReal[ch]=p;p+=n;s->relativeImag[ch]=p;p+=n;}
    s->frequency=p;p+=n;s->weight=p;p+=n;s->sumPhase=p;
    s->inputTags=s->tags;s->outputTags=s->tags+2*n;
    s->owners=s->reverse+n;s->previousOwners=s->reverse+2*n;s->peaks=s->reverse+3*n;
    for(uint32_t i=0;i<n;i++){
        s->window[i]=.5-.5*cos(2*PI*i/n);s->cosine[i]=cos(2*PI*i/n);s->sine[i]=sin(2*PI*i/n);
        uint32_t value=i,reverse=0;for(uint32_t bit=n;bit>1;bit>>=1){reverse=(reverse<<1)|(value&1);value>>=1;}s->reverse[i]=reverse;
    }
    s->firstSpectrum=1;return 1;
}
void LCPitchReset(LCPitchCore *s){
    if(!s||!s->n)return;s->epoch++;if(!s->epoch)s->epoch=1;s->position=s->hopCount=0;s->frames=0;s->firstSpectrum=1;
    s->ratio=s->target;s->mix=s->target==1?0:1;s->warm=s->target==1?0:s->n;s->stage=0;s->fadeRemaining=0;
}
static void reset_spectrum(LCPitchCore *s,double ratio){
    /* Output tags discard all old phase/tail state without a render memset of
       the history rings. Input remains available on a settings-only change. */
    for(uint32_t i=0;i<2*s->n;i++)s->outputTags[i]=0;
    s->ratio=ratio;s->firstSpectrum=1;s->warm=ratio==1?0:s->n;s->hopCount=0;
}
void LCPitchConfigure(LCPitchCore *s,double ratio,int immediate){
    if(!s||!s->n||!isfinite(ratio)||ratio<.5||ratio>2)return;
    if(immediate){s->target=ratio;LCPitchReset(s);return;}
    if(ratio==s->target)return;s->target=ratio;
    if(s->mix>0){s->stage=1;s->fadeRemaining=s->rampFrames;s->mixStep=-s->mix/s->fadeRemaining;}
    else{reset_spectrum(s,ratio);s->stage=ratio==1?0:2;}
}
static void fft(LCPitchCore *s,double *re,double *im,int inverse){
    uint32_t n=s->n;
    for(uint32_t i=0;i<n;i++){uint32_t j=s->reverse[i];if(j>i){double a=re[i],b=im[i];re[i]=re[j];im[i]=im[j];re[j]=a;im[j]=b;}}
    for(uint32_t width=2;width<=n;width*=2){uint32_t half=width/2,step=n/width;
        for(uint32_t start=0;start<n;start+=width)for(uint32_t j=0;j<half;j++){
            uint32_t a=start+j,b=a+half,k=j*step;double sn=inverse?s->sine[k]:-s->sine[k],co=s->cosine[k];
            double x=re[b]*co-im[b]*sn,y=re[b]*sn+im[b]*co;re[b]=re[a]-x;im[b]=im[a]-y;re[a]+=x;im[a]+=y;
        }
    }
    if(inverse)for(uint32_t i=0;i<n;i++){re[i]/=n;im[i]/=n;}
}
static double input_at(const LCPitchCore *s,unsigned ch,uint32_t index){return s->inputTags[index]==s->epoch?s->input[ch][index]:0;}
static void spectrum(LCPitchCore *s){
    const uint32_t n=s->n,half=n/2,ring=2*n;
    for(uint32_t ch=0;ch<s->channels;ch++){
        for(uint32_t i=0;i<n;i++){uint32_t at=(s->position+ring+1-n+i)%ring;s->real[ch][i]=input_at(s,ch,at)*s->window[i];s->imag[ch][i]=0;}
        fft(s,s->real[ch],s->imag[ch],0);
    }
    for(uint32_t k=0;k<=half;k++){
        double mag[2]={0,0},phase[2]={0,0},omega[2]={0,0},base=2*PI*k/n;
        for(uint32_t ch=0;ch<s->channels;ch++){
            mag[ch]=hypot(s->real[ch][k],s->imag[ch][k]);phase[ch]=atan2(s->imag[ch][k],s->real[ch][k]);
            omega[ch]=base+(s->firstSpectrum?0:wrapped(phase[ch]-s->phase[ch][k]-base*s->hop)/s->hop);s->phase[ch][k]=phase[ch];
            s->magnitude[ch][k]=mag[ch];s->relativeReal[ch][k]=phase[ch];
        }
        unsigned reference=mag[1]>mag[0]?1:0;s->weight[k]=mag[0]+mag[1];s->frequency[k]=omega[reference];s->relativeImag[0][k]=phase[reference];
    }
    /* Identity phase locking: move each peak's complete neighbouring region
       together. Independently mapping Hann side lobes produces destructive
       vertical-phase cancellation, especially for low musical tones. */
    uint32_t peakCount=0;
    for(uint32_t k=1;k<half;k++)if(s->weight[k]>=s->weight[k-1]&&s->weight[k]>s->weight[k+1]&&s->weight[k]>1e-15)s->peaks[peakCount++]=k;
    if(!peakCount){uint32_t largest=0;for(uint32_t k=1;k<=half;k++)if(s->weight[k]>s->weight[largest])largest=k;s->peaks[peakCount++]=largest;}
    uint32_t region=0;for(uint32_t k=0;k<=half;k++){while(region+1<peakCount&&2*k>s->peaks[region]+s->peaks[region+1])region++;s->owners[k]=s->peaks[region];s->weight[k]=s->sumPhase[k];}
    for(uint32_t i=0;i<peakCount;i++){
        uint32_t p=s->peaks[i],previous=s->previousOwners[p];
        double phase=s->firstSpectrum?s->relativeImag[0][p]:s->weight[p];
        if(!s->firstSpectrum&&previous!=p&&previous<=half)phase=s->weight[previous]+wrapped(s->relativeImag[0][p]-s->relativeImag[0][previous]);
        s->sumPhase[p]=wrapped(phase+s->frequency[p]*s->ratio*s->hop);
    }
    for(uint32_t ch=0;ch<s->channels;ch++){memset(s->real[ch],0,n*sizeof(double));memset(s->imag[ch],0,n*sizeof(double));}
    for(uint32_t k=0;k<=half;k++){
        uint32_t p=s->owners[k];int target=(int)floor(p*s->ratio+.5)+(int)k-(int)p;
        double frequency=s->frequency[p]*s->ratio;
        if(target<0||target>(int)half||frequency<0||frequency>=PI)continue;
        for(uint32_t ch=0;ch<s->channels;ch++){
            double phase=s->sumPhase[p]+s->relativeReal[ch][k]-s->relativeImag[0][p];
            double a=s->magnitude[ch][k]*cos(phase),b=(target==0||target==(int)half)?0:s->magnitude[ch][k]*sin(phase);
            s->real[ch][target]+=a;s->imag[ch][target]+=b;
        }
    }
    for(uint32_t k=0;k<=half;k++){s->previousOwners[k]=s->owners[k];if(k&&k<half)for(uint32_t ch=0;ch<s->channels;ch++){s->real[ch][n-k]=s->real[ch][k];s->imag[ch][n-k]=-s->imag[ch][k];}}
    for(uint32_t ch=0;ch<s->channels;ch++)fft(s,s->real[ch],s->imag[ch],1);
    for(uint32_t i=0;i<n;i++){
        uint32_t at=(s->position+1+i)%ring;
        if(s->outputTags[at]!=s->epoch){s->output[0][at]=s->output[1][at]=0;s->outputTags[at]=s->epoch;}
        for(uint32_t ch=0;ch<s->channels;ch++)s->output[ch][at]+=clean_sample(s->real[ch][i]*s->window[i]/3);
    }
    s->firstSpectrum=0;
}
void LCPitchFrame(LCPitchCore *s,const double input[2],double dry[2],double shifted[2]){
    if(!s||!s->n){dry[0]=shifted[0]=input[0];dry[1]=shifted[1]=input[1];return;}
    uint32_t p=s->position,n=s->n,ring=2*n;
    for(uint32_t ch=0;ch<s->channels;ch++){s->input[ch][p]=clean_sample(input[ch]);dry[ch]=input_at(s,ch,(p+n)%ring);}
    s->inputTags[p]=s->epoch;
    for(uint32_t ch=0;ch<s->channels;ch++){
        double wet=s->outputTags[p]==s->epoch?clean_sample(s->output[ch][p]):0;
        shifted[ch]=dry[ch]+(wet-dry[ch])*s->mix;
    }
    s->outputTags[p]=0;
    if(s->ratio!=1&&++s->hopCount==s->hop){s->hopCount=0;spectrum(s);}
    if(s->warm)s->warm--;
    if(s->stage==1||s->stage==3){
        s->mix+=s->mixStep;
        if(s->fadeRemaining&&!--s->fadeRemaining){
            if(s->stage==1){s->mix=0;reset_spectrum(s,s->target);s->stage=s->target==1?0:2;}
            else{s->mix=1;s->stage=0;}
        }
    }else if(s->stage==2&&!s->warm){s->stage=3;s->fadeRemaining=s->rampFrames;s->mixStep=(1-s->mix)/s->fadeRemaining;}
    if(++s->position==ring)s->position=0;s->frames++;
}
uint32_t LCPitchLatency(const LCPitchCore *s){return s?s->n:0;}
int LCPitchReady(const LCPitchCore *s){return s&&s->n&&!s->warm&&!s->stage&&s->ratio==s->target;}
double LCPitchRatio(const LCPitchCore *s){return s?s->target:1;}
