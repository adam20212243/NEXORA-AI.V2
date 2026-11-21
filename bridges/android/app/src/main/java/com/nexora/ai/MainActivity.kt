package com.nexora.ai

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.nexora.ai.bridge.NexoraBridge
import com.nexora.ai.bridge.NexoraVoiceForegroundService
import java.util.Locale

class MainActivity : AppCompatActivity(), TextToSpeech.OnInitListener {

    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var webView: WebView
    private lateinit var offlineOverlay: LinearLayout
    private lateinit var tts: TextToSpeech

    private var pendingPermissionRequest: PermissionRequest? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var triggerVoiceAfterLoad: Boolean = false

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val audioGranted = grants[Manifest.permission.RECORD_AUDIO] == true ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val req = pendingPermissionRequest
        pendingPermissionRequest = null
        if (req != null) {
            if (audioGranted) {
                req.grant(req.resources)
            } else {
                req.deny()
            }
        }
    }

    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        fileChooserCallback?.onReceiveValue(uris.toTypedArray())
        fileChooserCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        tts = TextToSpeech(this, this)
        triggerVoiceAfterLoad = intent?.getBooleanExtra("nexora_trigger_voice", false) == true ||
            intent?.action == Intent.ACTION_ASSIST ||
            intent?.action == Intent.ACTION_VOICE_COMMAND

        val root = FrameLayout(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        swipeRefresh = SwipeRefreshLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        offlineOverlay = buildOfflineOverlay()
        offlineOverlay.visibility = View.GONE

        swipeRefresh.addView(webView)
        root.addView(swipeRefresh)
        root.addView(offlineOverlay)
        setContentView(root)

        configureWebView()

        swipeRefresh.setOnRefreshListener {
            offlineOverlay.visibility = View.GONE
            webView.reload()
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        requestInitialRuntimePermissions()
        val targetUrl = resolveServerUrl()
        if (targetUrl.isNotEmpty()) {
            webView.loadUrl(targetUrl)
        } else {
            offlineOverlay.visibility = View.VISIBLE
        }
    }

    private fun resolveServerUrl(): String {
        val baked = BuildConfig.NEXORA_APP_URL.trim().trimEnd('/')
        if (baked.startsWith("https://") || baked.startsWith("http://")) {
            return baked
        }
        val saved = getSharedPreferences("nexora_prefs", MODE_PRIVATE)
            .getString("server_url", "")
            ?.trim()
            ?.trimEnd('/')
            .orEmpty()
        return if (saved.startsWith("https://") || saved.startsWith("http://")) saved else ""
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val shouldTriggerVoice = intent.getBooleanExtra("nexora_trigger_voice", false) ||
            intent.action == Intent.ACTION_ASSIST ||
            intent.action == Intent.ACTION_VOICE_COMMAND
        if (shouldTriggerVoice) {
            dispatchVoiceTriggerToWeb()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val bridge = NexoraBridge(
            context = this,
            tts = tts,
            isForegroundServiceRunning = { NexoraVoiceForegroundService.isRunning },
            onRequestSafPicker = {
                runOnUiThread {
                    fileChooserCallback?.onReceiveValue(emptyArray())
                    fileChooserCallback = null
                    filePickerLauncher.launch(arrayOf("*/*"))
                }
            }
        )

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString NexoraAndroidApp/${BuildConfig.VERSION_NAME}"
        }

        webView.addJavascriptInterface(bridge, "NexoraAndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val uri = request?.url ?: return false
                val scheme = uri.scheme?.lowercase().orEmpty()
                val allowedHost = Uri.parse(resolveServerUrl()).host.orEmpty()
                if (scheme == "http" || scheme == "https") {
                    if (allowedHost.isNotEmpty() && uri.host == allowedHost) {
                        return false
                    }
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                        true
                    } catch (_: Exception) {
                        false
                    }
                }
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    true
                } catch (_: Exception) {
                    true
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                swipeRefresh.isRefreshing = false
                offlineOverlay.visibility = View.GONE
                if (triggerVoiceAfterLoad) {
                    triggerVoiceAfterLoad = false
                    dispatchVoiceTriggerToWeb()
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    swipeRefresh.isRefreshing = false
                    offlineOverlay.visibility = View.VISIBLE
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                runOnUiThread {
                    val needsAudio = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                    if (needsAudio && ContextCompat.checkSelfPermission(
                            this@MainActivity,
                            Manifest.permission.RECORD_AUDIO
                        ) != PackageManager.PERMISSION_GRANTED
                    ) {
                        pendingPermissionRequest?.deny()
                        pendingPermissionRequest = request
                        permissionLauncher.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
                    } else {
                        request.grant(request.resources)
                    }
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileChooserCallback?.onReceiveValue(emptyArray())
                fileChooserCallback = filePathCallback
                val mimeTypes = fileChooserParams?.acceptTypes
                    ?.filter { it.isNotBlank() }
                    ?.toTypedArray()
                filePickerLauncher.launch(
                    if (mimeTypes != null && mimeTypes.isNotEmpty()) mimeTypes else arrayOf("*/*")
                )
                return true
            }
        }
    }

    private fun dispatchVoiceTriggerToWeb() {
        webView.post {
            webView.evaluateJavascript(
                "(function(){window.dispatchEvent(new CustomEvent('nexora-android-voice-trigger'));var btn=document.querySelector('[data-nexora-mic-btn]');if(btn){btn.click();}})();",
                null
            )
        }
    }

    private fun requestInitialRuntimePermissions() {
        val toRequest = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            toRequest.add(Manifest.permission.RECORD_AUDIO)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            toRequest.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (toRequest.isNotEmpty()) {
            permissionLauncher.launch(toRequest.toTypedArray())
        }
    }

    private fun buildOfflineOverlay(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(64, 64, 64, 64)
            setBackgroundColor(0xFF0F172A.toInt())

            val title = TextView(this@MainActivity).apply {
                text = "الاتصال بخادم NEXORA AI العام"
                textSize = 18f
                setTextColor(0xFFFFFFFF.toInt())
                gravity = Gravity.CENTER
            }

            val currentTarget = resolveServerUrl()
            val detail = TextView(this@MainActivity).apply {
                text = if (currentTarget.isNotEmpty()) {
                    "تعذر تحميل الخادم. تحقق من اتصال الإنترنت ثم أعد المحاولة:\n$currentTarget"
                } else {
                    "أدخل رابط الاستضافة العام لتطبيق NEXORA AI (HTTPS):"
                }
                textSize = 13f
                setTextColor(0xFF94A3B8.toInt())
                gravity = Gravity.CENTER
                setPadding(0, 16, 0, 24)
            }

            val urlInput = EditText(this@MainActivity).apply {
                hint = "https://your-nexora-domain.com"
                setText(currentTarget)
                setTextColor(0xFFFFFFFF.toInt())
                setHintTextColor(0xFF64748B.toInt())
                setBackgroundColor(0xFF1E293B.toInt())
                setPadding(32, 24, 32, 24)
            }

            val retryBtn = Button(this@MainActivity).apply {
                text = if (currentTarget.isNotEmpty()) "إعادة المحاولة / فتح الرابط" else "حفظ وفتح NEXORA"
                setOnClickListener {
                    val entered = urlInput.text.toString().trim().trimEnd('/')
                    val finalUrl = if (entered.startsWith("https://") || entered.startsWith("http://")) {
                        getSharedPreferences("nexora_prefs", MODE_PRIVATE)
                            .edit()
                            .putString("server_url", entered)
                            .apply()
                        entered
                    } else {
                        resolveServerUrl()
                    }
                    if (finalUrl.isNotEmpty()) {
                        visibility = View.GONE
                        webView.loadUrl(finalUrl)
                    }
                }
            }

            addView(title)
            addView(detail)
            addView(urlInput)
            addView(retryBtn)
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts.language = Locale.forLanguageTag("ar-SA")
        }
    }

    override fun onDestroy() {
        tts.stop()
        tts.shutdown()
        webView.destroy()
        super.onDestroy()
    }
}
