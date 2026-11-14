package com.lolzcloud.mobile;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.res.ColorStateList;
import android.graphics.*;
import android.graphics.drawable.*;
import android.net.Uri;
import android.os.*;
import android.text.*;
import android.view.*;
import android.view.inputmethod.InputMethodManager;
import android.view.inputmethod.EditorInfo;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.lang.ref.WeakReference;
import java.util.*;
import java.util.concurrent.*;

/** Native phone UI. No account credentials or desktop browser data enter this activity. */
public final class MainActivity extends Activity {
    public static final String EXTRA_SOUNDCLOUD_QUERY = "native_soundcloud_url";
    private LibraryStore store;
    private PlaybackService player;
    private UpdateManager updater;
    private SocialNotifications social;
    private TextView socialStatusText, socialNotificationText;
    private TextView unreadBadge;
    private View profileHeaderAction;
    private final SocialNotifications.Listener socialListener = state -> updateSocialStatus();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService catalogIo = Executors.newSingleThreadExecutor();
    private final ExecutorService lyricsIo = Executors.newSingleThreadExecutor();
    private final ExecutorService artworkIo = Executors.newFixedThreadPool(2);
    private final OnlineCatalog catalog = new OnlineCatalog();
    private Future<?> catalogTask;
    private final ArrayList<Track> catalogTracks = new ArrayList<>();
    private String catalogQuery = "", catalogNextOffset = "", catalogError = "", catalogPendingOffset = "0";
    private boolean catalogLoading;
    private int catalogGeneration;
    private final android.util.LruCache<String, Bitmap> artwork = new android.util.LruCache<String, Bitmap>(18);
    private final Set<String> artworkLoading = new HashSet<>();
    private final Set<String> downloading = new HashSet<>();
    private final Map<String, List<WeakReference<Cover>>> artworkWaiters = new HashMap<>();
    private final Deque<String> backStack = new ArrayDeque<>();
    private String page = "wave", filter = "all", query = "", shownTrack = "", lastError = "";
    private String searchSource = "soundcloud", activeLinkKind = "";
    private EditText searchInput, linkInput;
    private TextView searchSubmit, searchNote, searchError, linkError;
    private LinearLayout searchSources;
    private AlertDialog linkDialog;
    private String updateStatus = "Проверить Android-релиз";
    private boolean updateAvailable, bound, seeking, alive;
    private int bg, panel, accent, ink, muted, dark;
    private LinearLayout root, content, searchResults, mini;
    private TextView miniTitle, miniArtist, elapsed, remaining, statusText;
    private Glyph miniPlay, bigPlay, shuffleIcon, repeatIcon;
    private SeekBar progress;
    private List<LrcParser.Line> lyricLines = Collections.emptyList();
    private final ArrayList<TextView> lyricViews = new ArrayList<>();
    private int activeLyric = -2;
    private LyricsRepository lyricsRepository;
    private Future<?> lyricsTask;
    private LyricsProvider.Result automaticLyrics;
    private String lyricsRequestKey="",lyricsTrackId="",lyricsError="";
    private boolean lyricsLoading;
    private int lyricsGeneration;
    private long lyricsDuration;
    private TextView audioStatusText;
    private View audioRetryButton;
    private AlertDialog lyricsDialog;
    private Drawable forestArtwork;
    private static final int IMPORT_AUDIO=41, IMPORT_LYRICS=42, EXPORT_PROFILE=43, IMPORT_PROFILE=44;
    private String pendingLyricsId;
    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            player = ((PlaybackService.LocalBinder)binder).getService(); bound = true;
            player.setListener(() -> { if (alive) updatePlayback(); }); render();
        }
        @Override public void onServiceDisconnected(ComponentName name) { player=null; bound=false; if(alive)render(); }
    };

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved); alive=true; store=new LibraryStore(this); social=SocialNotifications.get(this);
        String installedVersion="development";try{installedVersion=getPackageManager().getPackageInfo(getPackageName(),0).versionName;}catch(Exception ignored){}
        lyricsRepository=new LyricsRepository(this,new LyricsProvider(installedVersion));
        searchSource=store.preferences().getString("search_source","soundcloud");
        forestArtwork=getResources().getDrawable(R.drawable.forest_art,getTheme());
        if(saved!=null) { page=saved.getString("page","wave"); filter=saved.getString("filter","all"); query=saved.getString("query",""); pendingLyricsId=saved.getString("pending_lyrics"); }
        if(saved!=null)restoreCatalog(saved);
        if(!Arrays.asList("soundcloud","youtube","local").contains(searchSource))searchSource="soundcloud";
        updater=new UpdateManager(this,new UpdateManager.Listener(){
            @Override public void onStatus(String message){updateStatus=message;if(statusText!=null)statusText.setText(message);}
            @Override public void onAvailable(String version,String releaseUrl){updateAvailable=true;updateStatus="Доступна версия "+version;if(page.equals("profile"))render();}
        });
        Intent service=new Intent(this,PlaybackService.class); startService(service); bindService(service,connection,Context.BIND_AUTO_CREATE);
        render(); handler.post(tick);
        boolean soundCloudEntry=consumeSoundCloudIntent(getIntent());
        if(!soundCloudEntry&&saved!=null&&(saved.getBoolean("catalog_loading")||saved.getBoolean("catalog_reload"))&&!catalogQuery.isEmpty())handler.post(()->{if(alive)searchCatalog(catalogQuery,saved.getBoolean("catalog_reload")?"0":catalogPendingOffset,!saved.getBoolean("catalog_reload")&&!catalogPendingOffset.equals("0"));});
        if(!soundCloudEntry&&saved!=null&&!saved.getString("link_kind","").isEmpty())handler.post(()->showLinkDialog(saved.getString("link_kind"),saved.getString("link_text","")));
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);consumeSoundCloudIntent(intent);}
    private boolean consumeSoundCloudIntent(Intent intent){
        if(intent==null||!intent.hasExtra(EXTRA_SOUNDCLOUD_QUERY))return false;
        String source=intent.getStringExtra(EXTRA_SOUNDCLOUD_QUERY);intent.removeExtra(EXTRA_SOUNDCLOUD_QUERY);setIntent(intent);
        if(!OnlineCatalog.isSoundCloudAddress(source))return false;openSoundCloud(source);return true;
    }
    @Override protected void onResume(){super.onResume();if(updater!=null)updater.resumePendingInstall();if(social!=null){social.addListener(socialListener);social.refresh();}}
    @Override protected void onPause(){if(social!=null)social.removeListener(socialListener);super.onPause();}
    @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);state.putString("page",page);state.putString("filter",filter);state.putString("query",query);state.putString("pending_lyrics",pendingLyricsId);state.putString("link_kind",activeLinkKind);state.putString("link_text",linkInput==null?"":linkInput.getText().toString());saveCatalog(state);}
    @Override protected void onDestroy(){alive=false;cancelCatalog();cancelLyrics();handler.removeCallbacksAndMessages(null);if(linkDialog!=null)linkDialog.dismiss();if(lyricsDialog!=null)lyricsDialog.dismiss();if(player!=null)player.setListener(null);if(bound)unbindService(connection);io.shutdownNow();catalogIo.shutdownNow();lyricsIo.shutdownNow();artworkIo.shutdownNow();artworkWaiters.clear();if(updater!=null)updater.dispose();super.onDestroy();}
    private final Runnable tick=new Runnable(){@Override public void run(){if(alive){updatePlayback();handler.postDelayed(this,750);}}};
    private int dp(float value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private void theme(){
        String selected=store.preferences().getString("theme","forest");
        if(selected.equals("paper")){bg=Color.rgb(244,241,233);panel=Color.rgb(231,228,219);accent=Color.rgb(91,108,51);ink=Color.rgb(30,37,30);muted=Color.rgb(104,111,100);dark=Color.WHITE;}
        else if(selected.equals("ink")){bg=Color.rgb(17,20,23);panel=Color.rgb(31,37,41);accent=Color.rgb(143,201,203);ink=Color.rgb(240,243,244);muted=Color.rgb(147,159,166);dark=Color.rgb(16,25,27);}
        else{bg=Color.rgb(16,22,19);panel=Color.rgb(28,39,32);accent=Color.rgb(165,229,189);ink=Color.rgb(241,245,242);muted=Color.rgb(151,169,158);dark=Color.rgb(18,38,26);}
        getWindow().setStatusBarColor(bg);getWindow().setNavigationBarColor(bg);
        getWindow().getDecorView().setSystemUiVisibility(selected.equals("paper")?View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR:0);
    }
    private boolean tabPage(){return Arrays.asList("wave","search","library","rooms").contains(page);}
    private void navigate(String destination){if(!page.equals(destination)){backStack.push(page);page=destination;}hideKeyboard();render();}
    private void selectTab(String destination){backStack.clear();page=destination;hideKeyboard();render();}
    @Override public void onBackPressed(){if(!backStack.isEmpty()){page=backStack.pop();render();}else if(!page.equals("wave")){selectTab("wave");}else super.onBackPressed();}

    private void render(){
        boolean restoreSearchFocus=page.equals("search")&&searchInput!=null&&searchInput.hasFocus();
        int selectionStart=restoreSearchFocus?searchInput.getSelectionStart():0,selectionEnd=restoreSearchFocus?searchInput.getSelectionEnd():0;
        boolean restoreIme=restoreSearchFocus&&Build.VERSION.SDK_INT>=30&&searchInput.getRootWindowInsets()!=null&&searchInput.getRootWindowInsets().isVisible(WindowInsets.Type.ime());
        if(!alive)return;if(!page.equals("lyrics")&&lyricsLoading)cancelLyrics(); theme();progress=null;miniTitle=null;statusText=null;socialStatusText=null;socialNotificationText=null;unreadBadge=null;profileHeaderAction=null;bigPlay=null;shuffleIcon=null;repeatIcon=null;searchInput=null;searchResults=null;searchSources=null;searchSubmit=null;searchNote=null;searchError=null;audioStatusText=null;audioRetryButton=null;lyricViews.clear();activeLyric=-2;
        root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(bg);setContentView(root);
        root.setOnApplyWindowInsetsListener((v,insets)->{root.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});
        root.requestApplyInsets();
        header();
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(false);scroll.setClipToPadding(false);scroll.setVerticalScrollBarEnabled(false);
        content=column();content.setPadding(dp(24),dp(8),dp(24),dp(26));scroll.addView(content,new ScrollView.LayoutParams(-1,-2));root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        switch(page){case "search":search();break;case "library":library();break;case "rooms":rooms();break;case "player":nowPlaying();break;case "queue":queue();break;case "lyrics":lyrics();break;case "sound":sound();break;case "profile":profile();break;case "bookmarks":bookmarks();break;default:wave();}
        if(!page.equals("player")&&current()!=null)miniPlayer();if(tabPage())bottomNav();updatePlayback();updateSocialStatus();
        if(restoreSearchFocus&&searchInput!=null){searchInput.requestFocus();searchInput.setSelection(Math.max(0,Math.min(selectionStart,query.length())),Math.max(0,Math.min(selectionEnd,query.length())));if(restoreIme)searchInput.post(()->{if(alive&&searchInput!=null)((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(searchInput,InputMethodManager.SHOW_IMPLICIT);});}
    }
    private void header(){
        LinearLayout h=row();h.setPadding(dp(16),0,dp(16),0);h.setGravity(Gravity.CENTER_VERTICAL);root.addView(h,new LinearLayout.LayoutParams(-1,dp(64)));
        if(tabPage()){
            Glyph logo=new Glyph("cloud",accent);h.addView(logo,new LinearLayout.LayoutParams(dp(32),dp(32)));
            TextView name=text("LolzCloud",18,ink,true);LinearLayout.LayoutParams n=new LinearLayout.LayoutParams(0,-2,1);n.leftMargin=dp(10);h.addView(name,n);
            h.addView(profileHeader());
        }else{
            h.addView(iconButton("back","Назад",()->onBackPressed()));
            String label=page.equals("player")?"СЕЙЧАС ИГРАЕТ":page.equals("queue")?"ОЧЕРЕДЬ":page.equals("lyrics")?"ТЕКСТ ПЕСНИ":page.equals("sound")?"ЗВУК И ЭФФЕКТЫ":page.equals("bookmarks")?"ЛЮБИМЫЕ МОМЕНТЫ":"ПРОФИЛЬ";
            TextView title=text(label,11,muted,true);title.setLetterSpacing(.13f);title.setGravity(Gravity.CENTER);h.addView(title,new LinearLayout.LayoutParams(0,-2,1));
            if(page.equals("player"))h.addView(iconButton("more","Действия с треком",()->{if(current()!=null)trackMenu(current(),h);}));
            h.addView(profileHeader());
        }
    }
    private View profileHeader(){
        FrameLayout frame=new FrameLayout(this);frame.setLayoutParams(new LinearLayout.LayoutParams(dp(48),dp(48)));
        View icon=iconButton("profile","Профиль и настройки",()->navigate("profile"));frame.addView(icon,new FrameLayout.LayoutParams(dp(48),dp(48)));
        unreadBadge=text("",10,dark,true);unreadBadge.setSingleLine(true);unreadBadge.setGravity(Gravity.CENTER);unreadBadge.setMinWidth(dp(18));unreadBadge.setMinHeight(dp(18));unreadBadge.setPadding(dp(4),dp(1),dp(4),dp(1));unreadBadge.setBackground(round(accent,12));
        unreadBadge.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);FrameLayout.LayoutParams badge=new FrameLayout.LayoutParams(-2,-2,Gravity.TOP|Gravity.RIGHT);badge.topMargin=dp(2);badge.rightMargin=dp(1);frame.addView(unreadBadge,badge);
        profileHeaderAction=icon;return frame;
    }
    private void heading(String title,String subtitle){content.addView(text(title,30,ink,true));if(subtitle!=null&&!subtitle.isEmpty()){TextView s=text(subtitle,14,muted,false);s.setPadding(0,dp(7),0,dp(20));content.addView(s);}}
    private void wave(){
        heading("Моя волна","Из твоей библиотеки");
        Cover cover=new Cover(null);LinearLayout.LayoutParams art=new LinearLayout.LayoutParams(dp(232),dp(232));art.gravity=Gravity.CENTER_HORIZONTAL;art.topMargin=dp(4);art.bottomMargin=dp(18);content.addView(cover,art);
        TextView eyebrow=text(store.tracks().isEmpty()?"НАЧНИ С ЛЮБИМОЙ МУЗЫКИ":"ТВОЯ ЛИЧНАЯ РАДИОСТАНЦИЯ",10,muted,true);eyebrow.setLetterSpacing(.12f);eyebrow.setGravity(Gravity.CENTER);content.addView(eyebrow);
        gap(12);content.addView(button(store.tracks().isEmpty()?"Добавить музыку":"Включить волну",true,()->{if(store.tracks().isEmpty())importAudio();else startWave(false);}));
        if(store.tracks().isEmpty()){
            paragraph("Выбери аудиофайлы на телефоне. LolzCloud соберёт очередь, а любимые треки будут звучать чаще.");section("Онлайн-источники");sourceRows();
        }else{
            gap(18);LinearLayout chips=row();chips.addView(chip("Вся музыка",true,()->startWave(false)));chips.addView(chip("Любимые",false,()->startWave(true)));content.addView(horizontal(chips));
            section("Недавно добавлены");List<Track> list=store.tracks();Collections.reverse(list);for(int i=0;i<Math.min(4,list.size());i++)trackRow(content,list.get(i),list,i,false);
        }
    }
    private void startWave(boolean liked){
        List<Track> list=liked?store.liked():store.tracks();if(list.isEmpty()){toast("Сначала отметь любимые треки");return;}
        Collections.shuffle(list);List<Track> history=store.history();Set<String> recent=new HashSet<>();for(int i=0;i<Math.min(8,history.size());i++)recent.add(history.get(i).id);
        Collections.sort(list,(a,b)->{int aw=(recent.contains(a.id)?2:0)-(store.isLiked(a.id)?1:0),bw=(recent.contains(b.id)?2:0)-(store.isLiked(b.id)?1:0);return Integer.compare(aw,bw);});
        playList(list,0);navigate("player");
    }
    private void search(){
        heading("Поиск","Выбери, где искать музыку");
        searchSources=row();content.addView(horizontal(searchSources));gap(16);
        searchInput=edit("Трек, исполнитель или ссылка SoundCloud");searchInput.setFilters(new InputFilter[]{new InputFilter.LengthFilter(140)});searchInput.setMinHeight(dp(56));searchInput.setId(R.id.search_query);searchInput.setText(query);searchInput.setSelection(searchInput.length());searchInput.setContentDescription("Поиск музыки");
        searchInput.setInputType(InputType.TYPE_CLASS_TEXT);searchInput.setImeOptions(EditorInfo.IME_ACTION_SEARCH|EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        searchInput.setOnEditorActionListener((v,action,event)->{if(action==EditorInfo.IME_ACTION_SEARCH||(event!=null&&event.getKeyCode()==KeyEvent.KEYCODE_ENTER&&event.getAction()==KeyEvent.ACTION_UP)){submitSearch();return true;}return false;});
        content.addView(searchInput,new LinearLayout.LayoutParams(-1,-2));searchError=inlineError();content.addView(searchError);gap(12);
        searchSubmit=button("",true,()->submitSearch());searchSubmit.setId(R.id.search_submit);content.addView(searchSubmit);
        searchNote=text("",12,muted,false);searchNote.setLineSpacing(dp(3),1);searchNote.setPadding(0,dp(10),0,dp(12));content.addView(searchNote);
        searchResults=column();content.addView(searchResults);renderSearchScope();renderSearch();
        searchInput.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void onTextChanged(CharSequence s,int st,int before,int count){query=s.toString();if(catalogLoading&&!query.trim().equals(catalogQuery))cancelCatalog();if(searchError!=null)searchError.setVisibility(View.GONE);renderSearch();}public void afterTextChanged(Editable e){}});
    }
    private void renderSearchScope(){
        if(searchSources==null)return;searchSources.removeAllViews();
        String[][] sources={{"soundcloud","SoundCloud"},{"youtube","YouTube Music"},{"local","Моя музыка"}};
        int[] ids={R.id.search_soundcloud,R.id.search_youtube,R.id.search_local};
        for(int i=0;i<sources.length;i++){final String key=sources[i][0];TextView scope=chip(sources[i][1],searchSource.equals(key),()->{if(!key.equals("soundcloud")&&catalogLoading)cancelCatalog();searchSource=key;store.preferences().edit().putString("search_source",key).apply();if(searchError!=null)searchError.setVisibility(View.GONE);renderSearchScope();renderSearch();});scope.setId(ids[i]);searchSources.addView(scope);}
        String label=searchSource.equals("local")?"Найти в моей музыке":searchSource.equals("youtube")?"Найти в YouTube Music":"Найти в SoundCloud";
        searchSubmit.setText(label);searchSubmit.setContentDescription(label);
        searchNote.setText(searchSource.equals("local")?"Поиск по твоей библиотеке":searchSource.equals("youtube")?"Результаты откроются в веб-плеере YouTube Music":"Поиск и музыка внутри LolzCloud. Вход в SoundCloud не нужен.");
    }
    private void submitSearch(){
        String value=query.trim();if(value.isEmpty()){if(searchInput!=null){showInlineError(searchError,"Введи трек или исполнителя");searchInput.requestFocus();}return;}
        if(searchSource.equals("local")){renderSearch();hideKeyboard();return;}
        if(searchSource.equals("soundcloud")){if(catalogLoading&&value.equals(catalogQuery))return;hideKeyboard();searchCatalog(value,"0",false);return;}
        openOnline("https://music.youtube.com/search?q="+Uri.encode(value),"YouTube Music");
    }
    private void renderSearch(){
        if(searchResults==null)return;searchResults.removeAllViews();
        if(searchSubmit!=null){searchSubmit.setEnabled(!searchSource.equals("soundcloud")||!catalogLoading);searchSubmit.setAlpha(searchSubmit.isEnabled()?1f:.6f);searchSubmit.setText(searchSource.equals("local")?"Найти в моей музыке":searchSource.equals("youtube")?"Найти в YouTube Music":catalogLoading?"Ищем в SoundCloud…":"Найти в SoundCloud");}
        if(searchSource.equals("youtube"))return;
        if(searchSource.equals("soundcloud")){
            if(catalogQuery.isEmpty()||!catalogQuery.equals(query.trim())){TextView hint=text("Найди трек или вставь ссылку SoundCloud. Нажми «Найти», чтобы увидеть результаты.",14,muted,false);hint.setPadding(0,dp(18),0,dp(18));hint.setLineSpacing(dp(3),1);searchResults.addView(hint);return;}
            List<Track> results=store.resolveCatalog(catalogTracks);
            if(!results.isEmpty()){TextView label=text("SOUNDCLOUD · "+results.size()+" "+plural(results.size(),"трек","трека","треков"),10,muted,true);label.setPadding(0,dp(12),0,dp(10));searchResults.addView(label);for(int i=0;i<results.size();i++)trackRow(searchResults,results.get(i),results,i,false);}
            if(catalogLoading){LinearLayout loading=row();loading.setGravity(Gravity.CENTER_VERTICAL);loading.setPadding(0,dp(20),0,dp(20));ProgressBar spinner=new ProgressBar(this);spinner.setId(R.id.search_loading);spinner.setIndeterminateTintList(ColorStateList.valueOf(accent));loading.addView(spinner,new LinearLayout.LayoutParams(dp(26),dp(26)));TextView note=text(results.isEmpty()?"Ищем музыку…":"Загружаем следующую страницу…",14,muted,false);note.setPadding(dp(12),0,0,0);loading.addView(note);searchResults.addView(loading);}
            else if(!catalogError.isEmpty()){TextView error=inlineError();error.setId(R.id.search_catalog_error);error.setText(catalogError);error.setVisibility(View.VISIBLE);searchResults.addView(error);TextView retry=button("Повторить поиск",false,()->searchCatalog(catalogQuery,catalogPendingOffset,!catalogPendingOffset.equals("0")));retry.setId(R.id.search_retry);searchResults.addView(retry);}
            else{
                if(results.isEmpty()){TextView empty=text(catalogNextOffset.isEmpty()?"Ничего не найдено. Попробуй другое название или ссылку на трек.":"На этой странице нет доступных записей. Попробуй следующие результаты.",15,muted,false);empty.setPadding(0,dp(20),0,dp(20));searchResults.addView(empty);}
                if(!catalogNextOffset.isEmpty()&&results.size()<320){TextView more=button("Показать ещё",false,()->searchCatalog(catalogQuery,catalogNextOffset,true));more.setId(R.id.search_more);searchResults.addView(more);}
            }
            return;
        }
        TextView title=text("В МОЕЙ МУЗЫКЕ",10,muted,true);title.setPadding(0,dp(12),0,dp(10));searchResults.addView(title);
        List<Track> result=new ArrayList<>();String q=query.trim().toLowerCase(Locale.ROOT);for(Track t:store.tracks())if((t.title+" "+t.artist).toLowerCase(Locale.ROOT).contains(q))result.add(t);
        if(result.isEmpty()){TextView empty=text(q.isEmpty()?"Импортируй музыку в «Мою музыку»":"Совпадений в библиотеке нет",15,muted,false);empty.setPadding(0,dp(20),0,dp(20));searchResults.addView(empty);}else for(int i=0;i<result.size();i++)trackRow(searchResults,result.get(i),result,i,false);
    }
    private void cancelCatalog(){catalogGeneration++;if(catalogLoading&&catalogTracks.isEmpty())catalogQuery="";catalogLoading=false;if(catalogTask!=null)catalogTask.cancel(true);catalog.cancel();}
    private void searchCatalog(String value,String offset,boolean append){
        if(!alive)return;cancelCatalog();final String requested=value.trim(),cursor=offset==null||offset.isEmpty()?"0":offset;
        if(!append){catalogTracks.clear();catalogNextOffset="";}catalogQuery=requested;catalogPendingOffset=cursor;catalogError="";catalogLoading=true;final int generation=++catalogGeneration;renderSearch();
        catalogTask=catalogIo.submit(()->{try{OnlineCatalog.Page result=catalog.search(requested,cursor);handler.post(()->{
            if(!alive||generation!=catalogGeneration||!requested.equals(query.trim())||!searchSource.equals("soundcloud"))return;
            Set<String> known=new HashSet<>();for(Track track:catalogTracks)known.add(track.id);for(Track track:result.tracks)if(catalogTracks.size()<320&&known.add(track.id))catalogTracks.add(track);
            catalogNextOffset=result.nextOffset;catalogLoading=false;catalogError="";renderSearch();
        });}catch(Exception error){final String explanation=error.getMessage()==null?"Не удалось выполнить поиск. Проверь интернет и повтори.":error.getMessage();handler.post(()->{if(alive&&generation==catalogGeneration&&requested.equals(query.trim())&&searchSource.equals("soundcloud")){catalogLoading=false;catalogError=explanation;renderSearch();}});}});
    }
    private void openSoundCloud(String address){
        if(linkDialog!=null)linkDialog.dismiss();
        String value=address==null?"":address.trim();Uri uri=Uri.parse(value);String path=uri.getPath();
        if(OnlineCatalog.isSoundCloudAddress(value)&&(path==null||path.isEmpty()||path.equals("/")))value="";
        else if(OnlineCatalog.isSoundCloudAddress(value)&&path!=null&&path.startsWith("/search"))value=uri.getQueryParameter("q")==null?"":uri.getQueryParameter("q");
        value=OnlineCatalog.normalizeQuery(value);cancelCatalog();searchSource="soundcloud";query=value;store.preferences().edit().putString("search_source",searchSource).apply();selectTab("search");
        if(!value.isEmpty())searchCatalog(value,"0",false);else if(searchInput!=null){searchInput.requestFocus();searchInput.post(()->{if(alive&&searchInput!=null)((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(searchInput,InputMethodManager.SHOW_IMPLICIT);});}
    }
    private void saveCatalog(Bundle state){
        state.putString("catalog_query",catalogQuery);state.putString("catalog_next",catalogNextOffset);state.putString("catalog_pending",catalogPendingOffset);state.putBoolean("catalog_loading",catalogLoading);state.putString("catalog_error",catalogError);
        JSONArray rows=new JSONArray();for(Track track:catalogTracks)rows.put(track.toJson());String json=rows.toString();if(json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=256*1024)state.putString("catalog_results",json);else state.putBoolean("catalog_reload",true);
    }
    private void restoreCatalog(Bundle state){
        catalogQuery=state.getString("catalog_query","");catalogNextOffset=state.getString("catalog_next","");catalogPendingOffset=state.getString("catalog_pending","0");catalogError=state.getString("catalog_error","");
        if(!catalogNextOffset.isEmpty()&&!OnlineCatalog.isOffset(catalogNextOffset))catalogNextOffset="";if(!OnlineCatalog.isOffset(catalogPendingOffset))catalogPendingOffset="0";
        try{JSONArray rows=new JSONArray(state.getString("catalog_results","[]"));for(int i=0;i<Math.min(320,rows.length());i++){Track track=Track.fromJson(rows.getJSONObject(i));if(track.id.equals("soundcloud:"+OnlineCatalog.audioId(track.uri))&&!track.sourceUrl.isEmpty())catalogTracks.add(track);}}catch(JSONException ignored){}
    }
    private void library(){
        heading("Моя музыка",store.tracks().size()+" "+plural(store.tracks().size(),"трек","трека","треков")+" в библиотеке");
        LinearLayout filters=row();filters.addView(chip("Все",filter.equals("all"),()->{filter="all";render();}));filters.addView(chip("Любимые",filter.equals("liked"),()->{filter="liked";render();}));filters.addView(chip("История",filter.equals("history"),()->{filter="history";render();}));content.addView(horizontal(filters));
        gap(16);LinearLayout actions=row();actions.setGravity(Gravity.CENTER_VERTICAL);TextView add=button("Добавить файлы",true,()->importAudio());actions.addView(add,new LinearLayout.LayoutParams(0,-2,1));View url=iconButton("link","Добавить прямую HTTPS ссылку",()->addStream());LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(dp(48),dp(48));lp.leftMargin=dp(10);actions.addView(url,lp);content.addView(actions);gap(18);
        List<Track> list=filter.equals("liked")?store.liked():filter.equals("history")?store.history():store.tracks();
        if(list.isEmpty()){empty("music",filter.equals("liked")?"Здесь будут любимые треки":filter.equals("history")?"Ещё ничего не слушали":"Музыка всегда с тобой",filter.equals("all")?"MP3, FLAC, M4A, OGG, WAV и другие форматы, которые поддерживает твой телефон.":"Слушай музыку и отмечай то, что нравится.");}
        else for(int i=0;i<list.size();i++)trackRow(content,list.get(i),list,i,false);
    }
    private void sourceRows(){
        actionRow("cloud","SoundCloud","Поиск и музыка внутри приложения",()->openSoundCloud(""));
        actionRow("video","YouTube Music","Музыка в веб-плеере сервиса",()->openOnline("https://music.youtube.com","YouTube Music"));
    }
    private void rooms(){
        heading("Слушать вместе","Одна музыка. Твоя компания.");
        content.addView(button("Открыть комнаты",true,()->openOnline("https://lolzcloud.com/rooms","Комнаты LolzCloud")));
        paragraph("Создай комнату или присоединись к друзьям. Вход через Lolzteam, чат и общая очередь.");
        section("Подключение");actionRow("link","По приглашению","Открыть ссылку на комнату",()->invite());actionRow("remote","Пульт компьютера","Открыть ссылку пульта с ПК",()->remote());
        paragraph("Для комнат нужен интернет. Локальные файлы с телефона в общую очередь не передаются.");
        section("Твоя компания");actionRow("people","Друзья LolzCloud","Профили, друзья и приглашения",()->openSocial("friends"));
    }
    private Track current(){return player==null?null:player.current();}
    private void nowPlaying(){
        Track t=current();if(t==null){heading("Сейчас играет",null);empty("music","Выбери первый трек","Добавь музыку с телефона и нажми на неё в библиотеке.");content.addView(button("В мою музыку",true,()->selectTab("library")));return;}
        Cover art=new Cover(t);int size=Math.min(328,(int)(getResources().getDisplayMetrics().widthPixels/getResources().getDisplayMetrics().density)-48);LinearLayout.LayoutParams a=new LinearLayout.LayoutParams(dp(size),dp(size));a.gravity=Gravity.CENTER_HORIZONTAL;a.bottomMargin=dp(24);content.addView(art,a);
        LinearLayout details=row();LinearLayout labels=column();labels.addView(text(t.title,24,ink,true));TextView artist=text(t.artist,15,muted,false);artist.setPadding(0,dp(6),0,0);labels.addView(artist);details.addView(labels,new LinearLayout.LayoutParams(0,-2,1));boolean liked=store.isLiked(t.id);Glyph like=iconButton(liked?"heartFilled":"heart",liked?"В любимых. Убрать из любимых":"Добавить в любимые",()->{rememberTrack(t);store.toggleLike(t.id);render();});like.setSelected(liked);like.color=liked?accent:muted;details.addView(like);content.addView(details);gap(16);
        progress=new SeekBar(this);progress.setMax(10000);progress.setProgressTintList(ColorStateList.valueOf(accent));progress.setThumbTintList(ColorStateList.valueOf(accent));progress.setPadding(dp(2),0,dp(2),0);progress.setContentDescription("Позиция воспроизведения");progress.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onProgressChanged(SeekBar s,int value,boolean user){}public void onStartTrackingTouch(SeekBar s){seeking=true;}public void onStopTrackingTouch(SeekBar s){if(player!=null)player.seekTo(player.duration()*s.getProgress()/10000);seeking=false;}});content.addView(progress,new LinearLayout.LayoutParams(-1,dp(48)));
        LinearLayout times=row();elapsed=text("0:00",11,muted,false);remaining=text("0:00",11,muted,false);remaining.setGravity(Gravity.RIGHT);times.addView(elapsed,new LinearLayout.LayoutParams(0,-2,1));times.addView(remaining,new LinearLayout.LayoutParams(0,-2,1));content.addView(times);gap(14);
        LinearLayout controls=row();controls.setGravity(Gravity.CENTER);shuffleIcon=iconButton("shuffle","Перемешать",()->{player.setShuffle(!player.shuffle());updatePlayback();});controls.addView(shuffleIcon);controls.addView(iconButton("previous","Предыдущий трек",()->player.previous()));bigPlay=new Glyph("play",dark);bigPlay.setContentDescription("Воспроизведение / пауза");bigPlay.setBackground(round(accent,40));bigPlay.setPadding(dp(19),dp(19),dp(19),dp(19));bigPlay.setOnClickListener(v->player.toggle());LinearLayout.LayoutParams play=new LinearLayout.LayoutParams(dp(76),dp(76));play.setMargins(dp(12),0,dp(12),0);controls.addView(bigPlay,play);controls.addView(iconButton("next","Следующий трек",()->player.next()));repeatIcon=iconButton("repeat","Режим повтора",()->{player.setRepeat((player.repeat()+1)%3);toast(player.repeat()==0?"Повтор выключен":player.repeat()==1?"Повтор всей очереди":"Повтор одного трека");updatePlayback();});controls.addView(repeatIcon);content.addView(controls);gap(24);
        audioStatusText=text("",13,muted,false);audioStatusText.setTag("audio_status");audioStatusText.setLineSpacing(dp(3),1);audioStatusText.setPadding(0,0,0,dp(10));content.addView(audioStatusText);
        audioRetryButton=button("Повторить",false,()->{if(player!=null)player.play();});audioRetryButton.setTag("audio_retry");content.addView(audioRetryButton);
        LinearLayout tools=row();smallAction(tools,"lyrics","Текст",()->navigate("lyrics"));smallAction(tools,"queue","Очередь",()->navigate("queue"));smallAction(tools,"sliders","Звук",()->navigate("sound"));content.addView(tools);
        TextView source=text(t.uri.startsWith("https:")?(t.id.startsWith("soundcloud:")?"SoundCloud · играет в LolzCloud":"Прямой аудиопоток · HTTPS"):(t.id.startsWith("soundcloud:")?"SoundCloud · сохранено на телефоне":"Музыка с телефона · доступна без сети"),11,muted,false);source.setGravity(Gravity.CENTER);source.setPadding(0,dp(22),0,0);content.addView(source);
    }
    private void queue(){
        heading("Дальше звучит",player==null?"Нет активной очереди":player.queue().size()+" "+plural(player.queue().size(),"трек","трека","треков"));
        if(player==null||player.queue().isEmpty()){empty("queue","Очередь пока пуста","Включи волну или добавь треки из библиотеки.");return;}
        List<Track> list=player.queue();for(int i=0;i<list.size();i++)trackRow(content,list.get(i),list,i,true);
    }
    private void lyrics(){
        Track t=current();if(t==null){cancelLyrics();empty("lyrics","Сначала выбери трек","Текст найдётся по названию и исполнителю, если он есть у источника. Можно добавить свой TXT или LRC.");return;}
        heading(t.title,t.artist);String imported=store.lyrics(t.id);lyricLines=LrcParser.parse(imported);
        boolean own=!lyricLines.isEmpty();long duration=lyricDuration(t);
        LyricsMetadata.Query identity=lyricsRepository.identity(t.id,t.title,t.artist,duration);
        if(own){if(lyricsLoading)cancelLyrics();lyricsDuration=duration;paragraph("Твой файл · "+(lyricLines.get(0).time>=0?"строки с таймкодами":"без таймкодов"));}
        else{
            String key=lyricsRepository.key(t.id,identity);if(!key.equals(lyricsRequestKey))requestLyrics(t,false);
            lyricLines=LyricsRepository.lines(automaticLyrics);
            if(lyricsLoading){TextView state=text("Ищем текст…",15,muted,false);state.setTag("lyrics_loading");state.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);content.addView(state);gap(14);}
            else if(!lyricsError.isEmpty()){
                TextView error=text(lyricsError,14,muted,false);error.setTag("lyrics_error");error.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);content.addView(error);gap(14);
            }else if(automaticLyrics!=null&&automaticLyrics.instrumental)empty("lyrics","Без слов","LRCLIB отметил эту запись как инструментальную. Если это не так, уточни данные или добавь свой текст.");
            else if(lyricLines.isEmpty())empty("lyrics",LyricsMetadata.candidates(identity.title,identity.artist,duration).isEmpty()?"Уточни данные песни":"Текст пока не найден","Проверь название и исполнителя: имя загрузившего трек может отличаться от автора. Можно повторить поиск или добавить свой TXT/LRC.");
            if(automaticLyrics!=null&&automaticLyrics.found())paragraph("LRCLIB · "+(automaticLyrics.timed?"строки с таймкодами":automaticLyrics.versionMismatch?"другая длительность · без таймкодов":"без таймкодов"));
        }
        for(LrcParser.Line line:lyricLines){TextView v=text(line.text,23,line.time<0?ink:muted,true);v.setLineSpacing(dp(4),1);v.setPadding(0,dp(12),0,dp(12));if(line.time>=0){v.setContentDescription("Перейти к "+format(line.time)+": "+line.text);v.setOnClickListener(w->{Track active=current();if(player!=null&&active!=null&&active.id.equals(t.id))player.seekTo(line.time);});}lyricViews.add(v);content.addView(v);}
        gap(18);
        if(!own){TextView retry=button("Повторить поиск",false,()->{requestLyrics(t,true);render();});retry.setTag("lyrics_retry");retry.setEnabled(!lyricsLoading);retry.setAlpha(lyricsLoading?.45f:1f);content.addView(retry);gap(8);TextView match=button("Уточнить название и исполнителя",false,()->lyricsIdentityDialog(t));match.setTag("lyrics_identity");content.addView(match);gap(8);}
        content.addView(button(own?"Заменить свой файл":"Добавить свой TXT / LRC",false,()->importLyrics(t.id)));
    }
    private long lyricDuration(Track track){long value=player==null?0:player.duration();return value>0?value:track.duration;}
    private void cancelLyrics(){lyricsGeneration++;if(lyricsTask!=null)lyricsTask.cancel(true);lyricsTask=null;if(lyricsRepository!=null)lyricsRepository.cancel();lyricsLoading=false;lyricsRequestKey="";}
    private void requestLyrics(Track track,boolean force){
        cancelLyrics();LyricsMetadata.Query identity=lyricsRepository.identity(track.id,track.title,track.artist,lyricDuration(track));
        lyricsRequestKey=lyricsRepository.key(track.id,identity);lyricsTrackId=track.id;lyricsDuration=identity.duration;automaticLyrics=null;lyricsError="";
        if(LyricsMetadata.candidates(identity.title,identity.artist,identity.duration).isEmpty())return;
        final int ticket=lyricsGeneration;final String key=lyricsRequestKey;lyricsLoading=true;
        lyricsTask=lyricsIo.submit(()->{
            LyricsProvider.Result result=null;String error="";
            try{result=lyricsRepository.load(track.id,identity,force);}catch(Exception failure){error=failure.getMessage()==null?"Не удалось загрузить текст. Повтори поиск.":failure.getMessage();}
            final LyricsProvider.Result loaded=result;final String message=error;
            handler.post(()->{Track now=current();if(!alive||ticket!=lyricsGeneration||!key.equals(lyricsRequestKey)||!page.equals("lyrics")||now==null||!now.id.equals(track.id))return;lyricsLoading=false;lyricsTask=null;automaticLyrics=loaded;lyricsError=message;render();});
        });
    }
    private void lyricsIdentityDialog(Track track){
        LyricsMetadata.Query identity=lyricsRepository.identity(track.id,track.title,track.artist,lyricDuration(track));
        LinearLayout body=column();body.setPadding(dp(24),dp(8),dp(24),0);EditText title=edit("Название песни"),artist=edit("Исполнитель");title.setTag("lyrics_title");artist.setTag("lyrics_artist");title.setText(identity.title);artist.setText(identity.artist);title.setFilters(new InputFilter[]{new InputFilter.LengthFilter(300)});artist.setFilters(new InputFilter[]{new InputFilter.LengthFilter(300)});body.addView(title);View spacer=new View(this);body.addView(spacer,new LinearLayout.LayoutParams(1,dp(10)));body.addView(artist);TextView error=inlineError();body.addView(error);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Данные для поиска текста").setView(body).setNegativeButton("Отмена",null).setNeutralButton("Из трека",(d,w)->{lyricsRepository.resetIdentity(track.id);requestLyrics(track,true);render();}).setPositiveButton("Найти",null).create();
        lyricsDialog=dialog;dialog.setOnDismissListener(d->{if(lyricsDialog==dialog)lyricsDialog=null;});dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{try{lyricsRepository.setIdentity(track.id,title.getText().toString(),artist.getText().toString());dialog.dismiss();requestLyrics(track,true);render();}catch(IllegalArgumentException failure){error.setText(failure.getMessage());error.setVisibility(View.VISIBLE);}}));dialog.show();
    }
    private void sound(){
        heading("Настрой под себя","Эффекты нативного плеера");
        if(player==null){paragraph("Плеер подключается…");return;}
        LinearLayout presets=row();presets.addView(chip("Оригинал",false,()->preset(1f,1f,0)));presets.addView(chip("Slowed",false,()->preset(.85f,.9f,0)));presets.addView(chip("Speed up",false,()->preset(1.2f,1.1f,0)));content.addView(horizontal(presets));
        section("Скорость");slider(String.format(Locale.ROOT,"%.2f×",player.speed()),150,Math.round((player.speed()-.5f)*100),value->{player.setSpeed(.5f+value/100f);},value->String.format(Locale.ROOT,"%.2f×",.5f+value/100f));
        section("Низкие частоты");if(player.bassAvailable())slider("Bass Boost · "+player.bass()/10+"%",100,player.bass()/10,value->player.setBass(value*10),value->"Bass Boost · "+value+"%");else paragraph("Эффект станет доступен после запуска трека, если его поддерживает устройство.");
        section("Эквалайзер");if(player.eqAvailable()){short[] range=player.eqRange();for(int i=0;i<player.eqBandCount();i++){final int band=i;int hz=player.eqCenterHz(i);String frequency=hz>=1000?String.format(Locale.ROOT,"%.1f кГц",hz/1000f):hz+" Гц";slider(frequency,range[1]-range[0],player.eqBandLevel(i)-range[0],value->player.setEqBand(band,(short)(value+range[0])),value->frequency+"  "+String.format(Locale.ROOT,"%+.1f dB",(value+range[0])/100f));}}else paragraph("Количество полос зависит от аудиосистемы телефона.");
        if(player.reverbAvailable())switchRow("Лёгкий Reverb","Пространство для наушников",player.reverb(),enabled->player.setReverb(enabled));
        section("Таймер сна");long sleep=player.sleepRemainingMillis();actionRow("moon",sleep>0?"Осталось "+(sleep/60000+1)+" мин":"Остановить музыку по таймеру","15, 30, 45 или 60 минут",()->sleepDialog());
        gap(12);content.addView(button("Сбросить эффекты",false,()->{player.setSpeed(1);player.setPitch(1);player.setBass(0);player.setReverb(false);for(int i=0;i<player.eqBandCount();i++)player.setEqBand(i,(short)0);render();}));
    }
    private interface ValueAction {void accept(int value);}private interface ValueLabel{String label(int value);}
    private void slider(String title,int max,int value,ValueAction action,ValueLabel formatter){
        TextView label=text(title,14,ink,false);content.addView(label);SeekBar s=new SeekBar(this);s.setMax(Math.max(1,max));s.setProgress(Math.max(0,value));s.setProgressTintList(ColorStateList.valueOf(accent));s.setThumbTintList(ColorStateList.valueOf(accent));s.setContentDescription(title);s.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onProgressChanged(SeekBar s,int v,boolean user){if(user){action.accept(v);label.setText(formatter.label(v));}}public void onStartTrackingTouch(SeekBar s){}public void onStopTrackingTouch(SeekBar s){}});content.addView(s,new LinearLayout.LayoutParams(-1,dp(48)));
    }
    private void preset(float speed,float pitch,int bass){player.setSpeed(speed);player.setPitch(pitch);player.setBass(bass);render();}
    private void sleepDialog(){final int[] minutes={15,30,45,60,0};new AlertDialog.Builder(this).setTitle("Таймер сна").setItems(new String[]{"15 минут","30 минут","45 минут","60 минут","Выключить таймер"},(d,i)->{if(player!=null)player.setSleepMinutes(minutes[i]);render();}).setNegativeButton("Отмена",null).show();}
    private void profile(){
        String version="";try{version=getPackageManager().getPackageInfo(getPackageName(),0).versionName;}catch(Exception ignored){}
        heading("Твой LolzCloud","Android · версия "+version);
        section("Оформление");LinearLayout themes=row();for(String name:new String[]{"Forest","Paper","Ink"})themes.addView(chip(name,store.preferences().getString("theme","forest").equals(name.toLowerCase(Locale.ROOT)),()->{store.preferences().edit().putString("theme",name.toLowerCase(Locale.ROOT)).apply();render();}));content.addView(horizontal(themes));
        section("Только для тебя");switchRow("Приватное прослушивание","Не добавлять треки в историю",store.privateMode(),enabled->store.setPrivateMode(enabled));actionRow("bookmark","Любимые моменты","Закладки с точной позицией",()->navigate("bookmarks"));
        section("LolzCloud");socialStatusText=text(social.state().status,13,muted,false);content.addView(socialStatusText);
        actionRow("people","Профиль LolzCloud","Фото, фон и информация о тебе",()->openSocial("profile"));
        actionRow("people","Друзья","Общий список на телефоне и ПК",()->openSocial("friends"));
        actionRow("people","Уведомления","Запросы в друзья и приглашения в комнаты",()->openSocial("notifications"));
        switchRow("Уведомления на этом телефоне","Фоновая проверка зависит от Android",social.enabled(),enabled->{social.setEnabled(enabled);updateSocialStatus();if(enabled&&!social.systemAllowed())social.requestPermissionOrSettings(this);});
        socialNotificationText=text("",12,muted,false);content.addView(socialNotificationText);updateSocialStatus();
        actionRow("sliders","Разрешение уведомлений","Открыть системные настройки",()->social.requestPermissionOrSettings(this));
        paragraph("Счётчик вверху показывает непрочитанное. В фоне Android проверяет уведомления периодически; мгновенная доставка пока не подключена.");
        section("Источники музыки");sourceRows();actionRow("people","Аккаунт Lolzteam","Вход для комнат и пульта",()->openOnline("https://lolzcloud.com/login","Lolzteam · LolzCloud"));
        section("Твои данные");actionRow("export","Экспорт настроек","Любимые потоки и настройки звука",()->exportProfile());actionRow("import","Восстановить настройки","Из файла LolzCloud Android",()->importProfile());
        section("Обновления");statusText=text(updateStatus,14,muted,false);content.addView(statusText);gap(12);content.addView(button(updateAvailable?"Скачать и установить":"Проверить обновление",false,()->{if(updateAvailable)updater.installAvailable();else updater.check();}));
        paragraph("Данные сохраняются при установке новой версии поверх текущей. Установку подтверждает Android.");
        gap(14);TextView open=text("LolzCloud · открытый исходный код",12,muted,false);open.setOnClickListener(v->external("https://github.com/Artemper52/LolzCloud"));content.addView(open);
    }
    private void openSocial(String tab){openOnline(SocialPolicy.ORIGIN+"/social?tab="+tab,"LolzCloud · "+(tab.equals("friends")?"Друзья":tab.equals("notifications")?"Уведомления":"Профиль"));}
    private void updateSocialStatus(){
        if(social==null)return;SocialNotifications.State state=social.state();
        if(socialStatusText!=null)socialStatusText.setText(state.status);
        if(unreadBadge!=null){unreadBadge.setText(state.unread>99?"99+":String.valueOf(state.unread));unreadBadge.setVisibility(state.unread>0?View.VISIBLE:View.GONE);}
        if(profileHeaderAction!=null)profileHeaderAction.setContentDescription("Профиль и настройки"+(state.unread>0?". Непрочитанных уведомлений: "+state.unread:""));
        if(socialNotificationText!=null)socialNotificationText.setText(!social.enabled()?"Уведомления на телефоне выключены":!social.systemAllowed()?"Android не разрешил уведомления. Их можно включить в настройках ниже":!state.signedIn?"Для уведомлений войди через Lolzteam":!state.serverNotificationsEnabled?"Уведомления выключены в профиле LolzCloud":"Уведомления разрешены · непрочитанных: "+state.unread);
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==52||request==51)updateSocialStatus();}
    private interface ToggleAction{void accept(boolean enabled);}
    private void switchRow(String title,String subtitle,boolean checked,ToggleAction action){LinearLayout r=row();r.setGravity(Gravity.CENTER_VERTICAL);r.setPadding(0,dp(10),0,dp(10));LinearLayout labels=column();labels.addView(text(title,15,ink,true));TextView s=text(subtitle,12,muted,false);s.setPadding(0,dp(5),0,0);labels.addView(s);r.addView(labels,new LinearLayout.LayoutParams(0,-2,1));Switch toggle=new Switch(this);toggle.setButtonTintList(ColorStateList.valueOf(accent));toggle.setThumbTintList(ColorStateList.valueOf(accent));toggle.setContentDescription(title);toggle.setChecked(checked);toggle.setOnCheckedChangeListener((b,v)->action.accept(v));r.addView(toggle);content.addView(r);}
    private void bookmarks(){
        heading("Любимые моменты","Позиции, к которым хочется вернуться");boolean any=false;
        for(Track t:store.tracks()){JSONArray marks;try{marks=new JSONArray(store.preferences().getString("bookmarks_"+t.id,"[]"));}catch(JSONException e){continue;}
            for(int i=0;i<marks.length();i++){long time=marks.optLong(i);any=true;actionRow("bookmark",t.title,format(time)+" · "+t.artist,()->{playList(Collections.singletonList(t),0);handler.postDelayed(()->{if(player!=null)player.seekTo(time);},100);navigate("player");});}}
        if(!any)empty("bookmark","Сохрани любимый момент","В меню трека на экране плеера выбери «Сохранить момент».");
    }

    private void miniPlayer(){
        Track t=current();mini=row();mini.setGravity(Gravity.CENTER_VERTICAL);mini.setMinimumHeight(dp(68));mini.setPadding(dp(12),dp(7),dp(4),dp(7));mini.setBackground(round(panel,14));LinearLayout.LayoutParams m=new LinearLayout.LayoutParams(-1,-2);m.setMargins(dp(12),dp(2),dp(12),dp(6));root.addView(mini,m);
        Cover cover=new Cover(t);mini.addView(cover,new LinearLayout.LayoutParams(dp(46),dp(46)));LinearLayout label=column();label.setGravity(Gravity.CENTER_VERTICAL);miniTitle=text(t==null?"Твоя музыка здесь":t.title,13,ink,true);miniTitle.setSingleLine(true);miniTitle.setEllipsize(TextUtils.TruncateAt.END);miniArtist=text(t==null?"Добавь файлы с телефона":t.artist,11,muted,false);miniArtist.setSingleLine(true);label.addView(miniTitle);label.addView(miniArtist);LinearLayout.LayoutParams l=new LinearLayout.LayoutParams(0,-2,1);l.setMargins(dp(12),0,0,0);mini.addView(label,l);label.setOnClickListener(v->{if(current()==null)importAudio();else navigate("player");});cover.setOnClickListener(v->{if(current()!=null)navigate("player");else importAudio();});
        miniPlay=iconButton("play","Воспроизведение / пауза",()->{if(player!=null&&player.current()!=null)player.toggle();else importAudio();});mini.addView(miniPlay);mini.addView(iconButton("next","Следующий трек",()->{if(player!=null)player.next();}));
    }
    private void bottomNav(){
        LinearLayout nav=row();nav.setGravity(Gravity.CENTER);nav.setMinimumHeight(dp(68));nav.setPadding(dp(8),dp(6),dp(8),dp(6));root.addView(nav,new LinearLayout.LayoutParams(-1,-2));
        String[][] tabs={{"wave","wave","Волна"},{"search","search","Поиск"},{"library","heart","Моя музыка"},{"rooms","people","Комнаты"}};
        for(String[] tab:tabs){boolean active=page.equals(tab[0]);LinearLayout item=column();item.setGravity(Gravity.CENTER);item.setMinimumHeight(dp(56));item.setSelected(active);Glyph icon=new Glyph(tab[1],active?accent:muted);item.addView(icon,new LinearLayout.LayoutParams(dp(24),dp(24)));TextView label=text(tab[2],getResources().getConfiguration().fontScale>=1.8f?9:10,active?accent:muted,active);label.setGravity(Gravity.CENTER);label.setPadding(0,dp(5),0,0);item.addView(label);item.setContentDescription(tab[2]+(active?", выбрано":""));item.setOnClickListener(v->selectTab(tab[0]));nav.addView(item,new LinearLayout.LayoutParams(0,-2,1));}
    }
    private void updatePlayback(){
        if(player==null)return;Track t=current();String id=t==null?"":t.id;
        if(!id.equals(shownTrack)){shownTrack=id;render();return;}
        if(page.equals("lyrics")&&t!=null&&lyricsDuration!=lyricDuration(t)){render();return;}
        String playLabel=player.isLoading()?"Отменить загрузку":player.isPlaying()?"Пауза":"Продолжить воспроизведение";
        if(miniTitle!=null){miniTitle.setText(t==null?"Твоя музыка здесь":t.title);miniArtist.setText(player.isLoading()?player.loadingMessage():t==null?"Добавь файлы с телефона":t.artist);if(miniPlay!=null){miniPlay.setGlyph(player.isPlaying()?"pause":"play");miniPlay.setContentDescription(playLabel);}}
        if(bigPlay!=null){bigPlay.setGlyph(player.isLoading()?"loading":player.isPlaying()?"pause":"play");bigPlay.setContentDescription(playLabel);}
        if(shuffleIcon!=null){shuffleIcon.color=player.shuffle()?accent:muted;shuffleIcon.setSelected(player.shuffle());shuffleIcon.setContentDescription("Перемешивание "+(player.shuffle()?"включено":"выключено"));shuffleIcon.invalidate();repeatIcon.color=player.repeat()>0?accent:muted;repeatIcon.setGlyph(player.repeat()==2?"repeatOne":"repeat");repeatIcon.setContentDescription(player.repeat()==0?"Повтор выключен":player.repeat()==1?"Повтор очереди":"Повтор трека");}
        if(progress!=null){long total=player.duration(),pos=player.position();if(!seeking)progress.setProgress(total>0?(int)Math.min(10000,pos*10000/total):0);elapsed.setText(format(pos));remaining.setText(format(total));}
        if(audioStatusText!=null){String message=player.isLoading()?player.loadingMessage():player.error();audioStatusText.setText(message);audioStatusText.setVisibility(message==null||message.isEmpty()?View.GONE:View.VISIBLE);audioRetryButton.setVisibility(!player.isLoading()&&message!=null&&!message.isEmpty()?View.VISIBLE:View.GONE);}
        if(page.equals("lyrics")&&!lyricViews.isEmpty()){int active=LrcParser.activeLine(lyricLines,player.position());if(active!=activeLyric){for(int i=0;i<lyricViews.size();i++)lyricViews.get(i).setTextColor(i==active?accent:lyricLines.get(i).time<0?ink:muted);activeLyric=active;}}
        String error=player.error();if(error!=null&&!error.isEmpty()&&!error.equals(lastError)){lastError=error;toast(error);}if(error==null||error.isEmpty())lastError="";
    }
    private void trackRow(LinearLayout parent,Track t,List<Track> list,int index,boolean queued){
        LinearLayout r=row();r.setGravity(Gravity.CENTER_VERTICAL);r.setMinimumHeight(dp(76));r.setContentDescription(t.title+". "+t.artist);Cover cover=new Cover(t);r.addView(cover,new LinearLayout.LayoutParams(dp(52),dp(52)));LinearLayout labels=column();TextView title=text(t.title,14,ink,true);title.setSingleLine(true);title.setEllipsize(TextUtils.TruncateAt.END);labels.addView(title);String origin=t.id.startsWith("soundcloud:")?(t.uri.startsWith("https:")?"SoundCloud · ":"Сохранено · "):t.uri.startsWith("https:")?"Онлайн-поток · ":"";TextView artist=text(origin+t.artist+((t.duration>0)?" · "+format(t.duration):""),12,muted,false);artist.setSingleLine(true);artist.setEllipsize(TextUtils.TruncateAt.END);artist.setPadding(0,dp(5),0,0);labels.addView(artist);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(0,-2,1);lp.leftMargin=dp(13);r.addView(labels,lp);r.setOnClickListener(v->{if(queued&&player!=null){player.replaceStoredTrack(rememberTrack(t));player.playIndex(index);}else playList(list,index);navigate("player");});
        Glyph more=iconButton("more","Действия: "+t.title,()->{if(queued){PopupMenu menu=new PopupMenu(this,r);menu.getMenu().add("Удалить из очереди").setOnMenuItemClickListener(item->{player.removeFromQueue(index);render();return true;});menu.show();}else trackMenu(t,r);});r.addView(more);parent.addView(r,new LinearLayout.LayoutParams(-1,-2));
    }
    private void trackMenu(Track t,View anchor){
        PopupMenu menu=new PopupMenu(this,anchor);
        menu.getMenu().add(store.isLiked(t.id)?"Убрать из любимых":"В любимые").setOnMenuItemClickListener(v->{rememberTrack(t);store.toggleLike(t.id);render();return true;});
        menu.getMenu().add("Добавить в очередь").setOnMenuItemClickListener(v->{if(player==null){toast("Плеер подключается. Попробуй ещё раз.");return true;}player.enqueue(rememberTrack(t));toast("Добавлено в очередь");return true;});
        if(t.uri.startsWith("https:"))menu.getMenu().add("Сохранить аудио офлайн").setOnMenuItemClickListener(v->{
            if(!downloading.add(t.id)){toast("Этот трек уже сохраняется");return true;}
            toast("Сохраняем аудиофайл…");
            final Track download=rememberTrack(t);io.execute(()->{try{Track saved=StreamDownloads.save(getApplicationContext(),download,store);Track stored=store.find(saved.id);final Track canonical=stored==null?saved:stored;PlaybackService.offlineSaved(canonical);handler.post(()->{if(alive){toast("Трек сохранён и доступен без сети");render();}});}catch(Exception error){handler.post(()->{if(alive)toast("Не удалось сохранить: "+error.getMessage());});}finally{handler.post(()->downloading.remove(t.id));}});
            return true;
        });
        if(current()!=null&&current().id.equals(t.id))menu.getMenu().add("Сохранить момент").setOnMenuItemClickListener(v->{
            try{JSONArray marks=new JSONArray(store.preferences().getString("bookmarks_"+t.id,"[]"));marks.put(player.position());store.preferences().edit().putString("bookmarks_"+t.id,marks.toString()).apply();toast("Момент сохранён · "+format(player.position()));}catch(JSONException e){toast("Не удалось сохранить момент");}return true;
        });
        if(store.find(t.id)==null)menu.getMenu().add("Добавить в мою музыку").setOnMenuItemClickListener(v->{rememberTrack(t);toast("Трек добавлен в мою музыку");render();return true;});
        else menu.getMenu().add("Удалить из библиотеки").setOnMenuItemClickListener(v->{new AlertDialog.Builder(this).setTitle("Убрать «"+t.title+"»?").setMessage("Исходный файл останется на телефоне.").setPositiveButton("Убрать",(d,w)->{store.remove(t.id);render();}).setNegativeButton("Отмена",null).show();return true;});
        menu.show();
    }
    private Track rememberTrack(Track track){if(track==null)return null;if(track.id.startsWith("soundcloud:"))return store.rememberCatalog(track);store.add(track);return track;}
    private void playList(List<Track> tracks,int index){if(player==null){toast("Плеер подключается. Попробуй ещё раз.");return;}if(tracks.isEmpty()||index<0||index>=tracks.size())return;List<Track> resolved=store.resolveCatalog(tracks);resolved.set(index,rememberTrack(resolved.get(index)));hideKeyboard();if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED&&!store.preferences().getBoolean("notification_permission_asked",false)){store.preferences().edit().putBoolean("notification_permission_asked",true).apply();requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},51);}player.setQueue(resolved,index,true);}
    private void importAudio(){Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.setType("audio/*");intent.addCategory(Intent.CATEGORY_OPENABLE);intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);try{startActivityForResult(intent,IMPORT_AUDIO);}catch(ActivityNotFoundException e){toast("На телефоне нет приложения для выбора файлов");}}
    private void importLyrics(String id){pendingLyricsId=id;Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");i.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"text/plain","application/octet-stream","application/x-subrip"});startActivityForResult(i,IMPORT_LYRICS);}
    private void exportProfile(){Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/json");i.putExtra(Intent.EXTRA_TITLE,"LolzCloud-Android-profile.json");startActivityForResult(i,EXPORT_PROFILE);}
    private void importProfile(){Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/json");startActivityForResult(i,IMPORT_PROFILE);}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(result!=RESULT_OK||data==null)return;
        if(request==IMPORT_AUDIO){List<Uri> uris=new ArrayList<>();if(data.getClipData()!=null){for(int i=0;i<Math.min(500,data.getClipData().getItemCount());i++)uris.add(data.getClipData().getItemAt(i).getUri());}else if(data.getData()!=null)uris.add(data.getData());final int flags=data.getFlags()&Intent.FLAG_GRANT_READ_URI_PERMISSION;toast("Добавляем музыку…");io.execute(()->{int count=0,failed=0;for(Uri uri:uris){try{getContentResolver().takePersistableUriPermission(uri,flags);store.addUri(uri);count++;}catch(Exception e){failed++;}}final int added=count,errors=failed;handler.post(()->{if(alive){toast(uris.isEmpty()?"Файлы не выбраны":errors>0?"Добавлено: "+added+", не удалось: "+errors:"Добавлено: "+added);filter="all";selectTab("library");}});});return;}
        Uri uri=data.getData();if(uri==null)return;final String lyricsTrackId=pendingLyricsId;if(request==IMPORT_LYRICS)pendingLyricsId=null;io.execute(()->{try{if(request==EXPORT_PROFILE){try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException();out.write(store.exportProfile().getBytes(java.nio.charset.StandardCharsets.UTF_8));}}else{String value=readText(uri,1024*1024);if(request==IMPORT_LYRICS){if(lyricsTrackId==null)throw new IOException("Выбери трек и повтори импорт текста");store.saveLyrics(lyricsTrackId,value);}else if(request==IMPORT_PROFILE)store.importProfile(value);}handler.post(()->{if(alive){if(request==IMPORT_PROFILE&&player!=null)player.reloadSettings();toast(request==EXPORT_PROFILE?"Настройки экспортированы":"Готово");render();}});}catch(Exception e){handler.post(()->toast("Не удалось обработать файл: "+(e.getMessage()==null?"проверь формат":e.getMessage())));}});
    }
    private String readText(Uri uri,int max)throws IOException{try(InputStream in=getContentResolver().openInputStream(uri);ByteArrayOutputStream out=new ByteArrayOutputStream()){if(in==null)throw new IOException("Файл недоступен");byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>max)throw new IOException("Файл больше 1 МБ");out.write(buffer,0,n);}return new String(out.toByteArray(),java.nio.charset.StandardCharsets.UTF_8);}}
    private void addStream(){showLinkDialog("stream","");}
    private void invite(){showLinkDialog("room","");}
    private void remote(){showLinkDialog("remote","");}
    private void showLinkDialog(String kind,String value){
        if(!alive||!Arrays.asList("stream","room","remote").contains(kind))return;
        if(linkDialog!=null)linkDialog.dismiss();activeLinkKind=kind;
        String title=kind.equals("stream")?"Аудио по ссылке":kind.equals("room")?"Приглашение в комнату":"Пульт компьютера";
        String explanation=kind.equals("stream")?"Ссылка SoundCloud откроет нативный поиск. Прямая HTTPS-ссылка добавит аудиофайл или поток.":kind.equals("room")?"Скопируй приглашение из комнаты LolzCloud и вставь сюда.":"Открой пульт в LolzCloud на компьютере и скопируй его ссылку.";
        LinearLayout body=column();body.setPadding(dp(24),dp(8),dp(24),0);
        TextView help=text(explanation,13,muted,false);help.setLineSpacing(dp(4),1);help.setPadding(0,0,0,dp(16));body.addView(help);
        final EditText input=edit("Вставь ссылку");linkInput=input;input.setId(R.id.online_link_input);input.setMinHeight(dp(56));input.setContentDescription(title+". Ссылка");input.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);input.setImeOptions(EditorInfo.IME_ACTION_GO|EditorInfo.IME_FLAG_NO_EXTRACT_UI);input.setText(value);input.setSelection(value.length());body.addView(input,new LinearLayout.LayoutParams(-1,-2));
        final TextView errorLabel=inlineError();linkError=errorLabel;body.addView(errorLabel);
        boolean light=store.preferences().getString("theme","forest").equals("paper");
        ScrollView dialogScroll=new ScrollView(this);dialogScroll.setFillViewport(false);dialogScroll.addView(body);
        final AlertDialog dialog=new AlertDialog.Builder(new ContextThemeWrapper(this,light?android.R.style.Theme_Material_Light_Dialog_Alert:android.R.style.Theme_Material_Dialog_Alert)).setTitle(title).setView(dialogScroll).setNegativeButton("Отмена",null).setPositiveButton(kind.equals("stream")?"Добавить":"Открыть",null).create();
        linkDialog=dialog;
        Runnable submit=()->{
            String address=input.getText().toString().trim();
            if(address.isEmpty()){showInlineError(errorLabel,"Вставь ссылку");return;}
            try{
                if(kind.equals("stream")){if(OnlineCatalog.isSoundCloudAddress(address)){hideDialogKeyboard(input);dialog.dismiss();openSoundCloud(address);}else{store.addStream(address,"");hideDialogKeyboard(input);dialog.dismiss();filter="all";selectTab("library");toast("Ссылка добавлена");}}
                else{String url=LinkPolicy.lolzCloud(address,kind);hideDialogKeyboard(input);dialog.dismiss();openOnline(url,kind.equals("room")?"Комната LolzCloud":"Пульт LolzCloud");}
            }catch(IOException error){showInlineError(errorLabel,error.getMessage());input.requestFocus();}
        };
        dialog.setOnDismissListener(d->{if(linkDialog==dialog){linkDialog=null;linkInput=null;linkError=null;activeLinkKind="";}});
        dialog.setOnShowListener(d->{
            android.widget.Button positive=dialog.getButton(AlertDialog.BUTTON_POSITIVE);positive.setTextColor(accent);dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setTextColor(accent);
            positive.setEnabled(!input.getText().toString().trim().isEmpty());positive.setOnClickListener(v->submit.run());
            input.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void onTextChanged(CharSequence s,int start,int before,int count){errorLabel.setVisibility(View.GONE);positive.setEnabled(!s.toString().trim().isEmpty());}public void afterTextChanged(Editable e){}});
            input.requestFocus();input.postDelayed(()->{if(dialog.isShowing())((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).showSoftInput(input,InputMethodManager.SHOW_IMPLICIT);},180);
        });
        input.setOnEditorActionListener((v,action,event)->{if(action==EditorInfo.IME_ACTION_GO||(event!=null&&event.getKeyCode()==KeyEvent.KEYCODE_ENTER&&event.getAction()==KeyEvent.ACTION_UP)){submit.run();return true;}return false;});
        dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE|WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);dialog.show();dialog.getWindow().setBackgroundDrawable(round(bg,18));
    }
    private TextView inlineError(){TextView label=text("",13,store.preferences().getString("theme","forest").equals("paper")?0xffb3261e:0xffffb4ab,false);label.setPadding(0,dp(8),0,dp(4));label.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);label.setVisibility(View.GONE);return label;}
    private void showInlineError(TextView label,String message){if(label!=null){label.setText(message);label.setVisibility(View.VISIBLE);}}
    private void hideDialogKeyboard(View input){((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(input.getWindowToken(),0);}
    private void openOnline(String url,String title){if(OnlineCatalog.isSoundCloudAddress(url)){openSoundCloud(url);return;}if(player!=null&&SocialPolicy.startsPlayback(url))player.pause();hideKeyboard();startActivity(new Intent(this,OnlineActivity.class).putExtra("url",url).putExtra("title",title));}
    private void external(String url){try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));}catch(ActivityNotFoundException e){toast("Установи браузер, чтобы открыть ссылку");}}
    private void hideKeyboard(){View focus=getCurrentFocus();if(focus!=null){((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(focus.getWindowToken(),0);focus.clearFocus();}}
    private void toast(String message){if(alive)Toast.makeText(this,message,Toast.LENGTH_LONG).show();}

    private LinearLayout column(){LinearLayout v=new LinearLayout(this);v.setOrientation(LinearLayout.VERTICAL);return v;}
    private LinearLayout row(){LinearLayout v=new LinearLayout(this);v.setOrientation(LinearLayout.HORIZONTAL);return v;}
    private TextView text(String value,float size,int color,boolean bold){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(color);t.setTypeface(Typeface.create(bold?"sans-serif-medium":"sans-serif",Typeface.NORMAL));t.setIncludeFontPadding(false);return t;}
    private GradientDrawable round(int color,float radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
    private TextView button(String title,boolean primary,Runnable action){TextView b=text(title,14,primary?dark:ink,true);b.setGravity(Gravity.CENTER);b.setPadding(dp(18),dp(15),dp(18),dp(15));b.setMinHeight(dp(50));b.setBackground(round(primary?accent:panel,12));b.setOnClickListener(v->action.run());b.setFocusable(true);b.setContentDescription(title);return b;}
    private TextView chip(String label,boolean selected,Runnable action){TextView b=text(label,12,selected?dark:muted,true);b.setGravity(Gravity.CENTER);b.setPadding(dp(14),dp(8),dp(14),dp(8));b.setMinHeight(dp(48));b.setSelected(selected);b.setContentDescription(label+(selected?", выбрано":""));b.setBackground(round(selected?accent:panel,22));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-2,-2);p.rightMargin=dp(8);b.setLayoutParams(p);b.setOnClickListener(v->action.run());return b;}
    private HorizontalScrollView horizontal(View child){HorizontalScrollView scroll=new HorizontalScrollView(this);scroll.setHorizontalScrollBarEnabled(false);scroll.setClipToPadding(false);scroll.addView(child);return scroll;}
    private Glyph iconButton(String name,String description,Runnable action){Glyph v=new Glyph(name,ink);v.setPadding(dp(13),dp(13),dp(13),dp(13));v.setLayoutParams(new LinearLayout.LayoutParams(dp(48),dp(48)));v.setContentDescription(description);v.setOnClickListener(w->action.run());v.setFocusable(true);return v;}
    private EditText edit(String hint){EditText e=new EditText(this);e.setTextSize(15);e.setTextColor(ink);e.setHintTextColor(muted);e.setHint(hint);e.setPadding(dp(16),dp(12),dp(16),dp(12));e.setBackground(round(panel,12));e.setSingleLine(true);return e;}
    private void gap(int height){View s=new View(this);content.addView(s,new LinearLayout.LayoutParams(1,dp(height)));}
    private void section(String title){TextView t=text(title,17,ink,true);t.setPadding(0,dp(24),0,dp(12));content.addView(t);}
    private void paragraph(String value){TextView t=text(value,13,muted,false);t.setLineSpacing(dp(5),1);t.setPadding(0,dp(14),0,dp(4));content.addView(t);}
    private void empty(String icon,String title,String message){Glyph art=new Glyph(icon,accent);LinearLayout.LayoutParams a=new LinearLayout.LayoutParams(dp(56),dp(56));a.topMargin=dp(30);a.bottomMargin=dp(20);content.addView(art,a);content.addView(text(title,21,ink,true));paragraph(message);gap(18);}
    private void actionRow(String icon,String title,String subtitle,Runnable action){LinearLayout r=row();r.setGravity(Gravity.CENTER_VERTICAL);r.setPadding(0,dp(12),0,dp(12));r.setMinimumHeight(dp(76));Glyph g=new Glyph(icon,accent);r.addView(g,new LinearLayout.LayoutParams(dp(26),dp(26)));LinearLayout labels=column();labels.addView(text(title,14,ink,true));TextView s=text(subtitle,12,muted,false);s.setPadding(0,dp(6),0,0);labels.addView(s);LinearLayout.LayoutParams l=new LinearLayout.LayoutParams(0,-2,1);l.leftMargin=dp(16);l.rightMargin=dp(8);r.addView(labels,l);Glyph arrow=new Glyph("chevron",muted);r.addView(arrow,new LinearLayout.LayoutParams(dp(18),dp(18)));r.setOnClickListener(v->action.run());r.setContentDescription(title+". "+subtitle);content.addView(r);}
    private void smallAction(LinearLayout parent,String icon,String label,Runnable action){LinearLayout item=column();item.setGravity(Gravity.CENTER);item.setMinimumHeight(dp(64));Glyph glyph=new Glyph(icon,muted);item.addView(glyph,new LinearLayout.LayoutParams(dp(24),dp(24)));TextView text=text(label,11,muted,false);text.setGravity(Gravity.CENTER);text.setPadding(0,dp(8),0,0);item.addView(text);item.setOnClickListener(v->action.run());item.setContentDescription(label);parent.addView(item,new LinearLayout.LayoutParams(0,-2,1));}
    private static String format(long millis){long seconds=Math.max(0,millis)/1000;return String.format(Locale.ROOT,"%d:%02d",seconds/60,seconds%60);}
    private static String plural(int value,String one,String few,String many){int mod=value%100;if(mod>=11&&mod<=14)return many;switch(value%10){case 1:return one;case 2:case 3:case 4:return few;default:return many;}}

    private final class Cover extends View {
        private final Track track;private Bitmap image;private boolean requested;private final Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);
        Cover(Track track){
            super(MainActivity.this);this.track=track;setLayerType(View.LAYER_TYPE_SOFTWARE,null);if(track!=null)image=artwork.get(track.id+"|"+track.coverUrl);
        }
        private void loadImage(){
            if(track==null||image!=null||requested||!alive)return;requested=true;
            final String key=track.id+"|"+track.coverUrl;image=artwork.get(key);if(image!=null)return;
            List<WeakReference<Cover>> waiting=artworkWaiters.get(key);if(waiting==null){waiting=new ArrayList<>();artworkWaiters.put(key,waiting);}waiting.add(new WeakReference<>(this));
            if(!artworkLoading.add(key))return;
            artworkIo.execute(()->{
                Bitmap decoded=null;
                try{
                    byte[] bytes=track.coverUrl.isEmpty()?store.artwork(track):OnlineCatalog.artwork(track.coverUrl);
                    if(bytes!=null){BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);
                        if(options.outWidth>0&&options.outHeight>0&&options.outWidth<=12000&&options.outHeight<=12000){options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>700)options.inSampleSize*=2;options.inJustDecodeBounds=false;decoded=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);}}
                }catch(IOException|RuntimeException ignored){}
                final Bitmap result=decoded;handler.post(()->{
                    artworkLoading.remove(key);List<WeakReference<Cover>> views=artworkWaiters.remove(key);if(!alive)return;
                    if(result!=null){artwork.put(key,result);if(views!=null)for(WeakReference<Cover> reference:views){Cover cover=reference.get();if(cover!=null){cover.image=result;cover.invalidate();}}}
                });
            });
        }
        @Override protected void onDraw(Canvas c){super.onDraw(c);loadImage();float w=getWidth(),h=getHeight();Path clip=new Path();clip.addRoundRect(new RectF(0,0,w,h),dp(w>dp(100)?16:8),dp(w>dp(100)?16:8),Path.Direction.CW);c.save();c.clipPath(clip);if(image!=null){float size=Math.min(image.getWidth(),image.getHeight());Rect src=new Rect((int)((image.getWidth()-size)/2),(int)((image.getHeight()-size)/2),(int)((image.getWidth()+size)/2),(int)((image.getHeight()+size)/2));c.drawBitmap(image,src,new RectF(0,0,w,h),p);}else{int resource=getResources().getIdentifier("forest_art","drawable",getPackageName());if(resource!=0){Drawable art=getResources().getDrawable(resource,getTheme());art.setBounds(0,0,(int)w,(int)h);art.draw(c);}else{p.setColor(Color.rgb(29,54,39));c.drawRect(0,0,w,h,p);p.setStyle(Paint.Style.STROKE);p.setStrokeWidth(Math.max(1,w/150));p.setColor(Color.rgb(76,104,85));for(int i=0;i<7;i++){float x=w*(i+1)/8;c.drawLine(x,h*.16f,x,h*.84f,p);c.drawLine(w*.16f,h*(i+1)/8,w*.84f,h*(i+1)/8,p);}p.setStyle(Paint.Style.FILL);p.setColor(Color.rgb(165,229,189));float[] values={.22f,.4f,.62f,.35f,.48f};for(int i=0;i<5;i++){float x=w*(.31f+i*.09f),height=h*values[i]*.65f;c.drawRoundRect(x,h/2-height/2,x+w*.035f,h/2+height/2,w*.02f,w*.02f,p);}}}c.restore();}
    }
    private final class Glyph extends View {
        private String glyph;int color;private final Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);
        Glyph(String name,int color){super(MainActivity.this);glyph=name;this.color=color;}
        void setGlyph(String name){glyph=name;invalidate();}
        private void line(Canvas c,float x,float y,float a,float b){c.drawLine(x,y,a,b,p);}
        private void path(Canvas c,float...points){Path path=new Path();path.moveTo(points[0],points[1]);for(int i=2;i<points.length;i+=2)path.lineTo(points[i],points[i+1]);c.drawPath(path,p);}
        @Override protected void onDraw(Canvas canvas){super.onDraw(canvas);Canvas c=canvas;c.save();c.translate(getPaddingLeft(),getPaddingTop());float w=getWidth()-getPaddingLeft()-getPaddingRight(),h=getHeight()-getPaddingTop()-getPaddingBottom();c.scale(w/24,h/24);p.setColor(color);p.setStrokeWidth(1.8f);p.setStyle(Paint.Style.STROKE);p.setStrokeCap(Paint.Cap.ROUND);p.setStrokeJoin(Paint.Join.ROUND);
            switch(glyph){
                case "play":p.setStyle(Paint.Style.FILL);path(c,8,4,20,12,8,20,8,4);break;
                case "pause":p.setStrokeWidth(3.7f);line(c,8,5,8,19);line(c,16,5,16,19);break;
                case "next":path(c,5,5,15,12,5,19,5,5);line(c,19,5,19,19);break;
                case "previous":path(c,19,5,9,12,19,19,19,5);line(c,5,5,5,19);break;
                case "search":c.drawCircle(10.5f,10.5f,6.5f,p);line(c,15.5f,15.5f,21,21);break;
                case "heart":case "heartFilled":if(glyph.equals("heartFilled"))p.setStyle(Paint.Style.FILL);Path heart=new Path();heart.moveTo(12,21);heart.cubicTo(8,17,2,13,2,8);heart.cubicTo(2,2,9,1,12,6);heart.cubicTo(15,1,22,2,22,8);heart.cubicTo(22,13,16,17,12,21);c.drawPath(heart,p);break;
                case "cloud":Path cloud=new Path();cloud.moveTo(6,18);cloud.cubicTo(-1,18,0,9,6,10);cloud.cubicTo(5,1,17,0,18,9);cloud.cubicTo(25,8,26,18,19,18);c.drawPath(cloud,p);p.setStrokeWidth(1.6f);line(c,8,14,8,20);line(c,12,11,12,22);line(c,16,14,16,20);break;
                case "wave":p.setStrokeWidth(2.4f);line(c,3,10,3,14);line(c,7.5f,5,7.5f,19);line(c,12,2,12,22);line(c,16.5f,7,16.5f,17);line(c,21,9,21,15);break;
                case "people":c.drawCircle(8,7,3.5f,p);c.drawArc(new RectF(2,13,14,25),180,180,false,p);c.drawArc(new RectF(13,3,21,11),-80,240,false,p);c.drawArc(new RectF(12,14,23,25),235,120,false,p);break;
                case "profile":c.drawCircle(12,8,4,p);c.drawArc(new RectF(3,14,21,30),180,180,false,p);break;
                case "back":path(c,15,5,8,12,15,19);break;
                case "chevron":path(c,9,5,16,12,9,19);break;
                case "more":p.setStyle(Paint.Style.FILL);c.drawCircle(12,5,1.7f,p);c.drawCircle(12,12,1.7f,p);c.drawCircle(12,19,1.7f,p);break;
                case "music":case "lyrics":line(c,9,17,9,5);path(c,9,5,20,3,20,15);c.drawOval(new RectF(3,15,9,20),p);c.drawOval(new RectF(14,13,20,18),p);break;
                case "video":c.drawRoundRect(new RectF(2,5,22,19),4,4,p);path(c,10,9,15,12,10,15,10,9);break;
                case "link":c.drawArc(new RectF(2,9,14,21),45,270,false,p);c.drawArc(new RectF(10,1,22,13),225,270,false,p);line(c,8,16,16,8);break;
                case "remote":c.drawRoundRect(new RectF(5,2,19,22),3,3,p);c.drawCircle(12,10,3,p);line(c,10,18,14,18);break;
                case "queue":for(int i=0;i<3;i++){line(c,7,5+i*6,21,5+i*6);c.drawPoint(2,5+i*6,p);}break;
                case "sliders":line(c,5,2,5,22);line(c,12,2,12,22);line(c,19,2,19,22);p.setStrokeWidth(4);line(c,3,8,7,8);line(c,10,16,14,16);line(c,17,10,21,10);break;
                case "shuffle":path(c,3,5,6,5,17,19,21,19);path(c,18,16,21,19,18,22);path(c,3,19,6,19,17,5,21,5);path(c,18,2,21,5,18,8);break;
                case "repeat":case "repeatOne":path(c,18,3,21,6,18,9);path(c,4,10,4,6,21,6);path(c,6,15,3,18,6,21);path(c,20,14,20,18,3,18);if(glyph.equals("repeatOne")){p.setStyle(Paint.Style.FILL);p.setTypeface(Typeface.DEFAULT_BOLD);p.setTextSize(9);c.drawText("1",10,15,p);}break;
                case "bookmark":path(c,5,3,19,3,19,22,12,17,5,22,5,3);break;
                case "export":case "import":path(c,3,15,3,21,21,21,21,15);if(glyph.equals("export")){path(c,7,7,12,2,17,7);line(c,12,2,12,16);}else{path(c,7,10,12,15,17,10);line(c,12,2,12,15);}break;
                case "moon":Path moon=new Path();moon.moveTo(20,15);moon.cubicTo(7,20,2,7,10,2);moon.cubicTo(-6,5,1,27,16,21);moon.cubicTo(18,20,20,18,20,15);c.drawPath(moon,p);break;
                case "loading":c.drawArc(new RectF(3,3,21,21),20,260,false,p);break;
                default:c.drawCircle(12,12,8,p);
            }c.restore();
        }
    }
}
