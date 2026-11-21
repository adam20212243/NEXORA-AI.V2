import type {
  AIProviderId,
  AppSettings,
  KnowledgeSectionId,
  PersonalityStyleId,
} from './types.ts';

export const KNOWLEDGE_SECTION_TARGET = 4000;
export const KNOWLEDGE_TOTAL_TARGET = 20000;

export const WAKE_WORD_PHRASES = [
  'هاي مساعد',
  'اهلا مساعد',
  'أهلا مساعد',
  'افتح يا مساعد',
  'يا مساعد',
  'يا nexora',
  'يا نيكسورا',
  'يا نكسورا',
  'hey assistant',
  'hey nexora',
  'ok nexora',
  'open assistant',
];

export interface SectionDefinition {
  id: KnowledgeSectionId;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  subcategories: string[];
  targetCount: number;
}

export const KNOWLEDGE_SECTIONS: SectionDefinition[] = [
  {
    id: 'science',
    nameAr: 'العلوم والمعرفة العلمية',
    nameEn: 'Science & Scientific Knowledge',
    descriptionAr:
      'الفيزياء، الكيمياء، الرياضيات، الأحياء، علم الفلك، علوم الأرض، الطاقة، البيئة، والنظريات والتجارب العلمية.',
    descriptionEn:
      'Physics, Chemistry, Mathematics, Biology, Astronomy, Earth Sciences, Energy, Environment, and Scientific Theories.',
    subcategories: [
      'Physics',
      'Chemistry',
      'Mathematics',
      'Biology',
      'Astronomy',
      'Earth Sciences',
      'Energy',
      'Environment',
      'Natural Sciences',
      'Scientific Theories',
    ],
    targetCount: KNOWLEDGE_SECTION_TARGET,
  },
  {
    id: 'programming',
    nameAr: 'البرمجة والتكنولوجيا',
    nameEn: 'Programming & Technology',
    descriptionAr:
      'لغات البرمجة، تطوير المواقع وتطبيقات Android، محركات الألعاب، قواعد البيانات، الشبكات، أنظمة التشغيل، الذكاء الاصطناعي، والأمن السيبراني الدفاعي.',
    descriptionEn:
      'Programming Languages, Web & Android Dev, Game Engines (Unity/Unreal/Godot), Databases, Networks, OS, AI/ML, and Defensive Cybersecurity.',
    subcategories: [
      'Programming Languages',
      'Web Development',
      'Android Development',
      'Game Development',
      'Databases',
      'Computer Networks',
      'Operating Systems',
      'Artificial Intelligence',
      'Software Engineering',
      'Defensive Cybersecurity',
    ],
    targetCount: KNOWLEDGE_SECTION_TARGET,
  },
  {
    id: 'medicine',
    nameAr: 'الطب والعلوم الطبية',
    nameEn: 'Medicine & Medical Sciences',
    descriptionAr:
      'جسم الإنسان، التشريح، وظائف الأعضاء، الأمراض، المناعة، مبادئ عمل الأدوية، التحاليل الطبية، التغذية، الصحة العامة، والأبحاث الطبية التثقيفية.',
    descriptionEn:
      'Human Anatomy, Physiology, Diseases, Immunology, Pharmacology Principles, Medical Diagnostics, Nutrition, Public Health, and Medical Research.',
    subcategories: [
      'Human Anatomy',
      'Physiology',
      'Pathology & Diseases',
      'Immunology',
      'Pharmacology',
      'Medical Diagnostics',
      'Nutrition',
      'Public Health',
      'Medical Research',
      'Preventive Medicine',
    ],
    targetCount: KNOWLEDGE_SECTION_TARGET,
  },
  {
    id: 'history_culture',
    nameAr: 'التاريخ والجغرافيا والثقافات',
    nameEn: 'History, Geography & Cultures',
    descriptionAr:
      'التاريخ القديم والحديث، الحضارات، الجغرافيا، الدول والمدن، الثقافات، اللغات، الشخصيات التاريخية، الاكتشافات، والأحداث الموثوقة.',
    descriptionEn:
      'Ancient & Modern History, Civilizations, Geography, Countries & Cities, Cultures, Languages, Historical Figures, and Discoveries.',
    subcategories: [
      'Ancient History',
      'Modern History',
      'Civilizations',
      'Geography',
      'Countries & Cities',
      'Cultures',
      'Languages',
      'Historical Figures',
      'Discoveries',
      'Historical Events',
    ],
    targetCount: KNOWLEDGE_SECTION_TARGET,
  },
  {
    id: 'logic_creativity',
    nameAr: 'التفكير والمنطق والتحليل والإبداع',
    nameEn: 'Thinking, Logic, Analysis & Creativity',
    descriptionAr:
      'التفكير المنطقي، الاستدلال، التحليل النقدي، حل المشكلات، الابتكار، الإبداع، التخطيط، اتخاذ القرار، الكتابة، والتفكير العلمي.',
    descriptionEn:
      'Logical Reasoning, Inference, Critical Analysis, Problem Solving, Innovation, Creativity, Strategic Planning, Decision Making, and Writing.',
    subcategories: [
      'Formal Logic',
      'Inference & Deduction',
      'Critical Thinking',
      'Problem Solving',
      'Innovation',
      'Creative Thinking',
      'Strategic Planning',
      'Decision Theory',
      'Structured Writing',
      'Scientific Method',
    ],
    targetCount: KNOWLEDGE_SECTION_TARGET,
  },
];

export interface PersonalityStyleDefinition {
  id: PersonalityStyleId;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  instruction: string;
}

export const PERSONALITY_STYLES: PersonalityStyleDefinition[] = [
  {
    id: 'friendly',
    nameAr: 'ودود',
    nameEn: 'Friendly',
    descriptionAr: 'نبرة دافئة ومشجعة وواضحة مع الحفاظ الكامل على دقة الحقائق.',
    descriptionEn: 'Warm, welcoming, and supportive tone without altering factual accuracy.',
    instruction:
      'Adopt a warm, approachable, and encouraging tone while keeping every fact, citation, and safety disclaimer strictly accurate.',
  },
  {
    id: 'professional',
    nameAr: 'احترافي',
    nameEn: 'Professional',
    descriptionAr: 'صياغة عملية مركزة ومنظمة تناسب بيئات العمل والقرار.',
    descriptionEn: 'Executive, concise, structured phrasing suited for professional work.',
    instruction:
      'Adopt a polished, clear, executive, and well-structured professional tone. Prioritize clarity and actionable organization.',
  },
  {
    id: 'concise',
    nameAr: 'مختصر',
    nameEn: 'Concise',
    descriptionAr: 'إجابات مباشرة وموجزة للغاية دون حشو أو إطالة.',
    descriptionEn: 'Ultra-direct, crisp, high-signal responses without filler.',
    instruction:
      'Be maximally concise and direct. Deliver only the core verified facts, direct steps, or exact answer in minimal words without fluff.',
  },
  {
    id: 'simple',
    nameAr: 'مبسط',
    nameEn: 'Simplified',
    descriptionAr: 'شرح سهل الفهم بلغة واضحة وأمثلة قريبة دون تعقيد غير لازم.',
    descriptionEn: 'Plain-language explanations with intuitive analogies and minimal jargon.',
    instruction:
      'Explain concepts in simple, accessible language suitable for beginners, breaking down complex terms into clear everyday explanations without losing accuracy.',
  },
  {
    id: 'scientific',
    nameAr: 'علمي',
    nameEn: 'Scientific',
    descriptionAr: 'دقة منهجية، مصطلحات علمية مضبوطة، وإبراز حدود الدليل.',
    descriptionEn: 'Methodical precision, standard scientific terminology, and evidence boundaries.',
    instruction:
      'Use rigorous scientific terminology, precise definitions, and explicit notes on methodology, evidence strength, and limitations.',
  },
  {
    id: 'expert',
    nameAr: 'خبير',
    nameEn: 'Expert',
    descriptionAr: 'عمق تقني ومفاهيمي متقدم، مقارنة البدائل، وتنبيهات الحالات الحدية.',
    descriptionEn: 'Deep domain mastery, trade-off analysis, and edge-case nuance.',
    instruction:
      'Provide deep, practitioner-level technical and domain insight, covering trade-offs, edge cases, and subtle distinctions.',
  },
  {
    id: 'analytical',
    nameAr: 'تفكير عميق وتحليلي',
    nameEn: 'Deep Analytical',
    descriptionAr: 'تفكيك المشكلة إلى مقدمات ونتائج وفحص الفرضيات والتناقضات.',
    descriptionEn: 'First-principles breakdown, hypothesis testing, and contradiction checks.',
    instruction:
      'Analyze the question step by step from first principles, evaluate competing hypotheses, explicitly surface contradictions, and show clear reasoning chains.',
  },
  {
    id: 'creative',
    nameAr: 'إبداعي',
    nameEn: 'Creative',
    descriptionAr: 'طرح زوايا مبتكرة وروابط متعددة التخصصات مع بقاء الحقائق ثابتة.',
    descriptionEn: 'Original framing and cross-disciplinary synthesis grounded in verified facts.',
    instruction:
      'Present verified information with imaginative framing, fresh analogies, and cross-disciplinary connections while never inventing facts or sources.',
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'ar',
  theme: 'light',
  personalityStyle: 'professional',
  activeProvider: 'gemini',
  activeModel: 'gemini-4-hydrogen',
  enableExternalSearch: true,
  enableReferenceImages: true,
  enableProviderFallback: true,
  voiceSttLang: 'ar-SA',
  voiceInputDeviceId: '',
  voiceMicMode: 'record_send',
  voiceTtsEnabled: true,
  voiceTtsRate: 1.0,
  voiceTtsVolume: 1.0,
  voiceTtsVoiceName: '',
  autoSpeakResponses: false,
  autoSendVoiceTranscript: false,
  useServerTtsFallback: true,
  enableWakeWord: false,
  allowBackgroundTts: false,
  enableBackgroundVoiceAssistant: false,
  enableFloatingVoiceButton: true,
  enableFileManagerAccess: true,
  enableDeviceControl: true,
  confirmDestructiveActions: true,
  saveSearchHistory: true,
  saveActivityLog: true,
  enableNotifications: true,
  requireConfirmationForWebActions: true,
  memoryConsentGranted: false,
  ambientMusicEnabled: true,
  ambientMusicMuted: false,
  ambientMusicVolume: 0.16,
};

export const PROVIDER_CATALOG: Record<
  AIProviderId,
  {
    nameAr: string;
    nameEn: string;
    modelDefault: string;
    availableModels: string[];
    freeTierNotesAr: string;
    freeTierNotesEn: string;
    supportsSearchGrounding: boolean;
    supportsVision: boolean;
  }
> = {
  gemini: {
    nameAr: 'Google Gemini (الرئيسي)',
    nameEn: 'Google Gemini (Primary)',
    modelDefault: 'gemini-4-hydrogen',
    availableModels: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-4-neon'],
    freeTierNotesAr:
      'يدعم الفهم البصري للصور والـ PDF والبحث عبر Google في Gemini API؛ بعض النماذج المتقدمة تتطلب مفتاحًا مدفوعًا.',
    freeTierNotesEn:
      'Supports multimodal image/PDF understanding and Google Search Grounding; advanced reasoning models require a billing-enabled key.',
    supportsSearchGrounding: true,
    supportsVision: true,
  },
  openai: {
    nameAr: 'OpenAI',
    nameEn: 'OpenAI',
    modelDefault: 'gpt-4o-mini',
    availableModels: ['gpt-4o-mini', 'gpt-4o', 'o3-mini'],
    freeTierNotesAr:
      'يتطلب مفتاح OPENAI_API_KEY على الخادم ورصيد API نشطًا؛ يدعم gpt-4o تحليل الصور.',
    freeTierNotesEn:
      'Requires server-side OPENAI_API_KEY and active API billing credits; gpt-4o supports vision.',
    supportsSearchGrounding: false,
    supportsVision: true,
  },
  anthropic: {
    nameAr: 'Anthropic Claude',
    nameEn: 'Anthropic Claude',
    modelDefault: 'claude-3-5-haiku-latest',
    availableModels: ['claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest'],
    freeTierNotesAr:
      'يتطلب مفتاح ANTHROPIC_API_KEY على الخادم ورصيدًا مسبق الدفع عبر Anthropic Console.',
    freeTierNotesEn:
      'Requires server-side ANTHROPIC_API_KEY and prepaid Anthropic Console credits.',
    supportsSearchGrounding: false,
    supportsVision: true,
  },
  'openai-compatible': {
    nameAr: 'مزود متوافق مع OpenAI API',
    nameEn: 'OpenAI-Compatible Provider',
    modelDefault: 'llama-3.3-70b-versatile',
    availableModels: ['llama-3.3-70b-versatile', 'qwen-2.5-72b-instruct', 'custom'],
    freeTierNotesAr:
      'يعمل مع مزودات مثل Groq أو OpenRouter أو Together عبر OPENAI_COMPATIBLE_BASE_URL على الخادم (معظمها نصية فقط).',
    freeTierNotesEn:
      'Works with Groq, OpenRouter, or Together via server-side OPENAI_COMPATIBLE_BASE_URL.',
    supportsSearchGrounding: false,
    supportsVision: false,
  },
  local: {
    nameAr: 'نموذج محلي (Ollama / LM Studio)',
    nameEn: 'Local Model (Ollama / LM Studio)',
    modelDefault: 'llama3.2',
    availableModels: ['llama3.2', 'qwen2.5:14b', 'mistral'],
    freeTierNotesAr:
      'مجاني بالكامل ويعمل محليًا عبر LOCAL_LLM_URL عندما يتوفر خادم نماذج محلي.',
    freeTierNotesEn:
      'Free and private via LOCAL_LLM_URL when a local inference runtime is running.',
    supportsSearchGrounding: false,
    supportsVision: false,
  },
};
