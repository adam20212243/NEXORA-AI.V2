import { KNOWLEDGE_SECTIONS, PERSONALITY_STYLES } from '../../src/shared/constants.ts';
import { SUPPORTED_APPS } from '../../src/shared/supportedApps.ts';
import type {
  AIProviderId,
  AppLanguage,
  AppSettings,
  AttachedDocumentInput,
  ChatSourceWeb,
  DataAnalysisSummary,
  DeviceControlCommand,
  KnowledgeRecord,
  KnowledgeSectionId,
  MasterResponsePayload,
  PersonalityStyleId,
  ReferenceImageItem,
  ToolExecutionTrace,
} from '../../src/shared/types.ts';
import { getAppSettings, recordActivityLog } from '../db/database.ts';
import { searchKnowledgeRecords } from '../knowledge/repository.ts';
import {
  generateWithProviders,
  generateWithProvidersStream,
  ProviderError,
} from '../providers/manager.ts';
import { runExternalSearch, searchReferenceImages } from '../search/externalSearch.ts';
import { runMatchedTools } from '../tools/registry.ts';

const SECTION_KEYWORDS: Record<KnowledgeSectionId, string[]> = {
  science: [
    'فيزياء', 'كيمياء', 'رياضيات', 'أحياء', 'فلك', 'طاقة', 'بيئة', 'ذرة', 'نسبية', 'نيوتن',
    'جاذبية', 'بناء ضوئي', 'فيثاغورس', 'قوة', 'حركة', 'ضوء', 'كوكب', 'شمس', 'مجرة', 'مغناطيس', 'كهرباء',
    'physics', 'chemistry', 'math', 'biology', 'astronomy', 'earth', 'energy', 'quantum',
    'relativity', 'atom', 'molecule', 'theorem', 'gravity', 'newton', 'force', 'light', 'planet',
  ],
  programming: [
    'برمجة', 'كود', 'تطبيق', 'موقع', 'أندرويد', 'لعبة', 'ألعاب', 'قاعدة بيانات', 'شبكة', 'أمن',
    'ذكاء اصطناعي', 'جافاسكريبت', 'بايثون', 'تايب سكريبت', 'خوارزمية', 'سيرفر', 'واجهة',
    'code', 'programming', 'typescript', 'javascript', 'python', 'c++', 'android', 'unity',
    'unreal', 'godot', 'database', 'sql', 'sqlite', 'network', 'ai', 'cybersecurity', 'bug', 'error', 'react', 'vite', 'express',
  ],
  medicine: [
    'طب', 'مرض', 'أمراض', 'دواء', 'أدوية', 'مناعة', 'قلب', 'دم', 'تحليل', 'تغذية',
    'فيتامين', 'أعراض', 'علاج', 'صحة', 'صداع', 'ضغط', 'سكري', 'جرعة', 'جراحة', 'عدوى', 'فيروس', 'بكتيريا', 'مضاد',
    'medicine', 'medical', 'disease', 'drug', 'pharmacology', 'immune', 'heart', 'blood',
    'cbc', 'nutrition', 'anatomy', 'physiology', 'symptom', 'diagnosis', 'health', 'doctor', 'pain', 'fever', 'insulin',
  ],
  history_culture: [
    'تاريخ', 'حضارة', 'جغرافيا', 'دولة', 'مدينة', 'لغة', 'ثقافة', 'اكتشاف', 'نيل', 'بغداد',
    'مصر', 'حرب', 'قديم', 'عباسي', 'رافدين', 'قرن', 'إمبراطورية', 'عالم', 'مخترع', 'مؤسس', 'قارة', 'عاصمة',
    'history', 'civilization', 'geography', 'country', 'city', 'culture', 'language', 'ancient',
    'modern', 'discovery', 'empire', 'war', 'century', 'capital', 'founded', 'invented', 'discovered',
  ],
  logic_creativity: [
    'منطق', 'استدلال', 'تفكير', 'تحليل', 'إبداع', 'ابتكار', 'خطة', 'تخطيط', 'قرار',
    'حل مشكلة', 'كتابة', 'سيناريو', 'انحياز', 'مبادئ أولى', 'المنهج العلمي', 'منهج علمي', 'تفكير علمي',
    'logic', 'reasoning', 'critical', 'thinking', 'problem', 'creativity', 'innovation',
    'planning', 'decision', 'writing', 'scenario', 'fallacy', 'bias', 'scientific method',
  ],
};

export function detectLanguage(text: string, fallback: AppLanguage = 'ar'): AppLanguage {
  const arMatches = text.match(/[\u0600-\u06FF]/g)?.length ?? 0;
  const enMatches = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (arMatches > enMatches) return 'ar';
  if (enMatches > arMatches) return 'en';
  return fallback;
}

export function classifySections(query: string): KnowledgeSectionId[] {
  const lower = query.toLowerCase();
  const scores: Array<{ id: KnowledgeSectionId; score: number }> = [];

  for (const section of KNOWLEDGE_SECTIONS) {
    const terms = SECTION_KEYWORDS[section.id];
    let score = 0;
    for (const term of terms) {
      if (lower.includes(term.toLowerCase())) {
        score += 1;
      }
    }
    if (score > 0) {
      scores.push({ id: section.id, score });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  if (scores.length > 0) {
    return scores.slice(0, 3).map((s) => s.id);
  }
  // Never default general/unclassified questions into 'medicine'
  return ['science', 'history_culture', 'logic_creativity'];
}

function classifyQuestionDomain(
  query: string,
  sections: KnowledgeSectionId[],
  attachments?: AttachedDocumentInput[]
): MasterResponsePayload['questionDomain'] {
  if (attachments?.some((a) => a.mimeType.startsWith('image/'))) return 'image_analysis';
  if (attachments && attachments.length > 0) return 'file_operation';
  if (/https:\/\/[^\s]+|ابحث|search|latest|news/i.test(query)) return 'web_search';
  if (/[0-9]\s*[+\-*/%]\s*[0-9]|احسب|معادلة|calculate|solve/i.test(query)) return 'math';
  const primary = sections[0];
  if (primary === 'medicine') return 'medicine';
  if (primary === 'programming') return 'programming';
  if (primary === 'history_culture') return 'history_geography';
  if (primary === 'science') return 'science';
  if (primary === 'logic_creativity') return 'thinking_creative';
  return 'general';
}

export function detectDeviceControlCommand(
  query: string,
  platform: DeviceControlCommand['targetPlatform'] = 'web'
): DeviceControlCommand | null {
  const trimmed = query.trim();

  // Check file deletion / cleanup / close app commands (ALWAYS require confirmation)
  const closeMatch = trimmed.match(/^(?:أغلق|اغلق|قفل|اقفل|close|quit|kill)\s+(?:تطبيق\s+|برنامج\s+)?(.+)$/i);
  if (closeMatch?.[1]) {
    const cleanTarget = closeMatch[1].replace(/[.!?؟]+$/, '').trim();
    const matched = SUPPORTED_APPS.find((app) =>
      app.aliases.some((alias) => cleanTarget.toLowerCase().includes(alias.toLowerCase()))
    );
    return {
      detected: true,
      action: 'close_app',
      rawQuery: trimmed,
      extractedAppName: cleanTarget,
      matchedAppId: matched?.id ?? null,
      matchedAppLabel: matched?.labelAr ?? cleanTarget,
      targetPlatform: platform,
      supportedOnCurrentPlatform: platform === 'windows' && Boolean(matched),
      requiresConfirmation: true,
      autoLaunchRecommended: false,
      launchUri: null,
      androidPackage: matched?.androidPackage ?? null,
      androidIntentUri: null,
      windowsProtocol: null,
      messageAr:
        platform === 'windows' && matched
          ? `إغلاق "${matched.labelAr}" يتطلب تأكيدك الصريح أولًا عبر جسر سطح المكتب المحلي.`
          : `إغلاق التطبيقات الخارجية غير مسموح من متصفح الويب مباشرة (على Android يمكنك إدارته من معلومات التطبيق).`,
      messageEn:
        platform === 'windows' && matched
          ? `Closing "${matched.labelEn}" requires your explicit confirmation via the local desktop bridge.`
          : `Closing external apps directly is blocked in a browser sandbox (on Android, manage via App Info).`,
    };
  }

  const deleteFileMatch = trimmed.match(/^(?:احذف ملف|حذف ملف|delete file|remove file)\s+([^\s]+)$/i);
  if (deleteFileMatch?.[1]) {
    const targetPath = deleteFileMatch[1].replace(/^["']|["']$/g, '');
    return {
      detected: true,
      action: 'file_action',
      rawQuery: trimmed,
      extractedAppName: targetPath,
      matchedAppId: null,
      matchedAppLabel: targetPath,
      targetPlatform: platform,
      supportedOnCurrentPlatform: true,
      requiresConfirmation: true,
      autoLaunchRecommended: false,
      launchUri: null,
      androidPackage: null,
      androidIntentUri: null,
      windowsProtocol: null,
      pendingFileAction: {
        operation: 'delete',
        targetPath,
      },
      messageAr: `تأكيد مطلوب: هل تريد حذف الملف "${targetPath}" من مساحة العمل؟ لن يتم الحذف إلا بعد تأكيدك.`,
      messageEn: `Confirmation required: Delete workspace file "${targetPath}"? Nothing has been deleted yet.`,
    };
  }

  const arOpenMatch = trimmed.match(
    /^(?:افتح|شغّل|شغل|فتح)\s+(?:لي\s+)?(?:التطبيق\s+الذي\s+اسمه\s+|البرنامج\s+الذي\s+اسمه\s+|تطبيق\s+|برنامج\s+)?(.+)$/i
  );
  const enOpenMatch = trimmed.match(
    /^(?:open|launch|start)\s+(?:the\s+)?(?:app\s+named\s+|app\s+called\s+|app\s+)?(.+)$/i
  );

  const rawTarget = (arOpenMatch?.[1] ?? enOpenMatch?.[1])?.trim();
  if (!rawTarget) return null;

  // Avoid hijacking "افتح ملف ..." or "open file ..." as an app launch
  if (/^(?:ملف|مجلد|file|folder)\b/i.test(rawTarget)) {
    return null;
  }

  const cleanTarget = rawTarget
    .replace(/^(?:ال)?(?:برنامج|تطبيق)\s+/i, '')
    .replace(/[.!?؟]+$/, '')
    .trim();

  const lowerTarget = cleanTarget.toLowerCase();
  const matched = SUPPORTED_APPS.find((app) =>
    app.aliases.some(
      (alias) => lowerTarget === alias.toLowerCase() || lowerTarget.includes(alias.toLowerCase())
    )
  );

  if (!matched) {
    return {
      detected: true,
      action: 'open_app',
      rawQuery: trimmed,
      extractedAppName: cleanTarget,
      matchedAppId: null,
      matchedAppLabel: null,
      targetPlatform: platform,
      supportedOnCurrentPlatform: false,
      requiresConfirmation: false,
      autoLaunchRecommended: false,
      launchUri: null,
      androidPackage: null,
      androidIntentUri: null,
      windowsProtocol: null,
      messageAr: `التطبيق "${cleanTarget}" غير مثبت أو غير مدرج ضمن التطبيقات المتاحة للتشغيل على هذه المنصة.`,
      messageEn: `"${cleanTarget}" is not installed or is not in the supported applications catalog for this platform.`,
    };
  }

  let launchUri: string | null = null;
  let supported = false;

  if (platform === 'android') {
    launchUri = matched.androidIntentUri ?? matched.webFallbackUrl ?? null;
    supported = Boolean(matched.androidPackage || launchUri);
  } else if (platform === 'windows') {
    launchUri = matched.windowsProtocol ?? matched.webFallbackUrl ?? null;
    supported = Boolean(launchUri);
  } else if (platform === 'macos') {
    launchUri = matched.macosScheme ?? matched.webFallbackUrl ?? null;
    supported = Boolean(launchUri);
  } else {
    launchUri = matched.webFallbackUrl ?? matched.windowsProtocol ?? null;
    supported = Boolean(launchUri);
  }

  const needsConfirm = matched.sensitive;
  const autoLaunch = supported && !needsConfirm;

  return {
    detected: true,
    action: matched.category === 'system' ? 'system_setting' : 'open_app',
    rawQuery: trimmed,
    extractedAppName: cleanTarget,
    matchedAppId: matched.id,
    matchedAppLabel: matched.labelAr,
    targetPlatform: platform,
    supportedOnCurrentPlatform: supported,
    requiresConfirmation: needsConfirm,
    autoLaunchRecommended: autoLaunch,
    launchUri,
    androidPackage: matched.androidPackage ?? null,
    androidIntentUri: matched.androidIntentUri ?? null,
    windowsProtocol: matched.windowsProtocol ?? null,
    messageAr: !supported
      ? `التطبيق "${matched.labelAr}" غير متاح للتشغيل المباشر على منصة ${platform} من بيئة الويب.`
      : needsConfirm
      ? `يتطلب فتح "${matched.labelAr}" تأكيدك لأن هذا الإجراء يمس صلاحية حساسة بالجهاز.`
      : `جاري فتح "${matched.labelAr}" (${matched.labelEn})...`,
    messageEn: !supported
      ? `"${matched.labelEn}" cannot be launched directly from a web sandbox on ${platform}.`
      : needsConfirm
      ? `Opening "${matched.labelEn}" requires confirmation because it accesses a sensitive device capability.`
      : `Launching "${matched.labelEn}"...`,
  };
}

function filterRelevantKbRecords(query: string, records: KnowledgeRecord[]): KnowledgeRecord[] {
  if (records.length === 0) return [];
  const meaningfulTokens = query
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter(
      (t) =>
        t.length >= 3 &&
        ![
          'من', 'في', 'على', 'إلى', 'عن', 'هو', 'هي', 'ما', 'ماذا', 'متى', 'كيف', 'لماذا', 'هل',
          'the', 'who', 'what', 'when', 'where', 'why', 'how', 'is', 'are', 'was', 'and', 'for',
        ].includes(t)
    );

  if (meaningfulTokens.length === 0) return records;

  return records.filter((rec) => {
    const haystack = `${rec.title} ${rec.subcategory} ${rec.keywords.join(' ')} ${rec.simple_explanation}`.toLowerCase();
    return meaningfulTokens.some((tok) => haystack.includes(tok));
  });
}

function formatApiErrorResponse(
  err: ProviderError,
  lang: AppLanguage,
  hasImages: boolean
): string {
  if (lang === 'ar') {
    if (err.code === 'QUOTA_EXCEEDED') {
      return hasImages
        ? 'تعذر تحليل الصورة حاليًا بسبب تجاوز حد الطلبات / الحصة في خدمة Gemini API (HTTP 429). يرجى الانتظار قليلًا ثم إعادة المحاولة أو مراجعة الحصة في إعدادات المفاتيح.'
        : 'تعذر إتمام الطلب حاليًا بسبب تجاوز حد الطلبات / انتهاء الحصة المؤقتة في خدمة الذكاء الاصطناعي (HTTP 429). يرجى الانتظار قليلًا ثم المحاولة مجددًا.';
    }
    if (err.code === 'NOT_CONFIGURED' || err.code === 'INVALID_KEY') {
      return hasImages
        ? 'تعذر تحليل الصورة لأن مفتاح خدمة الذكاء الاصطناعي (GEMINI_API_KEY) غير مضبوط أو غير صالح على الخادم.'
        : 'مفتاح الذكاء الاصطناعي السحابي غير مهيأ أو غير صالح حاليًا على الخادم (تحقق من متغير البيئة GEMINI_API_KEY).';
    }
    if (err.code === 'VISION_UNSUPPORTED') {
      return err.message;
    }
    return `حدث تعذر مؤقت أثناء الاتصال بمزود الذكاء الاصطناعي: ${err.message}`;
  }

  if (err.code === 'QUOTA_EXCEEDED') {
    return hasImages
      ? 'Image analysis failed: Gemini API quota/rate limit exceeded (HTTP 429). Please retry shortly or check your billing quota.'
      : 'AI request paused due to API rate/quota limit (HTTP 429 RESOURCE_EXHAUSTED). Please retry shortly.';
  }
  if (err.code === 'NOT_CONFIGURED' || err.code === 'INVALID_KEY') {
    return 'Server AI API key (GEMINI_API_KEY) is missing or invalid in server configuration.';
  }
  return err.message;
}

function buildOfflineMasterSynthesis(
  query: string,
  lang: AppLanguage,
  style: PersonalityStyleId,
  kbRecords: KnowledgeRecord[],
  webResults: ChatSourceWeb[],
  toolTraces: ToolExecutionTrace[],
  toolContext: string,
  includeMedicalDisclaimer: boolean,
  providerErr: ProviderError | Error | unknown,
  hasImages: boolean
): string {
  const lines: string[] = [];

  // Never pretend an image was analyzed if the vision provider failed
  if (hasImages) {
    const pErr = providerErr instanceof ProviderError ? providerErr : null;
    if (pErr) {
      return formatApiErrorResponse(pErr, lang, true);
    }
    return lang === 'ar'
      ? `تعذر تحليل الصورة المرفقة حاليًا لأن خدمة الرؤية البصرية غير متاحة (${providerErr instanceof Error ? providerErr.message : 'خطأ اتصال'}).`
      : `Unable to analyze the attached image because the vision provider is unavailable (${providerErr instanceof Error ? providerErr.message : 'Connection error'}).`;
  }

  const mathTrace = toolTraces.find((t) => t.toolId === 'solve_math' && t.summary.includes('='));
  const taskTrace = toolTraces.find((t) => t.toolId === 'task_planner' && t.summary.startsWith('Saved task:'));
  const fileMgrTrace = toolTraces.find((t) => t.toolId === 'file_manager' && t.success);
  const webBrowseTrace = toolTraces.find((t) => t.toolId === 'web_browse' && t.success);

  if (lang === 'ar') {
    if (mathTrace) {
      lines.push(`النتيجة الحسابية الدقيقة: **${mathTrace.summary}**`);
    }
    if (taskTrace) {
      lines.push(`تم حفظ المهمة بنجاح: **${taskTrace.summary.replace('Saved task: ', '')}**`);
    }
    if (fileMgrTrace && toolContext.includes('[Tool:')) {
      lines.push(toolContext.replace(/\[Tool:[^\]]+\]\s*/g, '').trim());
    }
    if (webBrowseTrace && toolContext.includes('[Tool: Live Web Page Content')) {
      lines.push(toolContext.replace(/\[Tool:[^\]]+\]\s*/g, '').slice(0, 1200));
    }

    if (kbRecords.length > 0) {
      lines.push('');
      for (const rec of kbRecords.slice(0, 2)) {
        const body = style === 'simple' ? rec.simple_explanation : rec.detailed_content;
        lines.push(`**${rec.title}**\n${body}`);
      }
    } else if (webResults.length > 0) {
      lines.push(`**ملخص نتائج البحث الحقيقية عن "${query}":**`);
      for (const w of webResults.slice(0, 3)) {
        lines.push(`- ${w.title} (${w.sourceName})`);
      }
    } else if (!mathTrace && !taskTrace && !fileMgrTrace && !webBrowseTrace) {
      if (providerErr instanceof ProviderError) {
        lines.push(formatApiErrorResponse(providerErr, 'ar', false));
      } else {
        lines.push(
          `لم أتمكن من توليد إجابة عبر النموذج السحابي حاليًا (${providerErr instanceof Error ? providerErr.message : 'الخدمة غير متاحة'}).`
        );
      }
    }

    if (includeMedicalDisclaimer && kbRecords.length > 0) {
      lines.push(
        `\nتنبيه طبي: هذه المعلومات للتثقيف العلمي فقط ولا تُعد تشخيصًا شخصيًا أو وصفة علاجية؛ يُرجى مراجعة الطبيب المختص.`
      );
    }
  } else {
    if (mathTrace) {
      lines.push(`Exact Calculation Result: **${mathTrace.summary}**`);
    }
    if (taskTrace) {
      lines.push(`Task saved: **${taskTrace.summary.replace('Saved task: ', '')}**`);
    }
    if (fileMgrTrace && toolContext.includes('[Tool:')) {
      lines.push(toolContext.replace(/\[Tool:[^\]]+\]\s*/g, '').trim());
    }
    if (webBrowseTrace && toolContext.includes('[Tool: Live Web Page Content')) {
      lines.push(toolContext.replace(/\[Tool:[^\]]+\]\s*/g, '').slice(0, 1200));
    }

    if (kbRecords.length > 0) {
      lines.push('');
      for (const rec of kbRecords.slice(0, 2)) {
        const body = style === 'simple' ? rec.simple_explanation : rec.detailed_content;
        lines.push(`**${rec.title}**\n${body}`);
      }
    } else if (webResults.length > 0) {
      lines.push(`**Live Search Summary for "${query}":**`);
      for (const w of webResults.slice(0, 3)) {
        lines.push(`- ${w.title} (${w.sourceName})`);
      }
    } else if (!mathTrace && !taskTrace && !fileMgrTrace && !webBrowseTrace) {
      if (providerErr instanceof ProviderError) {
        lines.push(formatApiErrorResponse(providerErr, 'en', false));
      } else {
        lines.push(
          `Unable to reach cloud AI synthesis right now (${providerErr instanceof Error ? providerErr.message : 'Service unavailable'}).`
        );
      }
    }

    if (includeMedicalDisclaimer && kbRecords.length > 0) {
      lines.push(
        `\nMedical Notice: This information is strictly educational and does not substitute for consulting a licensed physician.`
      );
    }
  }

  return lines.join('\n').trim();
}

export interface RunMasterInput {
  query: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  attachments?: AttachedDocumentInput[];
  settingsOverride?: Partial<AppSettings>;
  platform?: DeviceControlCommand['targetPlatform'];
  incognito?: boolean;
}

function shouldFetchReferenceImages(query: string, domain: MasterResponsePayload['questionDomain']): boolean {
  if (/صورة|صور مرجعية|شكل|خريطة|معلم|جهاز|آلة|photo|image|picture|diagram|what does .* look like|show me/i.test(query)) {
    return true;
  }
  return domain === 'history_geography' || domain === 'science';
}

interface PreparedExecution {
  started: number;
  settings: AppSettings;
  lang: AppLanguage;
  styleId: PersonalityStyleId;
  hasImages: boolean;
  deviceCommand: DeviceControlCommand | null;
  questionDomain: MasterResponsePayload['questionDomain'];
  isMedical: boolean;
  kbRecords: KnowledgeRecord[];
  toolsOut: { traces: ToolExecutionTrace[]; combinedContext: string; dataAnalysis?: DataAnalysisSummary };
  webSources: ChatSourceWeb[];
  referenceImages: ReferenceImageItem[];
  externalSearchExecuted: boolean;
  externalSearchError: string | null;
  systemInstruction: string;
  compositePrompt: string;
}

async function prepareMasterExecution(input: RunMasterInput): Promise<PreparedExecution> {
  const started = Date.now();
  const settings = { ...getAppSettings(), ...input.settingsOverride };
  const lang = detectLanguage(input.query, settings.language);
  const styleId = settings.personalityStyle;
  const styleDef = PERSONALITY_STYLES.find((s) => s.id === styleId) ?? PERSONALITY_STYLES[1];
  const hasImages = Boolean(
    input.attachments?.some((a) => a.mimeType.startsWith('image/') && a.base64Data)
  );

  const deviceCommand = settings.enableDeviceControl
    ? detectDeviceControlCommand(input.query, input.platform ?? 'web')
    : null;

  if (deviceCommand) {
    return {
      started,
      settings,
      lang,
      styleId,
      hasImages,
      deviceCommand,
      questionDomain: 'device_control',
      isMedical: false,
      kbRecords: [],
      toolsOut: { traces: [], combinedContext: '' },
      webSources: [],
      referenceImages: [],
      externalSearchExecuted: false,
      externalSearchError: null,
      systemInstruction: '',
      compositePrompt: '',
    };
  }

  const selectedSections = classifySections(input.query);
  const questionDomain = classifyQuestionDomain(input.query, selectedSections, input.attachments);
  const explicitMedicalTerms =
    /طب|مرض|أمراض|دواء|أدوية|أعراض|تشخيص|علاج|صداع|ضغط|سكري|فيتامين|مناعة|مناعي|تحليل|قلب|دم|عدوى|جراحة|medicine|medical|disease|symptom|diagnosis|treatment|drug|vitamin|fever|pain|heart|blood|immune|cbc|insulin|doctor/i.test(
      input.query
    );
  const isMedical = explicitMedicalTerms && selectedSections.includes('medicine');

  const rawKbRecords =
    hasImages || questionDomain === 'web_search'
      ? []
      : searchKnowledgeRecords(input.query, selectedSections, 6);
  const kbRecords = filterRelevantKbRecords(input.query, rawKbRecords);

  const toolsOut = await runMatchedTools({
    query: input.query,
    attachments: input.attachments,
    memoryConsentGranted: settings.memoryConsentGranted && !input.incognito,
    incognito: input.incognito,
  });

  let webSources: ChatSourceWeb[] = [];
  let referenceImages: ReferenceImageItem[] = [];
  let externalSearchExecuted = false;
  let externalSearchError: string | null = null;
  let webSnippetsContext = '';

  const explicitWebSearchIntent =
    /اليوم|الآن|أحدث|2025|2026|ابحث|بحث على الإنترنت|search|latest|recent|today|news/i.test(
      input.query
    );
  const handledByDeterministicTool =
    hasImages ||
    (input.attachments?.length ?? 0) > 0 ||
    toolsOut.traces.some(
      (t) =>
        t.success &&
        ['solve_math', 'task_planner', 'remember_preference', 'analyze_document', 'file_manager', 'web_browse'].includes(
          t.toolId
        )
    );

  const needsExternalSearch =
    settings.enableExternalSearch &&
    (explicitWebSearchIntent || (!handledByDeterministicTool && kbRecords.length === 0 && input.query.trim().length > 4));

  const wantsRefImages =
    settings.enableReferenceImages &&
    !hasImages &&
    shouldFetchReferenceImages(input.query, questionDomain);

  const [searchReportSettled, refImagesSettled] = await Promise.allSettled([
    needsExternalSearch ? runExternalSearch(input.query, lang === 'ar') : Promise.resolve(null),
    wantsRefImages ? searchReferenceImages(input.query, lang === 'ar') : Promise.resolve([]),
  ]);

  if (searchReportSettled.status === 'fulfilled' && searchReportSettled.value) {
    const searchReport = searchReportSettled.value;
    externalSearchExecuted = searchReport.executed;
    externalSearchError = searchReport.error;
    webSources = searchReport.results.map((r) => ({
      title: r.title,
      url: r.url,
      sourceName: r.sourceName,
      publishedAt: r.publishedAt,
      reliabilityScore: r.reliabilityScore,
    }));
    if (searchReport.results.length > 0) {
      webSnippetsContext = searchReport.results
        .map(
          (r, idx) =>
            `[WEB-${idx + 1}] ${r.title} (${r.sourceName}, date=${r.publishedAt ?? 'unknown'}): ${r.snippet} | URL: ${r.url}`
        )
        .join('\n');
    }
  }

  if (refImagesSettled.status === 'fulfilled' && Array.isArray(refImagesSettled.value)) {
    referenceImages = refImagesSettled.value;
  }

  const silentKbContext =
    kbRecords.length > 0
      ? kbRecords
          .map(
            (r) =>
              `Reference Fact (${r.title}): ${r.detailed_content}\nScope/Limits: ${r.usage_limits}`
          )
          .join('\n\n')
      : '';

  const systemInstruction = `You are NEXORA MASTER, the unified intelligent assistant of NEXORA AI.

CORE ACCURACY, DOMAIN & CONCISENESS RULES:
1. Classify the user's question domain first (current estimated domain: ${questionDomain}). NEVER give medical advice, medical disclaimers, or off-topic content for history, science, general knowledge, math, or programming questions.
2. Be accurate, direct, and concise. Answer what the user asked without unnecessary filler or repetition.
3. If you do not know an answer or have no reliable facts, say so clearly instead of inventing details.
4. When images are attached, inspect the image directly: describe what is visible, perform accurate OCR on any text inside the image, and answer the user's specific question about it.
5. NEVER mention internal databases, SQLite, tables, "5 sections", "20,000 records", or internal storage architecture to the user.
6. Only include medical educational disclaimers if the user genuinely asked a medical/health question.
7. Language: Respond in ${lang === 'ar' ? 'Arabic (العربية الواضحة والمباشرة)' : 'English'}.
8. Style (${styleDef.nameEn} / ${styleDef.nameAr}): ${styleDef.instruction}`;

  const compositePrompt = `User Request: ${input.query}

${silentKbContext ? `--- VERIFIED BACKGROUND REFERENCE ---\n${silentKbContext}\n` : ''}
${toolsOut.combinedContext ? `--- TOOL OUTPUTS & CONTEXT ---\n${toolsOut.combinedContext}\n` : ''}
${webSnippetsContext ? `--- EXTERNAL WEB SEARCH RESULTS ---\n${webSnippetsContext}\n` : ''}

Give one clear, direct, factual response.`;

  return {
    started,
    settings,
    lang,
    styleId,
    hasImages,
    deviceCommand: null,
    questionDomain,
    isMedical,
    kbRecords,
    toolsOut,
    webSources,
    referenceImages,
    externalSearchExecuted,
    externalSearchError,
    systemInstruction,
    compositePrompt,
  };
}

function buildDeviceCommandPayload(prep: PreparedExecution, rawQuery: string, incognito?: boolean): MasterResponsePayload {
  const deviceCommand = prep.deviceCommand!;
  const answer = prep.lang === 'ar' ? deviceCommand.messageAr : deviceCommand.messageEn;
  if (!incognito) {
    recordActivityLog({
      category: 'command',
      action: deviceCommand.action,
      target: deviceCommand.matchedAppLabel ?? deviceCommand.extractedAppName ?? rawQuery,
      tool_id: deviceCommand.action === 'file_action' ? 'file_manager' : 'app_launcher',
      status: deviceCommand.requiresConfirmation
        ? 'pending_confirmation'
        : deviceCommand.supportedOnCurrentPlatform
        ? 'success'
        : 'failed',
      detail: answer,
    });
  }

  return {
    answer,
    language: prep.lang,
    personalityStyle: prep.styleId,
    providerUsed: 'kb_offline_synthesis',
    modelUsed: 'device-control-parser',
    questionDomain: 'device_control',
    toolsExecuted: [
      {
        toolId: deviceCommand.action === 'file_action' ? 'file_manager' : 'app_launcher',
        toolNameAr: deviceCommand.action === 'file_action' ? 'إدارة الملفات' : 'التحكم بالتطبيقات',
        toolNameEn: deviceCommand.action === 'file_action' ? 'File Manager' : 'App Controller',
        success: deviceCommand.supportedOnCurrentPlatform,
        summary: deviceCommand.matchedAppLabel ?? deviceCommand.extractedAppName ?? 'Device command',
      },
    ],
    webSources: [],
    referenceImages: [],
    uncertaintyLevel: 'low',
    medicalDisclaimerIncluded: false,
    deviceCommand,
    externalSearchExecuted: false,
    externalSearchError: null,
    processingMs: Date.now() - prep.started,
    internalUsedKbCount: 0,
  };
}

export async function runNexoraMaster(input: RunMasterInput): Promise<MasterResponsePayload> {
  const prep = await prepareMasterExecution(input);
  if (prep.deviceCommand) {
    return buildDeviceCommandPayload(prep, input.query, input.incognito);
  }

  let answer = '';
  let providerUsed: AIProviderId | 'kb_offline_synthesis' | 'error' = prep.settings.activeProvider;
  let modelUsed = prep.settings.activeModel;
  let apiErrorCode: MasterResponsePayload['apiErrorCode'];

  try {
    const genResult = await generateWithProviders({
      provider: prep.settings.activeProvider,
      model: prep.settings.activeModel,
      systemInstruction: prep.systemInstruction,
      prompt: prep.compositePrompt,
      history: input.history,
      attachments: input.attachments,
      enableFallback: prep.settings.enableProviderFallback,
    });
    answer = genResult.text;
    providerUsed = genResult.providerUsed;
    modelUsed = genResult.modelUsed;

    if (!input.incognito) {
      recordActivityLog({
        category: 'ai',
        action: prep.hasImages ? 'image_analysis' : 'chat_completion',
        target: input.query.slice(0, 120),
        tool_id: prep.hasImages ? 'image_vision' : null,
        status: 'success',
        detail: `Answered via ${providerUsed} (${modelUsed})`,
      });
    }
  } catch (err) {
    if (err instanceof ProviderError) {
      apiErrorCode = err.code;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    providerUsed = prep.hasImages ? 'error' : 'kb_offline_synthesis';
    modelUsed = prep.hasImages ? 'vision-unavailable' : 'local-synthesis';
    answer = buildOfflineMasterSynthesis(
      input.query,
      prep.lang,
      prep.styleId,
      prep.kbRecords,
      prep.webSources,
      prep.toolsOut.traces,
      prep.toolsOut.combinedContext,
      prep.isMedical,
      err,
      prep.hasImages
    );

    if (!input.incognito) {
      recordActivityLog({
        category: 'ai',
        action: prep.hasImages ? 'image_analysis' : 'chat_completion',
        target: input.query.slice(0, 120),
        tool_id: prep.hasImages ? 'image_vision' : null,
        status: 'failed',
        detail: errMsg,
      });
    }
  }

  let uncertaintyLevel: MasterResponsePayload['uncertaintyLevel'] = 'low';
  if (apiErrorCode) {
    uncertaintyLevel = 'high';
  } else if (prep.kbRecords.length === 0 && prep.webSources.length === 0 && prep.toolsOut.traces.length === 0) {
    uncertaintyLevel = providerUsed === 'kb_offline_synthesis' ? 'high' : 'low';
  } else if (prep.kbRecords.length > 0 && prep.kbRecords.every((r) => r.review_status !== 'verified')) {
    uncertaintyLevel = 'medium';
  }

  return {
    answer,
    language: prep.lang,
    personalityStyle: prep.styleId,
    providerUsed,
    modelUsed,
    questionDomain: prep.questionDomain,
    apiErrorCode,
    toolsExecuted: prep.toolsOut.traces,
    webSources: prep.webSources,
    referenceImages: prep.referenceImages,
    dataAnalysis: prep.toolsOut.dataAnalysis,
    uncertaintyLevel,
    medicalDisclaimerIncluded: prep.isMedical,
    deviceCommand: null,
    externalSearchExecuted: prep.externalSearchExecuted,
    externalSearchError: prep.externalSearchError,
    processingMs: Date.now() - prep.started,
    internalUsedKbCount: prep.kbRecords.length,
  };
}

export async function streamNexoraMaster(
  input: RunMasterInput,
  handlers: {
    onToken: (chunk: string) => void;
    signal?: AbortSignal;
  }
): Promise<MasterResponsePayload> {
  const prep = await prepareMasterExecution(input);
  if (prep.deviceCommand) {
    const payload = buildDeviceCommandPayload(prep, input.query, input.incognito);
    handlers.onToken(payload.answer);
    return payload;
  }

  let answer = '';
  let providerUsed: AIProviderId | 'kb_offline_synthesis' | 'error' = prep.settings.activeProvider;
  let modelUsed = prep.settings.activeModel;
  let apiErrorCode: MasterResponsePayload['apiErrorCode'];

  try {
    const res = await generateWithProvidersStream(
      {
        provider: prep.settings.activeProvider,
        model: prep.settings.activeModel,
        systemInstruction: prep.systemInstruction,
        prompt: prep.compositePrompt,
        history: input.history,
        attachments: input.attachments,
        enableFallback: prep.settings.enableProviderFallback,
      },
      handlers
    );
    answer = res.text;
    providerUsed = res.providerUsed;
    modelUsed = res.modelUsed;
  } catch (err) {
    if (err instanceof ProviderError) apiErrorCode = err.code;
    providerUsed = prep.hasImages ? 'error' : 'kb_offline_synthesis';
    modelUsed = prep.hasImages ? 'vision-unavailable' : 'local-synthesis';
    answer = buildOfflineMasterSynthesis(
      input.query,
      prep.lang,
      prep.styleId,
      prep.kbRecords,
      prep.webSources,
      prep.toolsOut.traces,
      prep.toolsOut.combinedContext,
      prep.isMedical,
      err,
      prep.hasImages
    );
    handlers.onToken(answer);
  }

  return {
    answer,
    language: prep.lang,
    personalityStyle: prep.styleId,
    providerUsed,
    modelUsed,
    questionDomain: prep.questionDomain,
    apiErrorCode,
    toolsExecuted: prep.toolsOut.traces,
    webSources: prep.webSources,
    referenceImages: prep.referenceImages,
    dataAnalysis: prep.toolsOut.dataAnalysis,
    uncertaintyLevel: apiErrorCode ? 'high' : 'low',
    medicalDisclaimerIncluded: prep.isMedical,
    deviceCommand: null,
    externalSearchExecuted: prep.externalSearchExecuted,
    externalSearchError: prep.externalSearchError,
    processingMs: Date.now() - prep.started,
    internalUsedKbCount: prep.kbRecords.length,
  };
}

export const NEXORA_MASTER_BRAIN = {
  run: runNexoraMaster,
  stream: streamNexoraMaster,
  classifySections,
  detectDeviceControlCommand,
  detectLanguage,
};

