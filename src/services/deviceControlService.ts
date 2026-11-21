import type { DeviceControlCommand } from '../shared/types.ts';

const WINDOWS_BRIDGE_URL = 'http://127.0.0.1:48920';

export function detectClientPlatform(): DeviceControlCommand['targetPlatform'] {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'ios';
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return 'web';
}

export function isSafeLaunchUri(uri: string): boolean {
  const lower = uri.trim().toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return false;
  }
  return true;
}

export interface DeviceLaunchResult {
  executed: boolean;
  method:
    | 'android_bridge'
    | 'windows_bridge'
    | 'external_link'
    | 'protocol_handler'
    | 'blocked';
  canFallbackDownload?: boolean;
  fallbackPackage?: string;
  fallbackAppName?: string;
  messageAr: string;
  messageEn: string;
}

export async function checkLocalWindowsBridgeStatus(): Promise<{
  connected: boolean;
  allowlisted: string[];
}> {
  if (typeof fetch === 'undefined') {
    return { connected: false, allowlisted: [] };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const res = await fetch(`${WINDOWS_BRIDGE_URL}/health`, { signal: controller.signal });
    if (!res.ok) return { connected: false, allowlisted: [] };
    const data = (await res.json()) as { ok?: boolean; allowlisted?: string[] };
    return {
      connected: Boolean(data.ok),
      allowlisted: Array.isArray(data.allowlisted) ? data.allowlisted : [],
    };
  } catch {
    return { connected: false, allowlisted: [] };
  } finally {
    clearTimeout(timer);
  }
}

export async function executeConfirmedDeviceCommand(
  cmd: DeviceControlCommand,
  confirmed = false
): Promise<DeviceLaunchResult> {
  // Explicit handling for closing apps (requires explicit user confirmation and native bridge)
  if (cmd.action === 'close_app') {
    if (!confirmed) {
      return {
        executed: false,
        method: 'blocked',
        messageAr: 'يتطلب إغلاق أي تطبيق موافقتك وتأكيدك الصريح أولًا.',
        messageEn: 'Closing an application requires explicit user confirmation first.',
      };
    }

    if (cmd.targetPlatform === 'windows' && cmd.matchedAppId) {
      try {
        const res = await fetch(`${WINDOWS_BRIDGE_URL}/close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: cmd.matchedAppId, confirmed: true }),
        });
        const data = (await res.json().catch(() => ({}))) as { closed?: boolean; error?: string };
        if (res.ok && data.closed) {
          return {
            executed: true,
            method: 'windows_bridge',
            messageAr: `تم إغلاق ${cmd.matchedAppLabel ?? cmd.matchedAppId} عبر جسر Windows المحلي.`,
            messageEn: `Closed ${cmd.matchedAppLabel ?? cmd.matchedAppId} via local Windows bridge.`,
          };
        }
        return {
          executed: false,
          method: 'blocked',
          messageAr:
            data.error ||
            'تعذر إغلاق التطبيق. تأكد أن التطبيق ضمن القائمة الموثوقة في جسر Windows المحلي.',
          messageEn:
            data.error ||
            'Could not close application. Verify it is in the local Windows bridge allowlist.',
        };
      } catch {
        return {
          executed: false,
          method: 'blocked',
          messageAr:
            'جسر Windows المحلي غير متصل (127.0.0.1:48920). لا يستطيع المتصفح وحده إغلاق برامج النظام.',
          messageEn:
            'Local Windows bridge (127.0.0.1:48920) is not running. Browsers cannot terminate OS apps alone.',
        };
      }
    }

    return {
      executed: false,
      method: 'blocked',
      messageAr:
        cmd.targetPlatform === 'android'
          ? 'لا يسمح نظام Android للمتصفح أو التطبيقات العادية بإغلاق تطبيقات أخرى إجباريًا بدون تفعيل خدمة الوصول (Accessibility) في تطبيق NEXORA الأصلي.'
          : 'لا يسمح المتصفح بإغلاق تطبيقات النظام الخارجية مباشرةً لأسباب أمنية.',
      messageEn:
        cmd.targetPlatform === 'android'
          ? 'Android restricts force-closing third-party apps without explicit Accessibility consent in the native APK.'
          : 'Browsers cannot force-close external OS applications directly for security reasons.',
    };
  }

  if (!cmd.supportedOnCurrentPlatform || !cmd.launchUri) {
    return {
      executed: false,
      method: 'blocked',
      messageAr: cmd.messageAr,
      messageEn: cmd.messageEn,
    };
  }

  if (!isSafeLaunchUri(cmd.launchUri)) {
    return {
      executed: false,
      method: 'blocked',
      messageAr: 'تم حظر الرابط لأنه يستخدم مخططًا غير آمن.',
      messageEn: 'Blocked launch URI due to unsafe scheme.',
    };
  }

  // 1. Native Android WebView Bridge (when running inside Android APK wrapper)
  if (
    cmd.targetPlatform === 'android' &&
    window.NexoraAndroidBridge?.launchApp &&
    cmd.androidPackage
  ) {
    if (
      window.NexoraAndroidBridge.isAppInstalled &&
      !window.NexoraAndroidBridge.isAppInstalled(cmd.androidPackage)
    ) {
      return {
        executed: false,
        method: 'blocked',
        canFallbackDownload: true,
        fallbackPackage: cmd.androidPackage,
        fallbackAppName: cmd.matchedAppLabel ?? cmd.extractedAppName ?? cmd.androidPackage,
        messageAr: `التطبيق "${cmd.matchedAppLabel ?? cmd.extractedAppName}" (${cmd.androidPackage}) غير مثبت على جهازك حاليًا. يمكنك فتح متجر التطبيقات أو نسخته الرسمية على الويب.`,
        messageEn: `"${cmd.matchedAppLabel ?? cmd.extractedAppName}" (${cmd.androidPackage}) is not installed on this Android device. You can open its official store listing or web version.`,
      };
    }

    const launched = window.NexoraAndroidBridge.launchApp(
      cmd.androidPackage,
      cmd.androidIntentUri ?? cmd.launchUri
    );
    if (launched) {
      return {
        executed: true,
        method: 'android_bridge',
        messageAr: `تم تشغيل "${cmd.matchedAppLabel ?? cmd.extractedAppName}" بنجاح عبر نظام Android.`,
        messageEn: `Launched "${cmd.matchedAppLabel ?? cmd.extractedAppName}" via native Android bridge.`,
      };
    }

    return {
      executed: false,
      method: 'blocked',
      canFallbackDownload: true,
      fallbackPackage: cmd.androidPackage,
      fallbackAppName: cmd.matchedAppLabel ?? cmd.extractedAppName ?? cmd.androidPackage,
      messageAr: `تعذر فتح "${cmd.matchedAppLabel ?? cmd.extractedAppName}" على نظام Android. قد يكون غير مثبت أو محظورًا.`,
      messageEn: `Could not open "${cmd.matchedAppLabel ?? cmd.extractedAppName}" on Android. It may not be installed.`,
    };
  }

  // 2. Try Local Trusted Windows Companion Bridge first if running on Windows and bridge is active
  if (
    cmd.targetPlatform === 'windows' &&
    cmd.matchedAppId &&
    (!cmd.launchUri.startsWith('http://') && !cmd.launchUri.startsWith('https://'))
  ) {
    try {
      const bridgeRes = await fetch(`${WINDOWS_BRIDGE_URL}/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: cmd.matchedAppId, confirmed: true }),
      });
      if (bridgeRes.ok) {
        return {
          executed: true,
          method: 'windows_bridge',
          messageAr: `تم تشغيل ${cmd.matchedAppLabel ?? cmd.matchedAppId} مباشرة عبر جسر Windows المحلي.`,
          messageEn: `Launched ${cmd.matchedAppLabel ?? cmd.matchedAppId} via local Windows bridge.`,
        };
      }
    } catch {
      // Bridge offline—fall through cleanly to protocol/URI handler
    }
  }

  // 3. HTTPS Deep Link / Web App Launch
  if (cmd.launchUri.startsWith('https://') || cmd.launchUri.startsWith('http://')) {
    const anchor = document.createElement('a');
    anchor.href = cmd.launchUri;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return {
      executed: true,
      method: 'external_link',
      messageAr: `تم فتح ${cmd.matchedAppLabel ?? cmd.extractedAppName} عبر الرابط الآمن (${cmd.launchUri}).`,
      messageEn: `Opened ${cmd.matchedAppLabel ?? cmd.extractedAppName} via safe external link.`,
    };
  }

  // 4. OS Custom Protocol Handler (e.g., whatsapp://, spotify://, ms-settings:, calculator:, intent://)
  try {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = cmd.launchUri;
    document.body.appendChild(iframe);
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 1500);

    return {
      executed: true,
      method: 'protocol_handler',
      messageAr: `تم إرسال بروتوكول التشغيل (${cmd.launchUri}) إلى نظام التشغيل. إذا لم يظهر التطبيق، تأكد من تثبيته أو تشغيل الجسر المحلي.`,
      messageEn: `Dispatched OS protocol (${cmd.launchUri}). If the app does not appear, check installation or start the companion bridge.`,
    };
  } catch {
    return {
      executed: false,
      method: 'blocked',
      messageAr: 'منع المتصفح إطلاق البروتوكول المحلي تلقائيًا. استخدم الجسر المحلي الموثوق أو افتح التطبيق يدويًا.',
      messageEn: 'Browser blocked automatic local protocol launch. Use the local companion bridge or open manually.',
    };
  }
}

export async function openSystemSettingsSection(
  section: 'main' | 'microphone' | 'apps'
): Promise<DeviceLaunchResult> {
  const platform = detectClientPlatform();
  if (platform === 'android' && window.NexoraAndroidBridge?.openSystemSettingsSection) {
    const ok = window.NexoraAndroidBridge.openSystemSettingsSection(section);
    if (ok) {
      return {
        executed: true,
        method: 'android_bridge',
        messageAr: 'تم فتح صفحة إعدادات Android المطلوبة.',
        messageEn: 'Opened requested Android settings page.',
      };
    }
  }

  if (platform === 'windows') {
    const uriMap: Record<'main' | 'microphone' | 'apps', string> = {
      main: 'ms-settings:',
      microphone: 'ms-settings:privacy-microphone',
      apps: 'ms-settings:appsfeatures',
    };
    const cmd: DeviceControlCommand = {
      detected: true,
      action: 'system_setting',
      rawQuery: `open settings ${section}`,
      extractedAppName: section,
      matchedAppId: 'settings',
      matchedAppLabel: 'Windows Settings',
      targetPlatform: 'windows',
      supportedOnCurrentPlatform: true,
      requiresConfirmation: false,
      autoLaunchRecommended: true,
      launchUri: uriMap[section],
      androidPackage: null,
      androidIntentUri: null,
      windowsProtocol: uriMap[section],
      messageAr: '',
      messageEn: '',
    };
    return executeConfirmedDeviceCommand(cmd, true);
  }

  return {
    executed: false,
    method: 'blocked',
    messageAr: 'يمكن فتح إعدادات النظام مباشرة داخل Windows أو تطبيق Android الأصلي فقط.',
    messageEn: 'Direct OS settings deep-links are available on Windows or inside the native Android APK.',
  };
}

export function openAppDownloadFallback(cmd: DeviceControlCommand): DeviceLaunchResult {
  const pkg = cmd.androidPackage ?? '';
  const appName = cmd.matchedAppLabel ?? cmd.extractedAppName ?? pkg;
  if (pkg && window.NexoraAndroidBridge?.openPlayStoreOrDownload) {
    const ok = window.NexoraAndroidBridge.openPlayStoreOrDownload(pkg, appName);
    if (ok) {
      return {
        executed: true,
        method: 'android_bridge',
        messageAr: `تم فتح صفحة "${appName}" في متجر التطبيقات.`,
        messageEn: `Opened Store listing for "${appName}".`,
      };
    }
  }

  const fallbackUrl = pkg
    ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`
    : cmd.launchUri && (cmd.launchUri.startsWith('https://') || cmd.launchUri.startsWith('http://'))
    ? cmd.launchUri
    : '';

  if (fallbackUrl) {
    const anchor = document.createElement('a');
    anchor.href = fallbackUrl;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return {
      executed: true,
      method: 'external_link',
      messageAr: `تم فتح صفحة "${appName}" الرسمية (${fallbackUrl}).`,
      messageEn: `Opened official page for "${appName}".`,
    };
  }

  return {
    executed: false,
    method: 'blocked',
    messageAr: 'لا يتوفر رابط تنزيل رسمي لهذا التطبيق حاليًا.',
    messageEn: 'No official download link is available for this app.',
  };
}

export function openDefaultAssistantSettings(): DeviceLaunchResult {
  if (window.NexoraAndroidBridge?.openDefaultAssistantSettings) {
    const ok = window.NexoraAndroidBridge.openDefaultAssistantSettings();
    if (ok) {
      return {
        executed: true,
        method: 'android_bridge',
        messageAr: 'تم فتح إعدادات المساعد الرقمي الافتراضي في Android.',
        messageEn: 'Opened Android Default Digital Assistant settings.',
      };
    }
  }
  return {
    executed: false,
    method: 'blocked',
    messageAr:
      'يتطلب تعيين NEXORA AI كمساعد رقمي افتراضي (عند الضغط المطول على زر الباور أو الإيماءة) تشغيل التطبيق كحزمة Android APK أصلية ثم اختياره من إعدادات النظام.',
    messageEn:
      'Setting NEXORA AI as the Default Digital Assistant (power button / gesture trigger) requires installing the native Android APK and selecting it in Android Default Apps.',
  };
}
