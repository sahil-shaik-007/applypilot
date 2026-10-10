package com.applypilot.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Patterns;

import com.getcapacitor.BridgeActivity;

import java.util.regex.Matcher;

/**
 * ApplyPilot main activity.
 *
 * "Share to ApplyPilot" bridge: Android delivers shared links (e.g. a job from the LinkedIn or
 * Naukri app) as ACTION_SEND with EXTRA_TEXT. Capacitor's App plugin only forwards ACTION_VIEW
 * intents to JS, so we rewrite ACTION_SEND into an ACTION_VIEW deep link:
 *
 *   applypilot://share?url=<first http(s) URL in the text>&text=<full shared text>&subject=<subject>
 *
 * The web layer receives it through the standard Capacitor App APIs:
 *   - cold start:  App.getLaunchUrl()          -> { url: 'applypilot://share?...' }
 *   - warm start:  App.addListener('appUrlOpen', e => e.url)
 * so src/native share.onIncoming() only needs to parse that URL. No extra native plugin.
 */
public class MainActivity extends BridgeActivity {

    static final String SHARE_DEEP_LINK = "applypilot://share";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        Intent rewritten = rewriteShareIntent(getIntent());
        if (rewritten != null) setIntent(rewritten);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        Intent rewritten = rewriteShareIntent(intent);
        super.onNewIntent(rewritten != null ? rewritten : intent);
    }

    /** Returns an ACTION_VIEW applypilot://share intent for a text/plain ACTION_SEND, else null. */
    static Intent rewriteShareIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return null;
        String type = intent.getType();
        if (type == null || !type.startsWith("text/")) return null;

        CharSequence textCs = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String text = textCs == null ? "" : textCs.toString();
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (text.isEmpty() && (subject == null || subject.isEmpty())) return null;

        // Cap sizes so a huge share can't produce an unbounded URL.
        if (text.length() > 4000) text = text.substring(0, 4000);
        if (subject != null && subject.length() > 500) subject = subject.substring(0, 500);

        String firstUrl = null;
        Matcher m = Patterns.WEB_URL.matcher(text);
        while (m.find()) {
            String candidate = m.group();
            if (candidate.startsWith("https://") || candidate.startsWith("http://")) {
                firstUrl = candidate;
                break;
            }
        }

        Uri.Builder b = Uri.parse(SHARE_DEEP_LINK).buildUpon();
        if (firstUrl != null) b.appendQueryParameter("url", firstUrl);
        if (!text.isEmpty()) b.appendQueryParameter("text", text);
        if (subject != null && !subject.isEmpty()) b.appendQueryParameter("subject", subject);

        Intent view = new Intent(Intent.ACTION_VIEW, b.build());
        view.setPackage(intent.getPackage());
        view.setFlags(intent.getFlags());
        return view;
    }
}
