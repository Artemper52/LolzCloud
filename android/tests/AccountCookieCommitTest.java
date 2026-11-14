package com.lolzcloud.mobile;

import java.util.ArrayDeque;

/** Delayed setter/callback tests use a memory jar; no real account or native cookie is fabricated. */
public final class AccountCookieCommitTest {
    private static int checks;
    private static final String A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",OLD="ooooooooooooooooooooooooooooooooooooooooooo";
    private static final long NOW=1_800_000_000_000L;
    private static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    private static String cookie(String token){return "__Host-lc_session="+token;}
    private static AccountApi.Session session(String token){return new AccountApi.Session(token,"991","Declared fixture",NOW+604800000L,NOW);}
    public static void main(String[] args){
        Jar immediate=new Jar(cookie(OLD),false);boolean[] accepted={true};AccountCookieCommit cancelled=new AccountCookieCommit(session(A),immediate);
        cancelled.apply(value->accepted[0]=value);check(immediate.current().equals(cookie(A)),"Setter may mutate the cookie before its callback");cancelled.cancel();
        check(immediate.current().equals(cookie(OLD)),"Cancel immediately restores its own staged cookie before a delayed callback");immediate.drain();
        check(!accepted[0]&&immediate.current().equals(cookie(OLD)),"A delayed accepted callback cannot complete or resurrect a cancelled account");
        Jar deferred=new Jar(cookie(OLD),true);boolean[] late={true};AccountCookieCommit beforeMutation=new AccountCookieCommit(session(A),deferred);beforeMutation.apply(value->late[0]=value);beforeMutation.cancel();deferred.drain();
        check(!late[0]&&deferred.current().equals(cookie(OLD)),"Cancel before native mutation also rolls back when the late setter eventually runs");
        Jar failure=new Jar(cookie(OLD),false);boolean[] staged={false};AccountCookieCommit verifyFailed=new AccountCookieCommit(session(A),failure);verifyFailed.apply(value->staged[0]=value);failure.drain();check(staged[0],"A staged cookie remains provisional after the setter callback");verifyFailed.cancel();failure.drain();
        check(failure.current().equals(cookie(OLD))&&failure.flushes>0,"Cookie verification failure restores and flushes the previous own session");
        Jar newer=new Jar(cookie(OLD),false);AccountCookieCommit oldFlow=new AccountCookieCommit(session(A),newer);oldFlow.apply(value->{});AccountCookieCommit newFlow=new AccountCookieCommit(session(B),newer);newFlow.apply(value->{});newer.drain();
        check(newFlow.commit(),"A newer owning transaction can commit its checked cookie");oldFlow.cancel();newer.drain();
        check(newer.current().equals(cookie(B)),"Old cancellation/delayed callbacks never erase a newer committed account");newFlow.cancel();check(newer.current().equals(cookie(B)),"Disposing a completed login preserves its committed session");
        Jar external=new Jar(cookie(OLD),false);AccountCookieCommit stale=new AccountCookieCommit(session(A),external);stale.apply(value->{});external.drain();external.value=cookie(B);stale.cancel();external.drain();
        check(external.current().equals(cookie(B)),"Rollback checks the actual cookie value, even if another writer changed it outside this transaction");
        Jar chain=new Jar(cookie(OLD),false);AccountCookieCommit first=new AccountCookieCommit(session(A),chain);first.apply(value->{});AccountCookieCommit second=new AccountCookieCommit(session(B),chain);second.apply(value->{});first.cancel();second.cancel();chain.drain();
        check(chain.current().equals(cookie(OLD)),"Cancelling chained provisional logins restores the original account rather than resurrecting another uncommitted login");
        Jar empty=new Jar("",false);AccountCookieCommit noPrevious=new AccountCookieCommit(session(A),empty);noPrevious.apply(value->{});noPrevious.cancel();empty.drain();check(empty.current().isEmpty(),"Cancel with no previous session deletes only the staged host cookie");
        System.out.println("Account cookie ownership/rollback: "+checks+" behavior checks passed");
    }
    private static final class Jar implements AccountCookieCommit.Jar {
        String value;final boolean delayedMutation;int flushes;final ArrayDeque<Write> queue=new ArrayDeque<>();
        Jar(String value,boolean delayedMutation){this.value=value;this.delayedMutation=delayedMutation;}
        @Override public String current(){return value;}
        @Override public void set(String header,AccountCookieCommit.Callback callback){String next=header.contains("Max-Age=0")?"":header.substring(0,header.indexOf(';'));if(!delayedMutation)value=next;queue.add(new Write(next,callback));}
        @Override public void flush(){flushes++;}
        void drain(){int bounded=0;while(!queue.isEmpty()){if(++bounded>20)throw new AssertionError("Rollback callback loop");Write write=queue.remove();if(delayedMutation)value=write.value;write.callback.done(true);}}
        private static final class Write{final String value;final AccountCookieCommit.Callback callback;Write(String value,AccountCookieCommit.Callback callback){this.value=value;this.callback=callback;}}
    }
}
