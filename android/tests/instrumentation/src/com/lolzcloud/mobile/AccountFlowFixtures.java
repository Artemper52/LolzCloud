package com.lolzcloud.mobile;

import android.app.Instrumentation;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.webkit.CookieManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

/** Test-APK-only bounded transport fixtures. No endpoint override or fake login flag enters production. */
public final class AccountFlowFixtures {
    private static final String DEVICE="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",TOKEN="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",CSRF="ccccccccccccccccccccccccccccccccccccccccccc",CODE="Abcd_Efg-123";
    private final Instrumentation instrumentation;
    private final JSONArray checks=new JSONArray();
    private final long now=System.currentTimeMillis();
    private interface Action{void run()throws Exception;}
    private interface Condition{boolean done()throws Exception;}
    private AccountFlowFixtures(Instrumentation instrumentation){this.instrumentation=instrumentation;}
    public static JSONArray run(Instrumentation instrumentation)throws Exception{AccountFlowFixtures suite=new AccountFlowFixtures(instrumentation);suite.protocol();suite.pendingLifecycle();return suite.checks;}
    private void protocol()throws Exception{
        Script transport=new Script(reply(200,start(600)));AccountApi api=new AccountApi(transport);AccountApi.Pair pair=api.start();
        check(pair.deviceCode.equals(DEVICE)&&pair.code.equals(CODE)&&pair.url.equals(AccountPolicy.verification(CODE)),"Strict Android JSON parser accepts the complete device-pair contract");
        check(transport.paths.equals(Arrays.asList("POST /api/desktop/start")),"Starting a pair performs only its fixed native API request");
        expectError(()->new AccountApi(new Script(reply(200,new JSONObject(start(600)).put("verificationUrl","https://evil.test/connect?code="+CODE).toString()))).start(),422,"Wrong-origin browser verification URL is rejected before any browser/cookie action");
        expectError(()->new AccountApi(new Script(reply(200,new JSONObject(start(600)).put("deviceCode","bad").toString()))).start(),422,"Malformed device secret cannot become a persisted pending login");
        expectError(()->new AccountApi(new Script(reply(200,new JSONObject(start(600)).put("expiresIn",601).toString()))).start(),422,"Server cannot create an unbounded pending-code lifetime");
        Script pending=new Script(reply(200,"{\"pending\":true,\"token\":\""+TOKEN+"\"}"));
        check(new AccountApi(pending).poll(DEVICE)==null&&pending.paths.size()==1,"Pending=true stays pending even if an unsolicited token field is present");
        Script approved=new Script(reply(200,grant("991",TOKEN,now+604800000L)),reply(200,session("991","Checked fixture")));
        AccountApi.Session checked=new AccountApi(approved).poll(DEVICE);
        check(checked!=null&&checked.id.equals("991")&&checked.name.equals("Checked fixture"),"An approved grant is accepted only after /api/session verifies the same server account");
        check(approved.bearerSeen&&!approved.cookieSeen&&approved.paths.size()==2,"Grant identity verification uses only the own opaque bearer, never forum cookies");
        Script cookie=new Script(reply(200,session("991","Checked fixture")));new AccountApi(cookie).verify(TOKEN,"991",now+604800000L,true);
        check(cookie.cookieSeen&&!cookie.bearerSeen&&cookie.paths.equals(Arrays.asList("GET /api/session")),"Cookie verification checks the same own session through the actual Cookie header path");
        expectError(()->new AccountApi(new Script(reply(401,""))).verify(TOKEN,"991",now+604800000L,true),401,"A failed final cookie verification remains a failure and requires rollback, never connected UI");
        expectError(()->new AccountApi(new Script(reply(200,grant("991",TOKEN,now+604800000L)),reply(200,session("992","Other fixture")))).poll(DEVICE),422,"Mismatched grant/session user ids cannot produce a connected account");
        expectError(()->new AccountApi(new Script(reply(200,grant("991","short",now+604800000L)))).poll(DEVICE),422,"Invalid grant token is rejected before cookie creation");
        expectError(()->new AccountApi(new Script(reply(200,grant("991",TOKEN,now-1)))).poll(DEVICE),422,"Expired grant is rejected before cookie creation");
        expectError(()->new AccountApi(new Script(reply(200,"{\"token\":\""+TOKEN+"\"}"))).poll(DEVICE),422,"Missing explicit pending=false is not interpreted as successful authentication");
        expectError(()->new AccountApi(new Script(reply(200,grant("991",TOKEN,now+604800000L)),reply(200,new JSONObject(session("991","Checked fixture")).put("authenticated",false).toString()))).poll(DEVICE),422,"A non-authenticated /api/session response cannot complete pairing");
        expectError(()->new AccountApi(new Script(reply(200,grant("991",TOKEN,now+604800000L)),reply(401,""))).poll(DEVICE),401,"Revoked grant remains an authentication error rather than a fake connected state");
        expectError(()->new AccountApi(new Script(reply(410,""))).poll(DEVICE),410,"Expired pending code remains distinguishable for explicit renewal");
        expectError(()->new AccountApi(new Script(reply(429,""))).poll(DEVICE),429,"Rate limits remain distinguishable for bounded backoff");
        Script redirect=new Script(reply(302,""));expectError(()->new AccountApi(redirect).start(),302,"HTTP redirect is not followed into another authentication context");
        check(redirect.paths.size()==1,"Rejected redirect causes no second transport request");
        Script network=new Script(reply(200,grant("991",TOKEN,now+604800000L)),new IOException("Declared transient fixture"));
        boolean transientFailure=false;try{new AccountApi(network).poll(DEVICE);}catch(AccountApi.ApiError terminal){throw new AssertionError("Transient network failure became a terminal protocol error");}catch(IOException expected){transientFailure=true;}
        check(transientFailure,"Transient verification failure remains retryable");
    }
    private void pendingLifecycle()throws Exception{
        Context context=instrumentation.getTargetContext();SharedPreferences prefs=context.getSharedPreferences("account-fixture-"+UUID.randomUUID(),Context.MODE_PRIVATE);
        String[] cookieBefore={null};onMain(()->cookieBefore[0]=CookieManager.getInstance().getCookie(AccountPolicy.ORIGIN+"/"));
        AtomicInteger starts=new AtomicInteger();AccountApi api=new AccountApi((method,path,body,auth,cookie)->{if(path.equals("/api/desktop/start")){starts.incrementAndGet();return reply(200,start(600));}return reply(200,"{\"pending\":true}");});
        AccountLoginController[] first={null},restored={null};
        try{
            onMain(()->{first[0]=new AccountLoginController(context,api,prefs);first[0].resume();});
            await(()->first[0].hasPair(),5000,"Controller receives one declared pending pair asynchronously");
            onMain(()->first[0].pause());
            check(prefs.contains("pending"),"Pending code and expiry are committed to private app preferences");
            onMain(()->restored[0]=new AccountLoginController(context,api,prefs));
            check(restored[0].code().equals(CODE)&&restored[0].remaining()>0&&restored[0].remaining()<=600000,"A fresh controller restores the same unexpired pending code and bounded remaining lifetime");
            check(starts.get()==1,"Restoring a pending flow does not request another server/device code");
            onMain(()->restored[0].cancel());check(!prefs.contains("pending"),"Explicit cancellation clears pending device credentials");
            onMain(()->{first[0].resume();first[0].check();});SystemClock.sleep(150);
            check(starts.get()==1&&!prefs.contains("pending"),"A stale retained controller cannot reopen a cancelled flow");
            String[] cookieAfter={null};onMain(()->cookieAfter[0]=CookieManager.getInstance().getCookie(AccountPolicy.ORIGIN+"/"));
            check(java.util.Objects.equals(cookieBefore[0],cookieAfter[0]),"Pending, restore and cancel do not alter the app's authenticated cookie");
        }finally{onMain(()->{if(first[0]!=null)first[0].dispose();if(restored[0]!=null)restored[0].dispose();prefs.edit().clear().commit();});}
        SharedPreferences expired=context.getSharedPreferences("account-expiry-fixture-"+UUID.randomUUID(),Context.MODE_PRIVATE);AtomicInteger renewals=new AtomicInteger();
        AccountApi shortApi=new AccountApi((method,path,body,auth,cookie)->{if(path.equals("/api/desktop/start")){renewals.incrementAndGet();return reply(200,start(1));}return reply(200,"{\"pending\":true}");});AccountLoginController[] shortFlow={null},afterDeath={null};
        try{
            onMain(()->{shortFlow[0]=new AccountLoginController(context,shortApi,expired);shortFlow[0].resume();});await(()->shortFlow[0].hasPair(),5000,"Short-lived declared pair is initially usable");onMain(()->shortFlow[0].pause());SystemClock.sleep(1200);
            onMain(()->shortFlow[0].resume());await(()->shortFlow[0].code().isEmpty(),3000,"Expired code is removed without an authenticated success");
            onMain(()->{shortFlow[0].pause();shortFlow[0].resume();shortFlow[0].check();afterDeath[0]=new AccountLoginController(context,shortApi,expired);afterDeath[0].resume();});SystemClock.sleep(150);
            check(renewals.get()==1,"Expiry/return/process restore do not automatically issue or reopen a new login code");
            onMain(()->afterDeath[0].newCode());await(()->renewals.get()==2&&afterDeath[0].hasPair(),3000,"Only explicit new-code action renews an expired flow");
        }finally{onMain(()->{if(shortFlow[0]!=null)shortFlow[0].dispose();if(afterDeath[0]!=null)afterDeath[0].cancel();expired.edit().clear().commit();});}
    }
    private AccountApi.Response reply(int code,String body){return new AccountApi.Response(code,body,now);}
    private String start(int seconds){return "{\"deviceCode\":\""+DEVICE+"\",\"code\":\""+CODE+"\",\"verificationUrl\":\""+AccountPolicy.verification(CODE)+"\",\"expiresIn\":"+seconds+"}";}
    private String grant(String id,String token,long expires){return "{\"pending\":false,\"token\":\""+token+"\",\"user\":{\"id\":"+id+",\"name\":\"Unverified display fixture\"},\"expires\":"+expires+"}";}
    private String session(String id,String name){return "{\"authenticated\":true,\"user\":{\"id\":"+id+",\"name\":\""+name+"\"},\"csrf\":\""+CSRF+"\"}";}
    private final class Script implements AccountApi.Transport{
        final ArrayDeque<Object> responses=new ArrayDeque<>();final List<String> paths=new ArrayList<>();boolean bearerSeen,cookieSeen;
        Script(Object... responses){this.responses.addAll(Arrays.asList(responses));}
        @Override public AccountApi.Response request(String method,String path,String body,String authorization,String cookie)throws IOException{
            paths.add(method+" "+path);if(!authorization.isEmpty()){if(!authorization.equals("Bearer "+TOKEN))throw new IOException("Unexpected authorization fixture");bearerSeen=true;}
            if(!cookie.isEmpty()){if(!cookie.equals("__Host-lc_session="+TOKEN))throw new IOException("Unexpected cookie fixture");cookieSeen=true;}
            if(path.equals("/api/desktop/poll"))try{if(!new JSONObject(body).getString("deviceCode").equals(DEVICE))throw new IOException("Unexpected poll code");}catch(IOException failure){throw failure;}catch(Exception failure){throw new IOException(failure);}
            if(responses.isEmpty())throw new IOException("Bounded fixture exhausted");Object response=responses.remove();if(response instanceof IOException)throw(IOException)response;return(AccountApi.Response)response;
        }
    }
    private void expectError(Action action,int status,String label)throws Exception{boolean rejected=false;try{action.run();}catch(AccountApi.ApiError error){rejected=error.status==status;}check(rejected,label);}
    private void check(boolean condition,String label)throws Exception{checks.put(new JSONObject().put("name",label).put("passed",condition));if(!condition)throw new AssertionError(label);}
    private void onMain(Runnable action){instrumentation.runOnMainSync(action);}
    private void await(Condition condition,long timeout,String label)throws Exception{long until=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<until){boolean[] result={false};Exception[] error={null};onMain(()->{try{result[0]=condition.done();}catch(Exception failure){error[0]=failure;}});if(error[0]!=null)throw error[0];if(result[0]){check(true,label);return;}SystemClock.sleep(40);}check(false,label);}
}
