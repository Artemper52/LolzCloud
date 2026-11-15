package com.lolzcloud.mobile.test;

import android.app.*;
import android.content.*;
import android.media.*;
import android.media.projection.*;
import android.os.*;
import java.util.concurrent.atomic.AtomicReference;

/** Captures only the production UID's MEDIA output. No microphone source or raw captured file. */
public final class AudioCaptureFixtureService extends Service {
    private static final int RATE=48000,FRAMES=32768;
    private final AtomicReference<Sample> request=new AtomicReference<>();
    private AudioRecord recorder;private MediaProjection projection;private Thread worker;private volatile boolean running;
    private ResultReceiver receiver;private int targetUid;private boolean closing;
    private static final class Sample {final int id;final ResultReceiver receiver;final short[] data=new short[FRAMES];int size;Sample(int id,ResultReceiver receiver){this.id=id;this.receiver=receiver;}}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent==null)return START_NOT_STICKY;String op=intent.getStringExtra("op");ResultReceiver reply=intent.getParcelableExtra("receiver");
        try{
            if("start".equals(op)){receiver=reply;if(running)throw new IllegalStateException("Capture session already running");start(intent);}
            else if("refresh".equals(op)){if(!running||request.get()!=null)throw new IllegalStateException("Capture route is not ready to refresh");stopRecorder();beginRecord();Bundle value=new Bundle();reply.send(103,value);}
            else if("sample".equals(op)){if(!running)throw new IllegalStateException("No active capture session");Sample sample=new Sample(intent.getIntExtra("request",0),reply);if(!request.compareAndSet(null,sample))throw new IllegalStateException("Capture sample already pending");}
            else if("stop".equals(op)){close();Bundle done=new Bundle();if(reply!=null)reply.send(102,done);stopSelf();}
        }catch(Throwable failure){error(reply,failure);close();stopSelf();}return START_NOT_STICKY;
    }
    private void start(Intent intent)throws Exception{
        NotificationManager notifications=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);notifications.createNotificationChannel(new NotificationChannel("capture-fixture","Generated audio verification",NotificationManager.IMPORTANCE_LOW));
        Notification note=new Notification.Builder(this,"capture-fixture").setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("Generated audio verification").setContentText("Capturing only LolzCloud test playback").setOngoing(true).build();
        startForeground(662,note,android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        projection=((MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE)).getMediaProjection(intent.getIntExtra("resultCode",Activity.RESULT_CANCELED),intent.getParcelableExtra("resultData"));
        if(projection==null)throw new IllegalStateException("No consented MediaProjection");
        projection.registerCallback(new MediaProjection.Callback(){@Override public void onStop(){if(!closing){error(receiver,new IllegalStateException("System revoked playback capture"));close();stopSelf();}}},new Handler(Looper.getMainLooper()));
        targetUid=getPackageManager().getApplicationInfo("com.lolzcloud.mobile",0).uid;
        beginRecord();Bundle value=new Bundle();value.putInt("captureUid",getApplicationInfo().uid);value.putInt("targetUid",targetUid);value.putInt("sampleRate",RATE);receiver.send(100,value);
    }
    private void beginRecord(){
        AudioPlaybackCaptureConfiguration capture=new AudioPlaybackCaptureConfiguration.Builder(projection).addMatchingUid(targetUid).addMatchingUsage(AudioAttributes.USAGE_MEDIA).build();
        AudioFormat format=new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build();
        int buffer=Math.max(16384,AudioRecord.getMinBufferSize(RATE,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT)*2);
        recorder=new AudioRecord.Builder().setAudioFormat(format).setBufferSizeInBytes(buffer).setAudioPlaybackCaptureConfig(capture).build();
        if(recorder.getState()!=AudioRecord.STATE_INITIALIZED)throw new IllegalStateException("Playback AudioRecord did not initialize");recorder.startRecording();
        if(recorder.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)throw new IllegalStateException("Playback capture is not recording");running=true;
        final AudioRecord current=recorder;worker=new Thread(()->{short[] block=new short[2048];try{while(running){int read=current.read(block,0,block.length,AudioRecord.READ_BLOCKING);if(read<0)throw new IllegalStateException("Playback capture read="+read);Sample sample=request.get();if(sample!=null&&read>0){int count=Math.min(read,FRAMES-sample.size);System.arraycopy(block,0,sample.data,sample.size,count);sample.size+=count;if(sample.size==FRAMES&&request.compareAndSet(sample,null))sample.receiver.send(101,measure(sample));}}}catch(Throwable failure){if(running)error(receiver,failure);}},"LolzCloud-capture-fixture");worker.start();
    }
    private Bundle measure(Sample sample){
        double[] real=new double[FRAMES],imaginary=new double[FRAMES];double energy=0,mean=0;for(short value:sample.data){double v=value/32768d;energy+=v*v;mean+=v;}mean/=FRAMES;
        for(int i=0;i<FRAMES;i++)real[i]=(sample.data[i]/32768d-mean)*(.5-.5*Math.cos(2*Math.PI*i/(FRAMES-1)));
        for(int i=1,j=0;i<FRAMES;i++){int bit=FRAMES>>1;for(; (j&bit)!=0;bit>>=1)j^=bit;j^=bit;if(i<j){double x=real[i];real[i]=real[j];real[j]=x;}}
        for(int len=2;len<=FRAMES;len<<=1){double step=-2*Math.PI/len;for(int offset=0;offset<FRAMES;offset+=len){double wr=1,wi=0,ar=Math.cos(step),ai=Math.sin(step);for(int j=0;j<len/2;j++){int a=offset+j,b=a+len/2;double tr=real[b]*wr-imaginary[b]*wi,ti=real[b]*wi+imaginary[b]*wr;real[b]=real[a]-tr;imaginary[b]=imaginary[a]-ti;real[a]+=tr;imaginary[a]+=ti;double nr=wr*ar-wi*ai;wi=wr*ai+wi*ar;wr=nr;}}}
        int peak=1;double power=0;for(int i=14;i<FRAMES*8000/RATE;i++){double value=real[i]*real[i]+imaginary[i]*imaginary[i];if(value>power){power=value;peak=i;}}
        double left=Math.log(Math.max(1e-30,real[peak-1]*real[peak-1]+imaginary[peak-1]*imaginary[peak-1])),center=Math.log(Math.max(1e-30,power)),right=Math.log(Math.max(1e-30,real[peak+1]*real[peak+1]+imaginary[peak+1]*imaginary[peak+1]));
        double denominator=left-2*center+right,correction=Math.abs(denominator)<1e-20?0:.5*(left-right)/denominator;correction=Math.max(-.5,Math.min(.5,correction));
        Bundle value=new Bundle();value.putInt("request",sample.id);value.putInt("frames",FRAMES);value.putInt("sampleRate",RATE);value.putDouble("rms",Math.sqrt(energy/FRAMES));value.putDouble("peakHz",(peak+correction)*RATE/FRAMES);value.putInt("captureUid",getApplicationInfo().uid);value.putInt("targetUid",targetUid);return value;
    }
    private static void error(ResultReceiver receiver,Throwable failure){if(receiver==null)return;Bundle value=new Bundle();value.putString("error",failure.toString());receiver.send(199,value);}
    private void stopRecorder(){running=false;request.set(null);if(recorder!=null)try{recorder.stop();}catch(RuntimeException ignored){}if(worker!=null&&Thread.currentThread()!=worker)try{worker.join(1500);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}if(worker!=null&&worker.isAlive()&&Thread.currentThread()!=worker)throw new IllegalStateException("Capture read worker did not stop");if(recorder!=null){recorder.release();recorder=null;}worker=null;}
    private synchronized void close(){if(closing)return;closing=true;try{stopRecorder();}finally{if(projection!=null){projection.stop();projection=null;}stopForeground(STOP_FOREGROUND_REMOVE);}}
    @Override public void onDestroy(){close();super.onDestroy();}
}
