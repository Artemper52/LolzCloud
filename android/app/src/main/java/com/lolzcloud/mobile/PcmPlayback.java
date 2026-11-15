package com.lolzcloud.mobile;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.*;
import android.net.Uri;
import android.os.*;
import java.io.*;
import java.net.URL;
import java.nio.*;
import java.util.Locale;
import java.util.concurrent.*;
import javax.net.ssl.HttpsURLConnection;

/** One decoder/AudioTrack. No hidden MediaPlayer, HTML audio or remote processing. */
public final class PcmPlayback {
    public interface Listener {void prepared(PcmPlayback player);void seeked(PcmPlayback player,long epoch);void completed(PcmPlayback player,long epoch);void stateChanged(PcmPlayback player);void failed(PcmPlayback player,String message);}
    public static final class Snapshot {
        public final String state;public final long requestedRevision,appliedRevision,acceptedFrames,playedFrames,steadyFrames;public final int sampleRate,channels,audioSession,outputEncoding;
        public final double inputRms,outputRms,peak,silentOutputEnergy,normalizationDb,loudness,limiterReductionDb;public final boolean normalizationMeasured;public final double[] outputBuckets;
        public final float speed,pitch,volume;
        public final int bufferFrames,startThresholdFrames;
        Snapshot(String state,long requested,long applied,long accepted,long played,long steady,int rate,int channels,int session,int encoding,double input,double output,double peak,double silent,double gain,double loudness,boolean measured,double reduction,double[] buckets,float speed,float pitch,float volume,int bufferFrames,int startThresholdFrames){this.state=state;requestedRevision=requested;appliedRevision=applied;acceptedFrames=accepted;playedFrames=played;steadyFrames=steady;sampleRate=rate;this.channels=channels;audioSession=session;outputEncoding=encoding;inputRms=input;outputRms=output;this.peak=peak;silentOutputEnergy=silent;normalizationDb=gain;this.loudness=loudness;normalizationMeasured=measured;limiterReductionDb=reduction;outputBuckets=buckets;this.speed=speed;this.pitch=pitch;this.volume=volume;this.bufferFrames=bufferFrames;this.startThresholdFrames=startThresholdFrames;}
    }
    private static final ThreadPoolExecutor WORKERS=new ThreadPoolExecutor(2,2,30,TimeUnit.SECONDS,new ArrayBlockingQueue<Runnable>(2),task->{Thread thread=new Thread(task,"LolzCloud-PCM");thread.setDaemon(true);return thread;},new ThreadPoolExecutor.AbortPolicy());
    private static final java.util.Set<String> ACTIVE_SOURCES=new java.util.HashSet<>();
    private final Context context;private final String address;private final Listener listener;private final Handler main=new Handler(Looper.getMainLooper());private final Object lock=new Object();
    private final CancellationSignal cancellation=new CancellationSignal();private final PcmDsp.Meter meter=new PcmDsp.Meter();private final PowerManager.WakeLock wake;
    private volatile boolean closed,ready,wanted,seeking;private volatile long positionMs,lengthMs,epoch;private volatile PcmDsp.Config desired;private volatile float speed=1,pitch=1,volume=1;
    private Future<?> future;private volatile HttpsURLConnection connection;private AudioTrack track;private MediaExtractor extractor;private MediaCodec codec;private PcmDsp dsp;
    private int rate,channels,encoding=AudioFormat.ENCODING_PCM_16BIT,outputEncoding,bufferFrames,startThresholdFrames;private long seekUs,handledEpoch=-1,baseUs,writtenFrames,headFrames,lastRawHead,headWrap,revisionStartFrame,lastProgress,lastWake;
    private boolean raw,inputEnded,outputEnded,completed,formatAnnounced,notifiedPlaying;private long sourceFrames;private float appliedSpeed=-1,appliedPitch=-1,appliedVolume=-1;private File temporary;
    private final float[] input=new float[2048],output=new float[2048];private final short[] shorts=new short[2048];
    public PcmPlayback(Context context,String address,long initialPosition,PcmDsp.Config config,Listener listener){
        this.context=context.getApplicationContext();this.address=address;this.listener=listener;desired=config;seekUs=Math.max(0,initialPosition)*1000;positionMs=Math.max(0,initialPosition);
        PowerManager.WakeLock lease=((PowerManager)context.getSystemService(Context.POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"LolzCloud:PCM");lease.setReferenceCounted(false);wake=lease;
    }
    public void prepare(){try{WORKERS.purge();future=WORKERS.submit(this::run);}catch(RejectedExecutionException busy){fail("Аудиосистема завершает предыдущую запись. Нажми «Повторить»");}}
    public boolean prepared(){return ready&&!closed;}public long duration(){return lengthMs;}public long position(){return positionMs;}public long epoch(){return epoch;}public boolean seeking(){return seeking;}
    public boolean playing(){synchronized(lock){try{return !closed&&ready&&wanted&&!seeking&&track!=null&&track.getPlayState()==AudioTrack.PLAYSTATE_PLAYING;}catch(IllegalStateException unavailable){return false;}}}
    public void play(){synchronized(lock){if(closed)return;if(completed){seekUs=0;positionMs=0;seeking=true;epoch++;}wanted=true;lock.notifyAll();}}
    public void pause(){synchronized(lock){wanted=false;pauseSink();lock.notifyAll();}releaseWake();}
    public void seek(long milliseconds){synchronized(lock){seekUs=Math.max(0,lengthMs>0?Math.min(milliseconds,lengthMs):milliseconds)*1000;positionMs=seekUs/1000;seeking=true;epoch++;pauseSink();lock.notifyAll();}}
    public void configure(PcmDsp.Config config){desired=config;synchronized(lock){lock.notifyAll();}}
    public void parameters(float speed,float pitch){this.speed=speed;this.pitch=pitch;synchronized(lock){lock.notifyAll();}}
    public void volume(float value){volume=Math.max(0,Math.min(1,value));synchronized(lock){if(track!=null&&!closed){try{if(track.setVolume(volume)==AudioTrack.SUCCESS)appliedVolume=volume;}catch(IllegalStateException ignored){}}lock.notifyAll();}}
    public void close(){synchronized(lock){if(closed)return;closed=true;wanted=false;pauseSink();lock.notifyAll();}cancellation.cancel();HttpsURLConnection active=connection;if(active!=null)active.disconnect();if(future!=null)future.cancel(true);WORKERS.purge();releaseWake();}
    public Snapshot snapshot(){synchronized(lock){long applied=meter.revision==desired.revision&&meter.acceptedFrames>0&&headFrames>revisionStartFrame?meter.revision:0;String state=closed?"released":!ready?"preparing":!desired.processing()?"bypassed":applied>0?"applied":"pending";double samples=Math.max(1,meter.steadyFrames*channels);return new Snapshot(state,desired.revision,applied,meter.acceptedFrames,headFrames,meter.steadyFrames,rate,channels,track==null?0:track.getAudioSessionId(),outputEncoding,Math.sqrt(meter.steadyInputEnergy/samples),Math.sqrt(meter.steadyOutputEnergy/samples),meter.peak,meter.silentOutputEnergy,dsp==null?0:dsp.normalizationDb(),dsp==null?Double.NaN:dsp.loudness(),dsp!=null&&dsp.measured(),dsp==null?0:dsp.reductionDb(),meter.outputBuckets.clone(),appliedSpeed,appliedPitch,appliedVolume,bufferFrames,startThresholdFrames);}}
    private void run(){
        try{
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);holdWake();openSource();if(closed)return;
            MediaFormat format=null;for(int i=0;i<extractor.getTrackCount();i++){MediaFormat candidate=extractor.getTrackFormat(i);String mime=candidate.getString(MediaFormat.KEY_MIME);if(mime!=null&&mime.startsWith("audio/")){format=candidate;extractor.selectTrack(i);break;}}
            if(format==null)throw new IOException("В файле не найден поддерживаемый аудиопоток");String mime=format.getString(MediaFormat.KEY_MIME);lengthMs=format.containsKey(MediaFormat.KEY_DURATION)?Math.max(0,format.getLong(MediaFormat.KEY_DURATION)/1000):0;raw="audio/raw".equals(mime);
            if(raw)outputFormat(format);else{codec=MediaCodec.createDecoderByType(mime);codec.configure(format,null,null,0);codec.start();}
            lastProgress=SystemClock.elapsedRealtime();MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();ByteBuffer rawBuffer=raw?ByteBuffer.allocateDirect(65536).order(ByteOrder.nativeOrder()):null;
            while(!closed){
                if(epoch!=handledEpoch)discontinuity();
                if(epoch!=handledEpoch)continue;
                if(ready&&!wanted){synchronized(lock){pauseSink();releaseWake();lastProgress=SystemClock.elapsedRealtime();if(!closed&&epoch==handledEpoch&&!wanted)lock.wait(50);}continue;}
                holdWake();applyControls();
                if(outputEnded){drain();continue;}
                boolean progress=false;
                if(raw){rawBuffer.clear();int count=extractor.readSampleData(rawBuffer,0);long timestamp=extractor.getSampleTime();if(count<0){endOutput();}else{rawBuffer.limit(count);render(rawBuffer,timestamp);extractor.advance();}progress=true;}
                else{
                    if(!inputEnded){int slot=codec.dequeueInputBuffer(10000);if(slot>=0){ByteBuffer bytes=codec.getInputBuffer(slot);if(bytes==null)throw new IOException("Декодер не предоставил буфер");int count=extractor.readSampleData(bytes,0);if(count<0){codec.queueInputBuffer(slot,0,0,0,MediaCodec.BUFFER_FLAG_END_OF_STREAM);inputEnded=true;}else{codec.queueInputBuffer(slot,0,count,extractor.getSampleTime(),0);extractor.advance();}progress=true;}}
                    int slot=codec.dequeueOutputBuffer(info,10000);
                    if(slot==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){outputFormat(codec.getOutputFormat());progress=true;}
                    else if(slot>=0){try{if(info.size>0&&(info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)==0){ByteBuffer bytes=codec.getOutputBuffer(slot);if(bytes==null||info.size>4*1024*1024)throw new IOException("Некорректный PCM буфер декодера");bytes.position(info.offset);bytes.limit(info.offset+info.size);render(bytes,info.presentationTimeUs);}}finally{codec.releaseOutputBuffer(slot,false);}if((info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0)endOutput();progress=true;}
                }
                pollHead();if(progress)lastProgress=SystemClock.elapsedRealtime();else if(SystemClock.elapsedRealtime()-lastProgress>20000)throw new IOException("Декодер долго не отвечает. Нажми «Повторить»");
            }
        }catch(InterruptedException cancelled){Thread.currentThread().interrupt();}
        catch(Exception failure){if(!closed)fail(failure instanceof IOException?failure.getMessage():"Этот формат или устройство не поддерживает PCM обработку. Выключи обработку или выбери другую запись");}
        finally{
            ready=false;synchronized(lock){if(track!=null){try{track.pause();track.flush();track.release();}catch(RuntimeException ignored){}track=null;}}
            if(codec!=null){try{codec.stop();}catch(RuntimeException ignored){}try{codec.release();}catch(RuntimeException ignored){}}if(extractor!=null)try{extractor.release();}catch(RuntimeException ignored){}
            if(temporary!=null)releaseSource(temporary);releaseWake();
        }
    }
    private void openSource()throws IOException{
        extractor=new MediaExtractor();Uri uri=Uri.parse(address);
        if("https".equals(uri.getScheme())){temporary=temporarySource(context.getCacheDir());download(temporary);if(closed)throw new IOException("Операция отменена");extractor.setDataSource(temporary.getAbsolutePath());}
        else if("content".equals(uri.getScheme())){try(AssetFileDescriptor descriptor=context.getContentResolver().openAssetFileDescriptor(uri,"r",cancellation)){if(descriptor==null)throw new IOException("Нет доступа к выбранному аудиофайлу");if(descriptor.getDeclaredLength()<0)extractor.setDataSource(descriptor.getFileDescriptor());else extractor.setDataSource(descriptor.getFileDescriptor(),descriptor.getStartOffset(),descriptor.getDeclaredLength());}}
        else if("file".equals(uri.getScheme())&&LibraryStore.isPlayable(context,address))extractor.setDataSource(uri.getPath());
        else throw new IOException("Этот источник не поддерживает нативную обработку");
    }
    private static synchronized File temporarySource(File cache)throws IOException{
        File root=cache.getCanonicalFile();File[] old=root.listFiles();if(old!=null)for(File file:old)if(file.isFile()&&file.getName().matches("pcm-source-[A-Za-z0-9-]+\\.audio")&&!ACTIVE_SOURCES.contains(file.getCanonicalPath()))file.delete();
        File file=File.createTempFile("pcm-source-",".audio",root);ACTIVE_SOURCES.add(file.getCanonicalPath());return file;
    }
    private static synchronized void releaseSource(File file){try{ACTIVE_SOURCES.remove(file.getCanonicalPath());file.delete();}catch(IOException ignored){}}
    /** Private bounded compressed cache permits deterministic local seeking; never uploads a file. */
    private void download(File destination)throws IOException{
        if(!LibraryStore.isDirectHttps(Uri.parse(address)))throw new IOException("Недопустимый аудиоисточник");
        HttpsURLConnection request=(HttpsURLConnection)new URL(address).openConnection();connection=request;long deadline=SystemClock.elapsedRealtime()+28000;final int limit=20*1024*1024;
        try{request.setInstanceFollowRedirects(false);request.setUseCaches(false);request.setConnectTimeout(7000);request.setReadTimeout(8000);request.setRequestProperty("Accept","audio/*, application/octet-stream");request.setRequestProperty("User-Agent","LolzCloud-Android");int status=request.getResponseCode();if(status!=200)throw new IOException("Не удалось загрузить поток для обработки (HTTP "+status+"). Нажми «Повторить»");String type=request.getContentType();if(type==null||!(type.toLowerCase(Locale.ROOT).startsWith("audio/")||type.toLowerCase(Locale.ROOT).startsWith("application/octet-stream")))throw new IOException("Источник не отдал поддерживаемый аудиофайл");if(request.getContentLengthLong()>limit)throw new IOException("Для обработки доступны потоки до20МБ. Выключи обработку для этого источника");
            try(InputStream input=request.getInputStream();OutputStream output=new BufferedOutputStream(new FileOutputStream(destination))){byte[] buffer=new byte[32768];int count,total=0;while((count=input.read(buffer))!=-1){if(closed||Thread.currentThread().isInterrupted())throw new IOException("Операция отменена");if(SystemClock.elapsedRealtime()>deadline)throw new IOException("Загрузка для обработки заняла слишком много времени. Нажми «Повторить»");if(total+count>limit)throw new IOException("Для обработки доступны потоки до20МБ. Выключи обработку для этого источника");output.write(buffer,0,count);total+=count;}if(total==0)throw new IOException("Источник вернул пустое аудио");}
        }finally{if(connection==request)connection=null;request.disconnect();}
    }
    private void outputFormat(MediaFormat format)throws IOException{
        int nextRate=format.getInteger(MediaFormat.KEY_SAMPLE_RATE),nextChannels=format.getInteger(MediaFormat.KEY_CHANNEL_COUNT),nextEncoding=format.containsKey(MediaFormat.KEY_PCM_ENCODING)?format.getInteger(MediaFormat.KEY_PCM_ENCODING):AudioFormat.ENCODING_PCM_16BIT;
        if(nextRate<8000||nextRate>192000||nextChannels<1||nextChannels>2||nextEncoding!=AudioFormat.ENCODING_PCM_16BIT&&nextEncoding!=AudioFormat.ENCODING_PCM_FLOAT&&nextEncoding!=AudioFormat.ENCODING_PCM_8BIT)throw new IOException("Обработка поддерживает mono/stereo PCM8/16/float, 8–192кГц. Выключи обработку для этого файла");
        if(ready){if(rate!=nextRate||channels!=nextChannels||encoding!=nextEncoding)throw new IOException("Источник изменил формат PCM во время воспроизведения");return;}
        rate=nextRate;channels=nextChannels;encoding=nextEncoding;dsp=new PcmDsp(rate,channels,desired);
        int mask=channels==1?AudioFormat.CHANNEL_OUT_MONO:AudioFormat.CHANNEL_OUT_STEREO;RuntimeException last=null;
        for(int candidate:new int[]{AudioFormat.ENCODING_PCM_FLOAT,AudioFormat.ENCODING_PCM_16BIT})try{int minimum=AudioTrack.getMinBufferSize(rate,mask,candidate);if(minimum<=0)continue;int size=Math.max(minimum*4,rate*channels*(candidate==AudioFormat.ENCODING_PCM_FLOAT?4:2)/10);if(size>4*1024*1024)continue;AudioTrack created=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()).setAudioFormat(new AudioFormat.Builder().setEncoding(candidate).setSampleRate(rate).setChannelMask(mask).build()).setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(size).build();if(created.getState()!=AudioTrack.STATE_INITIALIZED){created.release();continue;}synchronized(lock){track=created;outputEncoding=candidate;meter.reset(desired.revision,rate,channels);}break;}catch(RuntimeException unsupported){last=unsupported;}
        if(track==null)throw new IOException("AudioTrack не поддерживает PCM вывод на этом устройстве",last);
        bufferFrames=track.getBufferSizeInFrames();startThresholdFrames=bufferFrames;
        if(Build.VERSION.SDK_INT>=31)try{startThresholdFrames=track.setStartThresholdInFrames(Math.min(track.getBufferCapacityInFrames(),Math.max(1,rate/100)));}catch(RuntimeException unavailable){/* Older-style priming below remains bounded to the output buffer. */}
        ready=true;applyControls();if(!formatAnnounced){formatAnnounced=true;main.post(()->{if(!closed)listener.prepared(this);});}
    }
    private void discontinuity()throws IOException{
        final long request;final long target;synchronized(lock){request=epoch;target=lengthMs>0?Math.min(seekUs,lengthMs*1000):seekUs;pauseSink();if(track!=null)track.flush();writtenFrames=headFrames=lastRawHead=headWrap=sourceFrames=0;baseUs=target;positionMs=target/1000;completed=false;inputEnded=outputEnded=false;if(dsp!=null){dsp.reset(desired);meter.reset(desired.revision,rate,channels);}revisionStartFrame=0;}
        extractor.seekTo(target,MediaExtractor.SEEK_TO_PREVIOUS_SYNC);if(codec!=null&&handledEpoch>=0)codec.flush();handledEpoch=request;synchronized(lock){if(epoch==request)seeking=false;}lastProgress=SystemClock.elapsedRealtime();main.post(()->{if(!closed&&epoch==request)listener.seeked(this,request);});
    }
    private void applyControls()throws IOException{
        synchronized(lock){if(track==null||closed)return;try{final float requestedSpeed=speed,requestedPitch=pitch,requestedVolume=volume;if(appliedSpeed!=requestedSpeed||appliedPitch!=requestedPitch){boolean paused=!wanted||seeking;track.setPlaybackParams(new PlaybackParams().allowDefaults().setAudioFallbackMode(PlaybackParams.AUDIO_FALLBACK_MODE_FAIL).setSpeed(requestedSpeed).setPitch(requestedPitch));if(paused)track.pause();PlaybackParams applied=track.getPlaybackParams();if(Math.abs(applied.getSpeed()-requestedSpeed)>.001||Math.abs(applied.getPitch()-requestedPitch)>.001)throw new IOException("Аудиосистема не применила выбранную скорость/тон");appliedSpeed=requestedSpeed;appliedPitch=requestedPitch;}if(appliedVolume!=requestedVolume){if(track.setVolume(requestedVolume)!=AudioTrack.SUCCESS)throw new IOException("Аудиосистема не применила громкость");appliedVolume=requestedVolume;}if(wanted&&!seeking&&track.getPlayState()!=AudioTrack.PLAYSTATE_PLAYING)track.play();else if(!wanted||seeking)pauseSink();publishPlaying(wanted&&!seeking&&track.getPlayState()==AudioTrack.PLAYSTATE_PLAYING);}catch(IllegalArgumentException|IllegalStateException unsupported){throw new IOException("AudioTrack не поддерживает выбранную скорость/тон. Верни обычную скорость",unsupported);}}
    }
    private void render(ByteBuffer bytes,long timestampUs)throws IOException,InterruptedException{
        if(!ready)throw new IOException("Декодер не сообщил PCM формат");bytes.order(ByteOrder.nativeOrder());int bytesPerSample=encoding==AudioFormat.ENCODING_PCM_FLOAT?4:encoding==AudioFormat.ENCODING_PCM_16BIT?2:1,frameSize=bytesPerSample*channels;
        if(bytes.remaining()%frameSize!=0)throw new IOException("Декодер вернул неполный PCM кадр");int available=bytes.remaining()/frameSize;long skip=timestampUs<baseUs?(baseUs-timestampUs)*rate/1000000:0;if(skip>=available)return;if(skip>0)bytes.position(bytes.position()+(int)skip*frameSize);
        while(bytes.remaining()>=frameSize&&!closed){if(epoch!=handledEpoch)return;int frames=Math.min(1024,bytes.remaining()/frameSize);for(int i=0;i<frames*channels;i++){float sample=encoding==AudioFormat.ENCODING_PCM_FLOAT?bytes.getFloat():encoding==AudioFormat.ENCODING_PCM_16BIT?bytes.getShort()/32768f:((bytes.get()&255)-128)/128f;input[i]=Float.isFinite(sample)?sample:0;}renderBlock(frames);sourceFrames+=frames;}
    }
    private void renderBlock(int frames)throws IOException,InterruptedException{
        PcmDsp.Config config=desired;if(dsp.config().revision!=config.revision){dsp.configure(config);synchronized(lock){meter.reset(config.revision,rate,channels);revisionStartFrame=writtenFrames;}}
        dsp.process(input,output,frames);int samples=frames*channels;
        if(outputEncoding==AudioFormat.ENCODING_PCM_16BIT)for(int i=0;i<samples;i++){shorts[i]=(short)Math.max(Short.MIN_VALUE,Math.min(Short.MAX_VALUE,Math.round(output[i]*32767)));output[i]=shorts[i]/32768f;}
        int offset=0;while(offset<samples&&!closed&&epoch==handledEpoch){applyControls();int accepted;
            synchronized(lock){if(!wanted){pauseSink();releaseWake();lastProgress=SystemClock.elapsedRealtime();lock.wait(40);continue;}accepted=outputEncoding==AudioFormat.ENCODING_PCM_FLOAT?track.write(output,offset,samples-offset,AudioTrack.WRITE_NON_BLOCKING):track.write(shorts,offset,samples-offset,AudioTrack.WRITE_NON_BLOCKING);if(accepted<0)throw new IOException("AudioTrack прервал вывод PCM ("+accepted+"). Нажми «Повторить»");if(accepted>0){meter.accepted(input,output,offset,accepted);writtenFrames+=accepted/channels;offset+=accepted;lastProgress=SystemClock.elapsedRealtime();}}
            pollHead();if(accepted==0){if(SystemClock.elapsedRealtime()-lastProgress>20000)throw new IOException("Аудиовыход не отвечает. Нажми «Повторить»");synchronized(lock){lock.wait(4);}}holdWake();
        }
    }
    private void endOutput()throws IOException,InterruptedException{if(outputEnded)return;int threshold=startThresholdFrames;if(Build.VERSION.SDK_INT>=31)threshold=track.getStartThresholdInFrames();int remaining=sourceFrames>0?Math.max(dsp.tailFrames(),(int)Math.max(0,threshold-writtenFrames)):0;java.util.Arrays.fill(input,0);while(remaining>0&&!closed&&epoch==handledEpoch){int frames=Math.min(1024,remaining);renderBlock(frames);remaining-=frames;}outputEnded=true;lastProgress=SystemClock.elapsedRealtime();}
    private void drain()throws IOException,InterruptedException{
        pollHead();if(headFrames>=writtenFrames){final long request=handledEpoch;synchronized(lock){if(closed||epoch!=request||!wanted)return;pauseSink();wanted=false;completed=true;positionMs=lengthMs>0?lengthMs:(baseUs+headFrames*1000000/rate)/1000;}releaseWake();main.post(()->{if(!closed&&epoch==request)listener.completed(this,request);});}else if(SystemClock.elapsedRealtime()-lastProgress>30000)throw new IOException("Аудиовыход не завершил запись. Нажми «Повторить»");else synchronized(lock){lock.wait(10);}
    }
    private void pollHead(){synchronized(lock){if(track==null||!ready)return;long head=Integer.toUnsignedLong(track.getPlaybackHeadPosition());if(head<lastRawHead)headWrap+=1L<<32;lastRawHead=head;headFrames=Math.min(writtenFrames,headWrap+head);if(!seeking){long at=baseUs/1000+headFrames*1000/rate;positionMs=lengthMs>0?Math.min(lengthMs,at):at;}}}
    private void publishPlaying(boolean playing){if(notifiedPlaying==playing)return;notifiedPlaying=playing;main.post(()->{if(!closed)listener.stateChanged(this);});}
    private void pauseSink(){if(track!=null)try{track.pause();}catch(IllegalStateException ignored){}publishPlaying(false);}
    private void holdWake(){long now=SystemClock.elapsedRealtime();if(!wake.isHeld()||now-lastWake>30000){wake.acquire(60000);lastWake=now;}}
    private void releaseWake(){if(wake.isHeld())try{wake.release();}catch(RuntimeException ignored){}}
    private void fail(String message){final String readable=message==null?"Не удалось применить обработку PCM. Нажми «Повторить»":message;main.post(()->{if(!closed)listener.failed(this,readable);});}
}
