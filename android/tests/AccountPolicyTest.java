package com.lolzcloud.mobile;

/** Pure trust-boundary tests: no browser, credentials, Android runtime or network. */
public final class AccountPolicyTest {
    private static int checks;
    private static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    public static void main(String[] args){
        String token="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",code="Abcd_Efg-12",room="https://lolzcloud.com/room/0123456789abcdef0123456789abcdef/";
        check(AccountPolicy.secret(token),"Opaque device/session secret has 43 base64url characters");
        for(String value:new String[]{null,"",token+"a",token.substring(1),token+"\r\n",token.replace('a','é')})check(!AccountPolicy.secret(value),"Malformed/header injection secrets rejected");
        String userCode="Abcd_Efg-123";
        check(AccountPolicy.code(userCode),"Browser code preserves case and valid URL-safe characters");
        check(!AccountPolicy.code(code)&&!AccountPolicy.code(userCode+"/")&&!AccountPolicy.code("тест12345678"),"Invalid display codes cannot become browser URLs");
        String verify="https://lolzcloud.com/connect?code="+userCode;
        check(AccountPolicy.verification(verify,userCode),"Only the complete fixed-origin device verification URL is accepted");
        for(String url:new String[]{"http://lolzcloud.com/connect?code="+userCode,"https://lolzcloud.com.evil.test/connect?code="+userCode,"https://evil@lolzcloud.com/connect?code="+userCode,"https://lolzcloud.com:8443/connect?code="+userCode,verify+"&next=https://evil.test",verify+"#token=bad","https://lolzcloud.com/connect?code=wrong"})check(!AccountPolicy.verification(url,userCode),"Untrusted or partial verification URL rejected");
        for(String url:new String[]{"https://lolzcloud.com/login","https://lolzcloud.com/login?next=%2Frooms","https://lolzcloud.com/auth/lolz?next=%2Fsocial","https://lolzcloud.com/auth/lolz/callback#state=fixture","https://lolz.team/account/authorize?client_id=fixture","https://lolz.live/oauth/authorize?response_type=token","https://zelenka.guru/login/"})check(AccountPolicy.loginNavigation(url),"LolzCloud/provider login is routed through native pairing");
        for(String url:new String[]{"http://lolz.team/login","https://lolz.team.evil.test/login","https://evil@lolz.team/login","https://accounts.google.com/login","https://secure.soundcloud.com/oauth/authorize","https://lolz.team/members/991/",room,"https://lolzcloud.com/social?tab=profile"})check(!AccountPolicy.loginNavigation(url),"Other services and public pages do not become Lolz login");
        check(AccountPolicy.destination("https://lolzcloud.com/login?next=%2Froom%2F0123456789abcdef0123456789abcdef%2F",null,null).equals(room),"An own login redirect returns to its exact room");
        check(AccountPolicy.destination("https://lolz.team/login",room,null).equals(room),"Provider navigation preserves the last own room destination");
        check(AccountPolicy.destination("https://lolzcloud.com/login",null,null).equals(AccountPolicy.PROFILE),"Direct account login returns to the profile");
        check(AccountPolicy.target("https://lolzcloud.com/social?tab=friends&user=991#ignored").equals("https://lolzcloud.com/social?tab=friends&user=991"),"Social tab and server user id survive; OAuth fragments do not");
        for(String next:new String[]{"https%3A%2F%2Fevil.test","%2F%2Fevil.test","%2Fapi%2Fsession","%2Fauth%2Flolz%2Fcallback","%252Froom%252F0123456789abcdef0123456789abcdef"})check(AccountPolicy.destination("https://lolzcloud.com/login?next="+next,null,null).equals(AccountPolicy.PROFILE),"Return target cannot escape into an API, OAuth or another origin");
        for(String url:new String[]{"https://evil.test/social","https://lolzcloud.com:8443/social","https://user@lolzcloud.com/social","https://lolzcloud.com/api/session","https://lolzcloud.com/%73ocial","file:///android_asset/social.html"})check(AccountPolicy.target(url).isEmpty(),"Only fixed own app pages become native return destinations");
        long now=1_800_000_000_000L;
        check(AccountPolicy.expires(now+AccountPolicy.MAX_SESSION,now),"Server's bounded seven-day session is valid");
        check(!AccountPolicy.expires(now,now)&&!AccountPolicy.expires(now-1,now)&&!AccountPolicy.expires(now+AccountPolicy.MAX_SESSION+60_001,now),"Expired/unbounded grants rejected");
        String cookie=AccountPolicy.cookie(token,now+AccountPolicy.MAX_SESSION,now);
        check(cookie.startsWith("__Host-lc_session="+token+"; Path=/; Max-Age=604800;"),"Only a verified own session gets a bounded persistent host cookie");
        check(cookie.contains("; Secure;")&&cookie.contains("; HttpOnly;")&&cookie.endsWith("SameSite=Lax")&&!cookie.contains("Domain="),"Cookie stays Secure HttpOnly host-only; no forum cookie is transferred");
        check(AccountPolicy.retryDelay(1,0)==3000&&AccountPolicy.retryDelay(2,0)==6000&&AccountPolicy.retryDelay(8,0)==30000&&AccountPolicy.retryDelay(1,429)==60000,"Transient retries are bounded and rate limits wait one minute");
        System.out.println("Account device-pair policy: "+checks+" behavior checks passed");
    }
}
