# NEXORA AI — Android APK Build, GitHub Release & Auto-Download Setup

## 1. Real Android Gradle Project
`/bridges/android` is a complete Android Studio Gradle module (`com.nexora.ai`, `minSdk 24`, `targetSdk 35`) wrapping the live NEXORA AI web server (`React + Vite + TypeScript + Express`) with native Android capabilities:
- `app/src/main/java/com/nexora/ai/MainActivity.kt`: Secure HTTPS WebView (`BuildConfig.NEXORA_APP_URL`), runtime microphone/notification permissions, SAF document upload chooser, and Power-button voice trigger dispatch.
- `app/src/main/java/com/nexora/ai/bridge/NexoraBridge.kt`: `@JavascriptInterface` connecting WebView UI with `PackageManager` (`isAppInstalled`, `launchApp`, `openPlayStoreOrDownload`), `openDefaultAssistantSettings`, TTS, and `NexoraVoiceForegroundService`.
- `app/src/main/java/com/nexora/ai/bridge/NexoraVoiceForegroundService.kt`: Foreground microphone service with explicit persistent notification.
- `app/src/main/java/com/nexora/ai/assistant/NexoraVoiceInteractionService.kt` & `NexoraVoiceInteractionSession.kt`: Android Digital Assistant binding for Power-button long press.

## 2. Why APK is Built via GitHub Actions or Android Studio
AI Studio runs Node.js without Java JDK, Android SDK, or Gradle installed, so the `.apk` binary is compiled cleanly on GitHub Actions (`/.github/workflows/android-release.yml`) or locally in Android Studio. **No server secrets (`GEMINI_API_KEY`, etc.) are ever included in the APK or GitHub workflow.**

## 3. Automated GitHub Release Publishing & Auto-Updating Download Link
1. Create a public GitHub repository and push this codebase to `main`.
2. (Optional) In GitHub **Settings -> Secrets and variables -> Actions**:
   - **Variables** -> `NEXORA_WEB_URL`: your live public HTTPS NEXORA server URL (for example, your Abasthan deployment URL `https://your-nexora-app.example.com`). If omitted at build time, the app prompts for the server URL on first launch instead of pointing to a private dev/preview URL.
   - **Secrets** (recommended for persistent update signing): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
3. Create and push a version tag to trigger build + release automatically:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
   GitHub Actions builds the signed APK and publishes both `nexora-ai-v1.0.0.apk` and `nexora-ai-latest.apk` to **GitHub Releases**.
4. In your NEXORA server environment variables, configure ONE of:
   - **`NEXORA_GITHUB_REPO=your-username/your-repo`** (Recommended — automatically resolves the latest published `.apk` asset, version tag, and size via GitHub Releases API on every new release!)
   - OR **`NEXORA_APK_RELEASE_URL=https://github.com/your-username/your-repo/releases/latest/download/nexora-ai-latest.apk`** (verified live via HTTP `HEAD` before showing the button).

## 4. Assigning NEXORA AI to the Power Button (Android)
After installing the APK:
1. Open **Settings -> Apps -> Default apps -> Digital assistant app** (or tap **فتح إعدادات المساعد الافتراضي** inside NEXORA).
2. Select **NEXORA AI**.
3. On Android 12+, enable **Settings -> System -> Gestures -> Press & hold power button -> Digital assistant**.
