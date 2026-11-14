package com.lolzcloud.mobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Browser device approval, with an explicit native return/check/cancel path. */
public final class AccountLoginActivity extends Activity implements AccountLoginController.Listener {
    public static final String RETURN_URL="return_url";
    private AccountLoginController controller;
    private String destination;
    private TextView code,status,lifetime;
    private Button browser,check,newCode;
    private final Handler main=new Handler(Looper.getMainLooper());
    private boolean resumed,autoBrowser,openedBrowser,finished;
    public static Intent intent(Activity activity,String destination,boolean openBrowser){return new Intent(activity,AccountLoginActivity.class).putExtra(RETURN_URL,destination).putExtra("open_browser",openBrowser);}

    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);destination=AccountPolicy.target(getIntent().getStringExtra(RETURN_URL));if(destination.isEmpty())destination=AccountPolicy.PROFILE;
        autoBrowser=getIntent().getBooleanExtra("open_browser",false);openedBrowser=saved!=null&&saved.getBoolean("opened_browser");
        Object retained=getLastNonConfigurationInstance();controller=retained instanceof AccountLoginController?(AccountLoginController)retained:new AccountLoginController(this);
        getWindow().setStatusBarColor(0xff101613);getWindow().setNavigationBarColor(0xff101613);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(0xff101613);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setGravity(Gravity.CENTER_VERTICAL);root.setPadding(dp(24),dp(28),dp(24),dp(28));
        scroll.addView(root);scroll.setOnApplyWindowInsetsListener((view,insets)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);}else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
        label(root,"Вход в LolzCloud",27,0xfff1f5f2,true);
        label(root,"Подключи телефон через браузер",17,0xffa5e5bd,true);
        label(root,"В браузере войди через Lolzteam, сверь код ниже и нажми «Подтвердить подключение». Затем вернись в приложение.",15,0xff97a99e,false);
        code=label(root,"…",27,0xfff1f5f2,true);code.setTypeface(Typeface.MONOSPACE);code.setTextIsSelectable(true);code.setContentDescription("Код подключения телефона");
        lifetime=label(root,"",12,0xff97a99e,false);
        status=label(root,"",15,0xfff1f5f2,false);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        browser=button(root,"Открыть браузер",()->openBrowser());
        check=button(root,"Проверить подключение",()->controller.check());
        newCode=button(root,"Получить новый код",()->{openedBrowser=false;controller.newCode();});
        button(root,"Отмена",this::cancel);
        label(root,"Сам вход на форум ещё не подключает телефон. Подтверждай только тот код, который сейчас показан здесь.",12,0xff97a99e,false);
        setContentView(scroll);scroll.requestApplyInsets();controller.attach(this);
    }
    private TextView label(LinearLayout root,String value,int size,int color,boolean bold){TextView text=new TextView(this);text.setText(value);text.setTextSize(size);text.setTextColor(color);text.setLineSpacing(dp(3),1);text.setPadding(0,dp(8),0,dp(8));if(bold)text.setTypeface(Typeface.DEFAULT,Typeface.BOLD);root.addView(text,new LinearLayout.LayoutParams(-1,-2));return text;}
    private Button button(LinearLayout root,String label,Runnable action){Button button=new Button(this);button.setText(label);button.setAllCaps(false);button.setMinHeight(dp(50));button.setOnClickListener(v->action.run());LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2);params.topMargin=dp(8);root.addView(button,params);return button;}
    @Override public void changed(){
        if(finished||isFinishing())return;String value=controller.code();code.setText(value.isEmpty()?"…":value.substring(0,4)+" "+value.substring(4,8)+" "+value.substring(8));status.setText(controller.status);
        long remaining=controller.remaining();lifetime.setText(value.isEmpty()?"":remaining>0?"Код действует ещё "+Math.max(1,(remaining+59999)/60000)+" мин":"Срок действия кода закончился");
        browser.setEnabled(controller.hasPair());check.setEnabled(!controller.busy());newCode.setEnabled(!controller.busy());
        if(resumed&&autoBrowser&&!openedBrowser&&controller.hasPair())openBrowser();
    }
    private void openBrowser(){String url=controller.verificationUrl();if(!controller.hasPair()||!AccountPolicy.verification(url,controller.code()))return;openedBrowser=true;SourceBrowser.open(this,url);}
    @Override public void success(){if(!resumed||finished)return;finished=true;setResult(RESULT_OK,new Intent().putExtra(RETURN_URL,destination));finish();}
    private void cancel(){if(finished)return;finished=true;controller.cancel();setResult(RESULT_CANCELED);finish();}
    @Override public void onBackPressed(){cancel();}
    @Override protected void onResume(){super.onResume();resumed=true;controller.resume();changed();main.post(tick);}
    @Override protected void onPause(){resumed=false;main.removeCallbacks(tick);controller.pause();super.onPause();}
    private final Runnable tick=new Runnable(){@Override public void run(){if(resumed){changed();main.postDelayed(this,1000);}}};
    @Override public Object onRetainNonConfigurationInstance(){controller.detach();return controller;}
    @Override protected void onSaveInstanceState(Bundle state){state.putBoolean("opened_browser",openedBrowser);super.onSaveInstanceState(state);}
    @Override protected void onDestroy(){main.removeCallbacksAndMessages(null);controller.detach();if(!isChangingConfigurations())controller.dispose();super.onDestroy();}
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
}
