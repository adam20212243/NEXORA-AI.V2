-keepattributes JavascriptInterface
-keepclassmembers class com.nexora.ai.bridge.NexoraBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.nexora.ai.assistant.** { *; }
