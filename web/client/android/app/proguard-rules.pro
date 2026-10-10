# ApplyPilot R8 / ProGuard rules (release builds: minifyEnabled + shrinkResources).
# Capacitor core and @capgo/capacitor-social-login ship consumer rules; the rules below cover
# the plugins that do not, and anything reached only via reflection / JNI / JS bridges.

# Keep readable stack traces for Play Console crash reports (upload mapping.txt with each release).
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile

# --- Capacitor core + every plugin (resolved by annotation / reflection) ---
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep class com.capacitorjs.plugins.** { *; }
-dontwarn com.getcapacitor.**

# --- Any @JavascriptInterface (Capacitor bridge, @capgo/inappbrowser messaging) ---
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# --- @capacitor/background-runner (JS engine via JNI from android-js-engine-release.aar) ---
-keep class io.ionic.backgroundrunner.** { *; }
-keep class io.ionic.android_js_engine.** { *; }
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}
# WorkManager workers are instantiated by class name.
-keep class * extends androidx.work.ListenableWorker { <init>(...); }

# --- @capgo/inappbrowser (WebView dialog + JS bridge) ---
-keep class ee.forgr.capacitor_inappbrowser.** { *; }

# --- @capgo/capacitor-native-biometric (Keystore / BiometricPrompt) ---
-keep class ee.forgr.biometric.** { *; }
-keep class androidx.biometric.** { *; }

# --- @capgo/capacitor-social-login (Google Credential Manager) ---
-keep class ee.forgr.capacitor.social.login.** { *; }
-keep class androidx.credentials.** { *; }
-keep class com.google.android.libraries.identity.googleid.** { *; }
-dontwarn com.facebook.**
-dontwarn com.google.android.gms.**

# --- Push notifications (Firebase Messaging service is referenced from the manifest) ---
-keep class com.capacitorjs.plugins.pushnotifications.** { *; }
-dontwarn com.google.firebase.**

# --- Misc libraries pulled in by plugins ---
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn javax.annotation.**
-dontwarn kotlin.**

# --- App ---
-keep class com.applypilot.app.MainActivity { *; }
