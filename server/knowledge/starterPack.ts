import type { KnowledgeRecordInput } from '../../src/shared/types.ts';
import { getKnowledgeStats, insertKnowledgeBatch } from './repository.ts';

const NOW = new Date().toISOString();

export const STARTER_KNOWLEDGE_RECORDS: KnowledgeRecordInput[] = [
  // Section 1: Science (5 records)
  {
    section: 'science',
    subcategory: 'Physics',
    title: 'قوانين نيوتن للحركة (Newton Laws of Motion)',
    detailed_content:
      'تصف قوانين نيوتن الثلاثة العلاقة بين حركة الجسم والقوى المؤثرة عليه في الميكانيكا الكلاسيكية: القانون الأول (القصور الذاتي)، والقانون الثاني (F = ma حيث تتناسب القوة المحصلة طرديًا مع التسارع والكتلة)، والقانون الثالث (لكل فعل رد فعل مساوٍ له في المقدار ومعاكس له في الاتجاه).',
    simple_explanation:
      'ثلاث قواعد أساسية تفسر كيف تتحرك الأجسام أو تبقى ساكنة عندما تؤثر عليها قوى.',
    context: 'Classical Mechanics',
    usage_limits: 'دقيقة للسرعات غير النسبية والأجسام الماكروسكوبية؛ تختلف عند السرعات القريبة من سرعة الضوء أو المقاييس الكمية.',
    sources: ['Encyclopaedia Britannica - Newton laws of motion', 'Wikipedia - Newton laws of motion'],
    source_urls: ['https://en.wikipedia.org/wiki/Newton%27s_laws_of_motion'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['نيوتن', 'فيزياء', 'حركة', 'قوة', 'قصور ذاتي', 'Newton', 'Physics', 'Mechanics'],
  },
  {
    section: 'science',
    subcategory: 'Physics',
    title: 'النسبية الخاصة (Special Relativity)',
    detailed_content:
      'صاغ ألبرت أينشتاين نظرية النسبية الخاصة عام 1905 انطلاقًا من مبدأين: ثبات قوانين الفيزياء في جميع الأطر المرجعية القصورية، وثبات سرعة الضوء في الفراغ لجميع المراقبين بغض النظر عن حركة المصدر، وينتج عنها تمدد الزمن وانكماش الطول وتكافؤ الكتلة والطاقة E = mc^2.',
    simple_explanation:
      'نظرية تصف كيف يتغير قياس الزمن والمسافة عند الحركة بسرعات قريبة من سرعة الضوء.',
    context: 'Relativistic Physics',
    usage_limits: 'تطبق في الأطر القصورية الخالية من تأثيرات الجاذبية القوية؛ للجاذبية تستخدم النسبية العامة.',
    sources: ['Wikipedia - Special relativity'],
    source_urls: ['https://en.wikipedia.org/wiki/Special_relativity'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['أينشتاين', 'نسبية', 'ضوء', 'طاقة', 'Einstein', 'Relativity', 'Physics'],
  },
  {
    section: 'science',
    subcategory: 'Chemistry',
    title: 'الجدول الدوري للعناصر (Periodic Table)',
    detailed_content:
      'يرتب الجدول الدوري العناصر الكيميائية حسب العدد الذري المتزايد (عدد البروتونات) والتوزيع الإلكتروني والخصائص الكيميائية المتكررة في دورات أفقية ومجموعات رأسية، مما يتيح التنبؤ بسلوك العناصر والروابط الكيميائية.',
    simple_explanation:
      'خريطة منظمة لجميع العناصر الكيميائية المعروفة مرتبة حسب خصائصها وعدد البروتونات.',
    context: 'Inorganic & General Chemistry',
    usage_limits: 'يعكس الخصائص الذرية القياسية؛ سلوك النظائر المشعة والعناصر فائقة الثقل قد يخضع لتأثيرات نسبية إضافية.',
    sources: ['IUPAC Periodic Table', 'Wikipedia - Periodic table'],
    source_urls: ['https://en.wikipedia.org/wiki/Periodic_table'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['كيمياء', 'عناصر', 'الجدول الدوري', 'ذرة', 'Chemistry', 'Periodic Table'],
  },
  {
    section: 'science',
    subcategory: 'Biology',
    title: 'عملية البناء الضوئي (Photosynthesis)',
    detailed_content:
      'عملية حيوية تحول فيها النباتات والطحالب وبعض البكتيريا الطاقة الضوئية إلى طاقة كيميائية مخزنة في جزيئات الجلوكوز باستخدام ثاني أكسيد الكربون والماء، مع إطلاق الأكسجين كناتج ثانوي داخل البلاستيدات الخضراء.',
    simple_explanation:
      'الطريقة التي تصنع بها النباتات غذاءها باستخدام ضوء الشمس والماء وثاني أكسيد الكربون.',
    context: 'Plant Biology & Bioenergetics',
    usage_limits: 'تعتمد كفاءتها على شدة الإضاءة وتركيز CO2 ودرجة الحرارة وتوفر الماء.',
    sources: ['Wikipedia - Photosynthesis'],
    source_urls: ['https://en.wikipedia.org/wiki/Photosynthesis'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['أحياء', 'نبات', 'بناء ضوئي', 'أكسجين', 'Biology', 'Photosynthesis'],
  },
  {
    section: 'science',
    subcategory: 'Mathematics',
    title: 'مبرهنة فيثاغورس (Pythagorean Theorem)',
    detailed_content:
      'في الهندسة الإقليدية، ينص قانون فيثاغورس على أن مربع طول الوتر في المثلث قائم الزاوية يساوي مجموع مربعي طولي الضلعين القائمين: a^2 + b^2 = c^2.',
    simple_explanation:
      'علاقة رياضية تحسب طول الضلع المائل في أي مثلث قائم الزاوية.',
    context: 'Euclidean Geometry',
    usage_limits: 'تنطبق في الفضاء الإقليدي المسطح فقط، وتختلف في الهندسة الكروية والزائدية.',
    sources: ['Wikipedia - Pythagorean theorem'],
    source_urls: ['https://en.wikipedia.org/wiki/Pythagorean_theorem'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['رياضيات', 'هندسة', 'فيثاغورس', 'مثلث', 'Mathematics', 'Geometry'],
  },

  // Section 2: Programming & Technology (5 records)
  {
    section: 'programming',
    subcategory: 'Programming Languages',
    title: 'لغة TypeScript ونظام الأنواع الساكنة',
    detailed_content:
      'TypeScript هي لغة برمجة مطورة من Microsoft تضيف نظام أنواع ساكنة اختياريًا فوق JavaScript، وتُترجم إلى JavaScript قياسي، مما يساعد على اكتشاف أخطاء الأنواع وقت الترجمة وتحسين قابلية الصيانة في المشاريع الكبيرة.',
    simple_explanation:
      'نسخة مطورة من JavaScript تضيف فحصًا صارمًا للبيانات قبل تشغيل البرنامج.',
    context: 'Web & Backend Engineering',
    usage_limits: 'تتحقق من الأنواع أثناء البناء فقط (Compile-time) ولا تتحقق تلقائيًا من البيانات القادمة من الشبكة وقت التشغيل إلا عبر التحقق البرمجي.',
    sources: ['TypeScript Official Docs', 'Wikipedia - TypeScript'],
    source_urls: ['https://en.wikipedia.org/wiki/TypeScript'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['برمجة', 'TypeScript', 'JavaScript', 'تايب سكريبت', 'الأنواع'],
  },
  {
    section: 'programming',
    subcategory: 'Databases',
    title: 'قاعدة بيانات SQLite وفهرس FTS5',
    detailed_content:
      'SQLite هي مكتبة قاعدة بيانات علائقية مدمجة بدون خادم منفصل تخزن البيانات في ملف واحد مع دعم المعاملات ACID، وتوفر إضافة FTS5 فهرسة بحث نصي كامل سريعة باستخدام خوارزمية الترتيب BM25.',
    simple_explanation:
      'قاعدة بيانات خفيفة وسريعة تُحفظ في ملف واحد على القرص مع بحث نصي فوري.',
    context: 'Embedded & Local Persistence',
    usage_limits: 'مناسبة لتطبيقات السيرفر الأحادي والتخزين المحلي، بينما تتطلب التوسع الأفقي متعدد الخوادم قواعد موزعة.',
    sources: ['SQLite Official Documentation', 'Wikipedia - SQLite'],
    source_urls: ['https://en.wikipedia.org/wiki/SQLite'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['قواعد البيانات', 'SQLite', 'FTS5', 'SQL', 'Database'],
  },
  {
    section: 'programming',
    subcategory: 'Android Development',
    title: 'نظام Android Intents والروابط العميقة (Deep Links)',
    detailed_content:
      'في نظام أندرويد، تُعد Intents رسائل غير متزامنة تتيح للتطبيق طلب إجراء من مكوّن آخر أو فتح تطبيق خارجي محدد عبر اسم الحزمة أو URI مخطط مثل intent://، بينما تربط App Links روابط HTTPS مباشرة بالتطبيق المثبت.',
    simple_explanation:
      'الآلية الرسمية في أندرويد التي تسمح للتطبيقات بفتح بعضها أو تمرير مهام محددة بأمان.',
    context: 'Android SDK & Native Bridge',
    usage_limits: 'تعمل بشكل كامل داخل تطبيقات Android الأصلية؛ أما متصفحات الويب فتقيد الإطلاق التلقائي وتحتاج تأكيد المستخدم.',
    sources: ['Android Developers - Intents', 'Wikipedia - Android (operating system)'],
    source_urls: ['https://en.wikipedia.org/wiki/Android_(operating_system)'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['أندرويد', 'Android', 'Intents', 'Deep Links', 'فتح التطبيقات'],
  },
  {
    section: 'programming',
    subcategory: 'Game Development',
    title: 'محركات الألعاب Unity وUnreal Engine وGodot',
    detailed_content:
      'تعتمد صناعة الألعاب الحديثة على محركات متكاملة مثل Unity (C# ومرونة عالية لألعاب الموبايل والكمبيوتر)، وUnreal Engine (C++ وBlueprints مع رسوميات متقدمة)، وGodot (مفتوح المصدر وخفيف الوزن بلغة GDScript وC#).',
    simple_explanation:
      'برامج متخصصة تجمع الرسوم والفيزياء والصوت والبرمجة لبناء ألعاب الكمبيوتر والهاتف.',
    context: 'Game Engineering',
    usage_limits: 'اختيار المحرك يعتمد على المنصة المستهدفة، متطلبات الأداء، والترخيص التجاري.',
    sources: ['Wikipedia - Game engine'],
    source_urls: ['https://en.wikipedia.org/wiki/Game_engine'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['ألعاب', 'Unity', 'Unreal Engine', 'Godot', 'تطوير الألعاب'],
  },
  {
    section: 'programming',
    subcategory: 'Defensive Cybersecurity',
    title: 'منع حقن SQL والتحقق من المدخلات (Parameterized Queries)',
    detailed_content:
      'تُمنع هجمات حقن SQL بفصل بنية الاستعلام عن قيم المستخدم عبر الاستعلامات المعلمية (Prepared Statements)، إلى جانب التحقق الصارم من الأنواع وعدم كشف المفاتيح السرية في واجهة المتصفح.',
    simple_explanation:
      'طريقة برمجية تحمي قاعدة البيانات عبر تمرير مدخلات المستخدم كبيانات منفصلة لا كأوامر.',
    context: 'Application Security',
    usage_limits: 'يجب تطبيق التحقق على الخادم دائمًا وعدم الاكتفاء بالتحقق في المتصفح.',
    sources: ['Wikipedia - SQL injection'],
    source_urls: ['https://en.wikipedia.org/wiki/SQL_injection'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['أمن سيبراني', 'SQL Injection', 'أمان', 'Security', 'Prepared Statements'],
  },

  // Section 3: Medicine & Medical Sciences (5 records)
  {
    section: 'medicine',
    subcategory: 'Immunology',
    title: 'الجهاز المناعي الفطري والمكتسب (Immune System)',
    detailed_content:
      'يتكون الجهاز المناعي البشري من خط دفاع فطري سريع غير متخصص (مثل الجلد والخلايا البلعمية) وخط دفاع مكتسب متخصص يعتمد على الخلايا اللمفاوية T وB وإنتاج الأجسام المضادة وتكوين الذاكرة المناعية.',
    simple_explanation:
      'شبكة من الخلايا والأعضاء تحمي الجسم من الجراثيم وتتذكر مسببات المرض لمقاومتها لاحقًا.',
    context: 'Human Immunology',
    usage_limits: 'معلومة تثقيفية عامة فقط؛ لا تغني عن استشارة الطبيب المختص لتقييم الاضطرابات المناعية أو التشخيص الشخصي.',
    sources: ['Wikipedia - Immune system'],
    source_urls: ['https://en.wikipedia.org/wiki/Immune_system'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['مناعة', 'الجهاز المناعي', 'طب', 'أجسام مضادة', 'Immunology'],
  },
  {
    section: 'medicine',
    subcategory: 'Physiology',
    title: 'الدورة الدموية ووظيفة القلب (Circulatory System)',
    detailed_content:
      'تضخ عضلة القلب الدم عبر دورتين متكاملتين: الدورة الرئوية لنقل الدم غير المؤكسج إلى الرئتين وتزويده بالأكسجين، والدورة الجهازية لتوزيع الدم المؤكسج والمغذيات إلى أنسجة الجسم وإزالة ثاني أكسيد الكربون.',
    simple_explanation:
      'النظام الذي يضخ من خلاله القلب الدم المحمل بالأكسجين والغذاء إلى جميع أنحاء الجسم.',
    context: 'Cardiovascular Physiology',
    usage_limits: 'معلومة تعليمية فقط؛ أي أعراض قلبية أو تغيرات في الضغط تتطلب مراجعة طبية مباشرة.',
    sources: ['Wikipedia - Circulatory system'],
    source_urls: ['https://en.wikipedia.org/wiki/Circulatory_system'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['القلب', 'الدورة الدموية', 'تشريح', 'وظائف الأعضاء', 'Cardiology'],
  },
  {
    section: 'medicine',
    subcategory: 'Pharmacology',
    title: 'مبادئ الحرائك الدوائية (Pharmacokinetics - ADME)',
    detailed_content:
      'تدرس الحرائك الدوائية مسار الدواء داخل الجسم عبر أربع مراحل رئيسية تُعرف بـ ADME: الامتصاص (Absorption)، والتوزيع (Distribution)، والأيض في الكبد (Metabolism)، والإطراح عبر الكلى أو الصفراء (Excretion).',
    simple_explanation:
      'كيف يدخل الدواء إلى الجسم وينتقل ويتفكك ثم يخرج منه.',
    context: 'Clinical Pharmacology',
    usage_limits: 'شرح علمي عام لمبادئ الأدوية؛ لا يُستخدم لتحديد جرعات أو وصف علاج دون طبيب أو صيدلي.',
    sources: ['Wikipedia - Pharmacokinetics'],
    source_urls: ['https://en.wikipedia.org/wiki/Pharmacokinetics'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['أدوية', 'صيدلة', 'حرائك دوائية', 'Pharmacology', 'ADME'],
  },
  {
    section: 'medicine',
    subcategory: 'Medical Diagnostics',
    title: 'فحص تعداد الدم الكامل (Complete Blood Count - CBC)',
    detailed_content:
      'يعد فحص CBC من التحاليل المخبرية الأساسية لقياس مكونات الدم الخلوية: خلايا الدم الحمراء والهيموجلوبين، وخلايا الدم البيضاء بأنواعها، والصفائح الدموية، ويساعد الأطباء على تقييم فقر الدم والالتهابات واضطرابات التجلط.',
    simple_explanation:
      'تحليل دم شائع يقيس مستويات كريات الدم الحمراء والبيضاء والصفائح.',
    context: 'Laboratory Diagnostics',
    usage_limits: 'تفسير نتائج التحاليل المخبرية يعتمد على السياق السريري والمختبري ويستوجب مراجعة الطبيب المعالج.',
    sources: ['Wikipedia - Complete blood count'],
    source_urls: ['https://en.wikipedia.org/wiki/Complete_blood_count'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['تحاليل طبية', 'CBC', 'تعداد الدم', 'هيموجلوبين', 'Medicine'],
  },
  {
    section: 'medicine',
    subcategory: 'Nutrition',
    title: 'العناصر الغذائية الكبرى والصغرى (Macronutrients & Micronutrients)',
    detailed_content:
      'يحتاج جسم الإنسان إلى مغذيات كبرى بكميات يومية كبيرة (الكربوهيدرات والبروتينات والدهون) لإنتاج الطاقة وبناء الأنسجة، وإلى مغذيات صغرى (الفيتامينات والمعادن) بكميات دقيقة لتنظيم التفاعلات الإنزيمية والمناعة.',
    simple_explanation:
      'تقسيم العناصر الغذائية إلى مصادر طاقة وبناء رئيسية وفيتامينات ومعادن مساعدة.',
    context: 'Human Nutrition',
    usage_limits: 'للتوعية الصحية العامة؛ الحالات المرضية أو الحميات العلاجية تتطلب إشرافًا طبيًا أو أخصائي تغذية.',
    sources: ['Wikipedia - Nutrition'],
    source_urls: ['https://en.wikipedia.org/wiki/Nutrition'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['تغذية', 'فيتامينات', 'بروتينات', 'صحة عامة', 'Nutrition'],
  },

  // Section 4: History, Geography & Cultures (5 records)
  {
    section: 'history_culture',
    subcategory: 'Civilizations',
    title: 'حضارة بلاد الرافدين والكتابة المسمارية',
    detailed_content:
      'تُعد حضارة بلاد الرافدين (سومر وأكد وبابل وآشور) في حوض نهري دجلة والفرات من أقدم الحضارات الحضرية في التاريخ، وفيها تطورت الكتابة المسمارية على ألواح الطين نحو الألفية الرابعة قبل الميلاد.',
    simple_explanation:
      'إحدى أقدم حضارات العالم التي نشأت في العراق القديم وابتكرت الكتابة المسمارية.',
    context: 'Ancient Near East History',
    usage_limits: 'التواريخ الأثرية المبكرة تعتمد على التأريخ الطبقي والكربون المشع وقد تختلف هوامشها بين الدراسات.',
    sources: ['Wikipedia - Mesopotamia'],
    source_urls: ['https://en.wikipedia.org/wiki/Mesopotamia'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['تاريخ', 'حضارات', 'بلاد الرافدين', 'مسمارية', 'Mesopotamia'],
  },
  {
    section: 'history_culture',
    subcategory: 'History of Science',
    title: 'بيت الحكمة في بغداد في العصر العباسي',
    detailed_content:
      'كان بيت الحكمة مركزًا علميًا وفكريًا بارزًا في بغداد خلال العصر العباسي (القرنين الثامن والتاسع الميلاديين)، وشهد حركة ترجمة وتأليف واسعة في الرياضيات والفلك والطب والفلسفة بمشاركة علماء مثل الخوارزمي والكندي.',
    simple_explanation:
      'مؤسسة علمية تاريخية في بغداد جمعت العلماء وترجمت وألفت كتب العلوم.',
    context: 'Islamic Golden Age',
    usage_limits: 'يعتمد التأريخ الدقيق لتفاصيله الإدارية على المصادر الكلاسيكية المتوفرة.',
    sources: ['Wikipedia - House of Wisdom'],
    source_urls: ['https://en.wikipedia.org/wiki/House_of_Wisdom'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['بيت الحكمة', 'بغداد', 'تاريخ', 'الخوارزمي', 'House of Wisdom'],
  },
  {
    section: 'history_culture',
    subcategory: 'Geography',
    title: 'نهر النيل وحوضه الجغرافي',
    detailed_content:
      'يمتد نهر النيل في شمال شرق أفريقيا متجهًا نحو البحر الأبيض المتوسط عبر رافديه الرئيسيين النيل الأبيض والنيل الأزرق، ويُعد أطول أنهار العالم أو من أطولها وفق القياسات الجغرافية المعتمدة.',
    simple_explanation:
      'أحد أطول أنهار العالم ويعد شريان الحياة الرئيسي في شمال شرق أفريقيا.',
    context: 'Physical Geography',
    usage_limits: 'تختلف القياسات الدقيقة لطول الأنهار حسب نقطة المنبع المعتمدة جغرافيًا.',
    sources: ['Wikipedia - Nile'],
    source_urls: ['https://en.wikipedia.org/wiki/Nile'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['جغرافيا', 'نهر النيل', 'أفريقيا', 'مصر', 'Geography', 'Nile'],
  },
  {
    section: 'history_culture',
    subcategory: 'Languages',
    title: 'اللغة العربية وخصائصها السامية',
    detailed_content:
      'اللغة العربية إحدى اللغات السامية الوسطى، وتتميز بنظام الاشتقاق الجذري الثلاثي والرباعي، وتنوعها بين الفصحى المعيارية واللهجات الإقليمية، وتُعد إحدى اللغات الرسمية الست في الأمم المتحدة.',
    simple_explanation:
      'لغة سامية عريقة تعتمد على جذور الكلمات وتُستخدم رسميًا في عشرات الدول والأمم المتحدة.',
    context: 'Linguistics & World Cultures',
    usage_limits: 'تختلف المفردات المحكية بين اللهجات العربية رغم اشتراكها في الفصحى.',
    sources: ['Wikipedia - Arabic'],
    source_urls: ['https://en.wikipedia.org/wiki/Arabic'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['اللغة العربية', 'لغات', 'ثقافة', 'Arabic', 'Linguistics'],
  },
  {
    section: 'history_culture',
    subcategory: 'Discoveries',
    title: 'اختراع المطبعة ذات الحروف المتحركة (غوتنبرغ)',
    detailed_content:
      'طوّر يوهانس غوتنبرغ في أوروبا منتصف القرن الخامس عشر المطبعة المعدنية ذات الحروف المتحركة، مما خفض تكلفة إنتاج الكتب وسرّع انتشار المعرفة العلمية والأدبية على نطاق واسع.',
    simple_explanation:
      'ابتكار تاريخي جعل طباعة الكتب ونشر المعرفة أسرع وأقل تكلفة بكثير.',
    context: 'History of Technology & Culture',
    usage_limits: 'سبقتها تجارب طباعة خشبية وحروف متحركة خزفية في شرق آسيا.',
    sources: ['Wikipedia - Printing press'],
    source_urls: ['https://en.wikipedia.org/wiki/Printing_press'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['تاريخ', 'اكتشافات', 'مطبعة', 'غوتنبرغ', 'Printing press'],
  },

  // Section 5: Thinking, Logic, Analysis & Creativity (5 records)
  {
    section: 'logic_creativity',
    subcategory: 'Formal Logic',
    title: 'الاستدلال الاستنباطي والاستقرائي (Deductive vs Inductive Reasoning)',
    detailed_content:
      'ينطلق الاستدلال الاستنباطي من مقدمات عامة ليصل إلى نتيجة لازمة منطقيًا إذا صحت المقدمات، بينما ينطلق الاستدلال الاستقرائي من ملاحظات جزئية متكررة لاستخلاص تعميم احتمالي قابل للمراجعة.',
    simple_explanation:
      'الاستنباط ينتقل من القاعدة العامة إلى الحالة الخاصة، والاستقراء يبني قاعدة من أمثلة متعددة.',
    context: 'Formal & Philosophical Logic',
    usage_limits: 'الاستنباط يضمن صدق النتيجة فقط إذا كانت المقدمات صادقة والبنية سليمة؛ الاستقراء احتمالي بطبيعته.',
    sources: ['Wikipedia - Deductive reasoning', 'Wikipedia - Inductive reasoning'],
    source_urls: ['https://en.wikipedia.org/wiki/Deductive_reasoning'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['منطق', 'استدلال', 'استنباط', 'استقراء', 'Logic', 'Reasoning'],
  },
  {
    section: 'logic_creativity',
    subcategory: 'Critical Thinking',
    title: 'التفكير النقدي وتجنب الانحياز التأكيدي (Confirmation Bias)',
    detailed_content:
      'التفكير النقدي هو التقييم الموضوعي للأدلة والحجج قبل إصدار الحكم، ومن أبرز عوائقه الانحياز التأكيدي الذي يدفع الباحث إلى تفضيل المعلومات المؤيدة لافتراضه المسبق وإهمال الأدلة المضادة.',
    simple_explanation:
      'مهارة فحص الأدلة بموضوعية وتجنب البحث فقط عما يؤكد رأينا المسبق.',
    context: 'Cognitive Science & Critical Analysis',
    usage_limits: 'يتطلب تدريبًا مستمرًا واختبار الفرضيات البديلة ومراجعة مصادر متعددة.',
    sources: ['Wikipedia - Critical thinking', 'Wikipedia - Confirmation bias'],
    source_urls: ['https://en.wikipedia.org/wiki/Critical_thinking'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['تفكير نقدي', 'انحياز تأكيدي', 'تحليل', 'Critical thinking'],
  },
  {
    section: 'logic_creativity',
    subcategory: 'Problem Solving',
    title: 'التفكير بالمبادئ الأولى (First Principles Thinking)',
    detailed_content:
      'يعني التفكير بالمبادئ الأولى تفكيك المشكلة المعقدة إلى حقائقها الأساسية التي لا يمكن اختزالها أكثر، ثم إعادة بناء الحلول من الصفر بدل الاعتماد على التقليد أو القياس السطحي.',
    simple_explanation:
      'إرجاع أي مشكلة إلى عناصرها الأساسية الثابتة ثم بناء حل جديد من الجذور.',
    context: 'Systems Analysis & Innovation',
    usage_limits: 'مفيد للابتكار وحل المشكلات الهيكلية، وقد يستغرق وقتًا أطول من الحلول التراكمية السريعة.',
    sources: ['Wikipedia - First principle'],
    source_urls: ['https://en.wikipedia.org/wiki/First_principle'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['حل المشكلات', 'المبادئ الأولى', 'تحليل', 'First Principles'],
  },
  {
    section: 'logic_creativity',
    subcategory: 'Decision Theory',
    title: 'تحليل السيناريوهات ومصفوفة القرار (Scenario Analysis)',
    detailed_content:
      'تحليل السيناريوهات أداة تخطيط استراتيجي تستكشف عدة مسارات مستقبلية محتملة (متفائل، أساسي، متشائم) مع تقييم المخاطر والعوائد لكل مسار، مما يحسّن جودة القرارات في ظروف عدم اليقين.',
    simple_explanation:
      'تخيل واختبار أكثر من مستقبل محتمل قبل اتخاذ قرار مهم لتقليل المفاجآت.',
    context: 'Strategic Planning & Decision Making',
    usage_limits: 'لا يتنبأ بالمستقبل بدقة مطلقة بل يجهز الخطط البديلة للتعامل مع المتغيرات.',
    sources: ['Wikipedia - Scenario planning'],
    source_urls: ['https://en.wikipedia.org/wiki/Scenario_planning'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['اتخاذ القرار', 'تحليل السيناريوهات', 'تخطيط', 'Decision making'],
  },
  {
    section: 'logic_creativity',
    subcategory: 'Scientific Method',
    title: 'المنهج العلمي وقابلية الدحض (Falsifiability)',
    detailed_content:
      'يقوم المنهج العلمي على الملاحظة، وصياغة فرضية قابلة للاختبار، وإجراء التجارب المضبوطة، وتحليل النتائج؛ ويرى كارل بوبر أن قابلية الدحض هي المعيار الفاصل للفرضيات العلمية.',
    simple_explanation:
      'الطريقة المنظمة لاختبار الأفكار عبر التجربة بحيث يمكن إثبات خطئها أو صحتها بالدليل.',
    context: 'Philosophy of Science',
    usage_limits: 'تطبيق المنهج التجريبي يختلف بين العلوم المخبرية والعلوم الرصدية كالفلك والتاريخ.',
    sources: ['Wikipedia - Scientific method', 'Wikipedia - Falsifiability'],
    source_urls: ['https://en.wikipedia.org/wiki/Scientific_method'],
    accessed_at: NOW,
    confidence_level: 'high',
    review_status: 'verified',
    keywords: ['تفكير علمي', 'المنهج العلمي', 'فرضية', 'Scientific method'],
  },
];

export function ensureStarterKnowledgeSeeded(): { seeded: boolean; count: number } {
  const stats = getKnowledgeStats();
  if (stats.totalRecords > 0) {
    return { seeded: false, count: 0 };
  }
  const result = insertKnowledgeBatch(STARTER_KNOWLEDGE_RECORDS);
  return { seeded: true, count: result.inserted };
}
