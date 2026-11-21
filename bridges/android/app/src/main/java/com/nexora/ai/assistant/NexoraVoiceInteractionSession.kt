package com.nexora.ai.assistant

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.view.LayoutInflater
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Overlay session shown when user triggers the Digital Assistant via Power button or Assist gesture.
 * Launches NEXORA AI WebView activity directly into voice listening mode without fabricating system actions.
 */
class NexoraVoiceInteractionSession(private val ctx: Context) : VoiceInteractionSession(ctx) {

    override fun onCreateContentView(): View {
        val container = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
            setBackgroundColor(0xEE0F172A.toInt())
        }

        val title = TextView(ctx).apply {
            text = "NEXORA AI"
            textSize = 20f
            setTextColor(0xFFFFFFFF.toInt())
        }

        val subtitle = TextView(ctx).apply {
            text = "اضغط لفتح NEXORA والبدء بالاستماع الصوتي"
            textSize = 14f
            setTextColor(0xFFCBD5E1.toInt())
            setPadding(0, 12, 0, 24)
        }

        val launchBtn = Button(ctx).apply {
            text = "بدء الاستماع في NEXORA"
            setOnClickListener {
                val launchIntent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    putExtra("nexora_trigger_voice", true)
                }
                if (launchIntent != null) {
                    startAssistantActivity(launchIntent)
                }
                finish()
            }
        }

        container.addView(title)
        container.addView(subtitle)
        container.addView(launchBtn)
        return container
    }

    override fun onHandleAssist(state: AssistState) {
        super.onHandleAssist(state)
    }

    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
    }
}
