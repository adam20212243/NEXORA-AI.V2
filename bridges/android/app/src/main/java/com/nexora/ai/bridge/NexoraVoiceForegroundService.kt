package com.nexora.ai.bridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.app.NotificationCompat

class NexoraVoiceForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "nexora_voice_assistant"
        const val NOTIFICATION_ID = 48920
        const val ACTION_START = "com.nexora.ai.ACTION_START_VOICE_ASSISTANT"
        const val ACTION_STOP = "com.nexora.ai.ACTION_STOP_VOICE_ASSISTANT"

        @Volatile
        var isRunning: Boolean = false
            private set

        private val wakePhrases = listOf(
            "هاي مساعد",
            "يا مساعد",
            "مرحبا نيكسورا",
            "يا nexora",
            "hey assistant",
            "hey nexora",
            "nexora"
        )
    }

    private var recognizer: SpeechRecognizer? = null
    private var activeLang: String = "ar-SA"

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopVoicePipeline()
                isRunning = false
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START, null -> {
                createChannel()
                val notification = buildPersistentNotification()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                    )
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
                isRunning = true
                startWakeWordLoop()
                return START_STICKY
            }
            else -> return START_STICKY
        }
    }

    private fun startWakeWordLoop() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return
        recognizer?.destroy()
        val sr = SpeechRecognizer.createSpeechRecognizer(this)
        recognizer = sr
        sr.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}

            override fun onError(error: Int) {
                if (isRunning) restartRecognizer()
            }

            override fun onResults(results: Bundle?) {
                val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val spoken = matches?.firstOrNull()?.lowercase()?.trim().orEmpty()
                val wakeMatched = wakePhrases.any { spoken.contains(it.lowercase()) }
                if (wakeMatched) {
                    val broadcast = Intent("com.nexora.ai.WAKE_WORD_TRIGGERED").apply {
                        putExtra("transcript", spoken)
                        setPackage(packageName)
                    }
                    sendBroadcast(broadcast)
                }
                if (isRunning) restartRecognizer()
            }

            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        restartRecognizer()
    }

    private fun restartRecognizer() {
        val sr = recognizer ?: return
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, activeLang)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        }
        sr.startListening(intent)
    }

    private fun stopVoicePipeline() {
        recognizer?.cancel()
        recognizer?.destroy()
        recognizer = null
    }

    override fun onDestroy() {
        stopVoicePipeline()
        isRunning = false
        super.onDestroy()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val ch = NotificationChannel(
                CHANNEL_ID,
                "NEXORA Voice Assistant",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Persistent microphone indicator for hands-free NEXORA voice wake word."
            }
            nm.createNotificationChannel(ch)
        }
    }

    private fun buildPersistentNotification(): Notification {
        val stopIntent = Intent(this, NexoraVoiceForegroundService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPending = PendingIntent.getService(
            this,
            1,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NEXORA Voice Assistant")
            .setContentText("الاستماع الصوتي النشط عبر الميكروفون · اضغط إيقاف لإنهاء الخدمة")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "إيقاف", stopPending)
            .build()
    }
}
