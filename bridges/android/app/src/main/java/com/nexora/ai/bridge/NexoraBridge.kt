package com.nexora.ai.bridge

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import java.util.Locale

/**
 * NEXORA AI Native Android WebView Bridge
 * Connects the web UI with Android Intents, TextToSpeech, Storage Access Framework (SAF),
 * and the persistent Microphone ForegroundService for NEXORA Voice Assistant.
 */
class NexoraBridge(
    private val context: Context,
    private val tts: TextToSpeech,
    private val isForegroundServiceRunning: () -> Boolean,
    private val onRequestSafPicker: (() -> Unit)? = null
) {
    private val allowedPackages = setOf(
        "com.google.android.youtube",
        "com.android.chrome",
        "com.google.android.googlequicksearchbox",
        "com.whatsapp",
        "org.telegram.messenger",
        "com.google.android.gm",
        "com.google.android.apps.maps",
        "com.spotify.music",
        "com.google.android.calculator",
        "com.android.settings",
        "com.github.android",
        "com.google.android.calendar",
        "com.android.camera",
        "com.microsoft.office.excel",
        "com.microsoft.office.word",
        "com.microsoft.office.powerpoint",
        "com.google.android.keep",
        "com.google.android.documentsui"
    )

    @JavascriptInterface
    fun isAppInstalled(packageName: String): Boolean {
        if (!allowedPackages.contains(packageName)) return false
        return try {
            context.packageManager.getLaunchIntentForPackage(packageName) != null
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun launchApp(packageName: String, intentUri: String): Boolean {
        if (!allowedPackages.contains(packageName)) {
            return false
        }
        return try {
            if (packageName == "com.android.settings") {
                return openSystemSettingsSection("main")
            }
            val pm = context.packageManager
            val launchIntent = pm.getLaunchIntentForPackage(packageName)
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(launchIntent)
                true
            } else if (intentUri.isNotBlank()) {
                val uriIntent = Intent(Intent.ACTION_VIEW, Uri.parse(intentUri))
                uriIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(uriIntent)
                true
            } else {
                false
            }
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun openPlayStoreOrDownload(packageName: String, appName: String): Boolean {
        return try {
            val marketUri = if (packageName.isNotBlank()) {
                Uri.parse("market://details?id=$packageName")
            } else {
                Uri.parse("market://search?q=${Uri.encode(appName)}")
            }
            val intent = Intent(Intent.ACTION_VIEW, marketUri).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            true
        } catch (_: Exception) {
            try {
                val webUri = if (packageName.isNotBlank()) {
                    Uri.parse("https://play.google.com/store/apps/details?id=$packageName")
                } else {
                    Uri.parse("https://play.google.com/store/search?q=${Uri.encode(appName)}&c=apps")
                }
                val webIntent = Intent(Intent.ACTION_VIEW, webUri).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(webIntent)
                true
            } catch (_: Exception) {
                false
            }
        }
    }

    @JavascriptInterface
    fun openDefaultAssistantSettings(): Boolean {
        return try {
            val intent = Intent(Settings.ACTION_VOICE_INPUT_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            true
        } catch (_: Exception) {
            openSystemSettingsSection("apps")
        }
    }

    @JavascriptInterface
    fun openSystemSettingsSection(section: String): Boolean {
        return try {
            val action = when (section) {
                "microphone" -> Settings.ACTION_APPLICATION_DETAILS_SETTINGS
                "apps" -> Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS
                "assistant" -> Settings.ACTION_VOICE_INPUT_SETTINGS
                else -> Settings.ACTION_SETTINGS
            }
            val intent = if (action == Settings.ACTION_APPLICATION_DETAILS_SETTINGS) {
                Intent(action, Uri.fromParts("package", context.packageName, null))
            } else {
                Intent(action)
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun openSafDocumentPicker(): Boolean {
        return try {
            onRequestSafPicker?.invoke()
            onRequestSafPicker != null
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun startBackgroundVoiceService(): Boolean {
        return try {
            val serviceIntent = Intent(context, NexoraVoiceForegroundService::class.java).apply {
                action = NexoraVoiceForegroundService.ACTION_START
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun stopBackgroundVoiceService(): Boolean {
        return try {
            val serviceIntent = Intent(context, NexoraVoiceForegroundService::class.java).apply {
                action = NexoraVoiceForegroundService.ACTION_STOP
            }
            context.startService(serviceIntent)
            true
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun speakText(text: String, langTag: String, rate: Float): Boolean {
        return try {
            val locale = Locale.forLanguageTag(langTag)
            tts.language = locale
            tts.setSpeechRate(rate.coerceIn(0.5f, 2.0f))
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "nexora_utterance")
            true
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun stopSpeaking() {
        tts.stop()
    }

    @JavascriptInterface
    fun isBackgroundServiceActive(): Boolean = isForegroundServiceRunning()
}
