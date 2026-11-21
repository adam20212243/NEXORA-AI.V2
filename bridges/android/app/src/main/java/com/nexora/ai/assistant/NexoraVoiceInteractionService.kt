package com.nexora.ai.assistant

import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService

/**
 * NEXORA AI Default Digital Assistant Service.
 * Once the user installs the APK and chooses NEXORA AI under:
 * Settings -> Apps -> Default apps -> Digital assistant app,
 * long-pressing the Power button or corner swipe invokes NEXORA AI.
 */
class NexoraVoiceInteractionService : VoiceInteractionService() {
    override fun onReady() {
        super.onReady()
    }
}

class NexoraVoiceInteractionSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession {
        return NexoraVoiceInteractionSession(this)
    }
}
