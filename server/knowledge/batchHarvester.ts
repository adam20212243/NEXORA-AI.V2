import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  BatchJob,
  KnowledgeRecordInput,
  KnowledgeSectionId,
} from '../../src/shared/types.ts';
import { getDatabase, logAuditEvent } from '../db/database.ts';
import { insertKnowledgeBatch } from './repository.ts';

interface CategorySeed {
  lang: 'en' | 'ar';
  category: string;
  subcategory: string;
}

const SECTION_CATEGORY_TREES: Record<KnowledgeSectionId, CategorySeed[]> = {
  science: [
    { lang: 'en', category: 'Physics', subcategory: 'Physics' },
    { lang: 'en', category: 'Classical_mechanics', subcategory: 'Physics' },
    { lang: 'en', category: 'Quantum_mechanics', subcategory: 'Physics' },
    { lang: 'en', category: 'Thermodynamics', subcategory: 'Physics' },
    { lang: 'en', category: 'Electromagnetism', subcategory: 'Physics' },
    { lang: 'en', category: 'Optics', subcategory: 'Physics' },
    { lang: 'en', category: 'Chemistry', subcategory: 'Chemistry' },
    { lang: 'en', category: 'Organic_chemistry', subcategory: 'Chemistry' },
    { lang: 'en', category: 'Inorganic_chemistry', subcategory: 'Chemistry' },
    { lang: 'en', category: 'Biochemistry', subcategory: 'Chemistry' },
    { lang: 'en', category: 'Mathematics', subcategory: 'Mathematics' },
    { lang: 'en', category: 'Calculus', subcategory: 'Mathematics' },
    { lang: 'en', category: 'Linear_algebra', subcategory: 'Mathematics' },
    { lang: 'en', category: 'Probability_theory', subcategory: 'Mathematics' },
    { lang: 'en', category: 'Biology', subcategory: 'Biology' },
    { lang: 'en', category: 'Genetics', subcategory: 'Biology' },
    { lang: 'en', category: 'Cell_biology', subcategory: 'Biology' },
    { lang: 'en', category: 'Ecology', subcategory: 'Environment' },
    { lang: 'en', category: 'Astronomy', subcategory: 'Astronomy' },
    { lang: 'en', category: 'Astrophysics', subcategory: 'Astronomy' },
    { lang: 'en', category: 'Solar_System', subcategory: 'Astronomy' },
    { lang: 'en', category: 'Geology', subcategory: 'Earth Sciences' },
    { lang: 'en', category: 'Meteorology', subcategory: 'Earth Sciences' },
    { lang: 'en', category: 'Renewable_energy', subcategory: 'Energy' },
    { lang: 'en', category: 'Scientific_theories', subcategory: 'Scientific Theories' },
    { lang: 'ar', category: 'فيزياء', subcategory: 'Physics' },
    { lang: 'ar', category: 'كيمياء', subcategory: 'Chemistry' },
    { lang: 'ar', category: 'رياضيات', subcategory: 'Mathematics' },
    { lang: 'ar', category: 'علم_الأحياء', subcategory: 'Biology' },
    { lang: 'ar', category: 'علم_الفلك', subcategory: 'Astronomy' },
  ],
  programming: [
    { lang: 'en', category: 'Programming_languages', subcategory: 'Programming Languages' },
    { lang: 'en', category: 'JavaScript', subcategory: 'Web Development' },
    { lang: 'en', category: 'Python_(programming_language)', subcategory: 'Programming Languages' },
    { lang: 'en', category: 'C++', subcategory: 'Programming Languages' },
    { lang: 'en', category: 'Web_development', subcategory: 'Web Development' },
    { lang: 'en', category: 'Android_(operating_system)', subcategory: 'Android Development' },
    { lang: 'en', category: 'Android_software', subcategory: 'Android Development' },
    { lang: 'en', category: 'Game_engines', subcategory: 'Game Development' },
    { lang: 'en', category: 'Video_game_development', subcategory: 'Game Development' },
    { lang: 'en', category: 'Databases', subcategory: 'Databases' },
    { lang: 'en', category: 'Relational_database_management_systems', subcategory: 'Databases' },
    { lang: 'en', category: 'Computer_networking', subcategory: 'Computer Networks' },
    { lang: 'en', category: 'Internet_protocols', subcategory: 'Computer Networks' },
    { lang: 'en', category: 'Operating_systems', subcategory: 'Operating Systems' },
    { lang: 'en', category: 'Linux', subcategory: 'Operating Systems' },
    { lang: 'en', category: 'Artificial_intelligence', subcategory: 'Artificial Intelligence' },
    { lang: 'en', category: 'Machine_learning', subcategory: 'Artificial Intelligence' },
    { lang: 'en', category: 'Deep_learning', subcategory: 'Artificial Intelligence' },
    { lang: 'en', category: 'Software_engineering', subcategory: 'Software Engineering' },
    { lang: 'en', category: 'Software_architecture', subcategory: 'Software Engineering' },
    { lang: 'en', category: 'Computer_security', subcategory: 'Defensive Cybersecurity' },
    { lang: 'en', category: 'Cryptography', subcategory: 'Defensive Cybersecurity' },
    { lang: 'en', category: 'Algorithms', subcategory: 'Software Engineering' },
    { lang: 'en', category: 'Data_structures', subcategory: 'Software Engineering' },
    { lang: 'ar', category: 'لغات_برمجة', subcategory: 'Programming Languages' },
    { lang: 'ar', category: 'تطوير_البرمجيات', subcategory: 'Software Engineering' },
    { lang: 'ar', category: 'ذكاء_اصطناعي', subcategory: 'Artificial Intelligence' },
    { lang: 'ar', category: 'أمن_المعلومات', subcategory: 'Defensive Cybersecurity' },
  ],
  medicine: [
    { lang: 'en', category: 'Human_anatomy', subcategory: 'Human Anatomy' },
    { lang: 'en', category: 'Cardiovascular_system', subcategory: 'Human Anatomy' },
    { lang: 'en', category: 'Nervous_system', subcategory: 'Human Anatomy' },
    { lang: 'en', category: 'Human_physiology', subcategory: 'Physiology' },
    { lang: 'en', category: 'Pathology', subcategory: 'Pathology & Diseases' },
    { lang: 'en', category: 'Infectious_diseases', subcategory: 'Pathology & Diseases' },
    { lang: 'en', category: 'Autoimmune_diseases', subcategory: 'Immunology' },
    { lang: 'en', category: 'Immunology', subcategory: 'Immunology' },
    { lang: 'en', category: 'Pharmacology', subcategory: 'Pharmacology' },
    { lang: 'en', category: 'Antibiotics', subcategory: 'Pharmacology' },
    { lang: 'en', category: 'Medical_diagnosis', subcategory: 'Medical Diagnostics' },
    { lang: 'en', category: 'Blood_tests', subcategory: 'Medical Diagnostics' },
    { lang: 'en', category: 'Human_nutrition', subcategory: 'Nutrition' },
    { lang: 'en', category: 'Vitamins', subcategory: 'Nutrition' },
    { lang: 'en', category: 'Public_health', subcategory: 'Public Health' },
    { lang: 'en', category: 'Epidemiology', subcategory: 'Public Health' },
    { lang: 'en', category: 'Medical_research', subcategory: 'Medical Research' },
    { lang: 'en', category: 'Preventive_medicine', subcategory: 'Preventive Medicine' },
    { lang: 'en', category: 'Cardiology', subcategory: 'Physiology' },
    { lang: 'en', category: 'Endocrinology', subcategory: 'Physiology' },
    { lang: 'ar', category: 'تشريح_الإنسان', subcategory: 'Human Anatomy' },
    { lang: 'ar', category: 'علم_وظائف_الأعضاء', subcategory: 'Physiology' },
    { lang: 'ar', category: 'علم_الأمراض', subcategory: 'Pathology & Diseases' },
    { lang: 'ar', category: 'علم_المناعة', subcategory: 'Immunology' },
    { lang: 'ar', category: 'صحة_عامة', subcategory: 'Public Health' },
  ],
  history_culture: [
    { lang: 'en', category: 'Ancient_history', subcategory: 'Ancient History' },
    { lang: 'en', category: 'Ancient_Egypt', subcategory: 'Civilizations' },
    { lang: 'en', category: 'Mesopotamia', subcategory: 'Civilizations' },
    { lang: 'en', category: 'Modern_history', subcategory: 'Modern History' },
    { lang: 'en', category: 'World_War_II', subcategory: 'Historical Events' },
    { lang: 'en', category: 'Industrial_Revolution', subcategory: 'Historical Events' },
    { lang: 'en', category: 'Physical_geography', subcategory: 'Geography' },
    { lang: 'en', category: 'Countries', subcategory: 'Countries & Cities' },
    { lang: 'en', category: 'Capital_cities', subcategory: 'Countries & Cities' },
    { lang: 'en', category: 'World_Heritage_Sites', subcategory: 'Cultures' },
    { lang: 'en', category: 'Languages', subcategory: 'Languages' },
    { lang: 'en', category: 'Semitic_languages', subcategory: 'Languages' },
    { lang: 'en', category: 'Archaeology', subcategory: 'Discoveries' },
    { lang: 'en', category: 'Age_of_Discovery', subcategory: 'Discoveries' },
    { lang: 'en', category: 'History_of_science', subcategory: 'Discoveries' },
    { lang: 'en', category: 'Biographies', subcategory: 'Historical Figures' },
    { lang: 'ar', category: 'تاريخ_قديم', subcategory: 'Ancient History' },
    { lang: 'ar', category: 'تاريخ_حديث', subcategory: 'Modern History' },
    { lang: 'ar', category: 'جغرافيا', subcategory: 'Geography' },
    { lang: 'ar', category: 'حضارات_قديمة', subcategory: 'Civilizations' },
    { lang: 'ar', category: 'لغات', subcategory: 'Languages' },
  ],
  logic_creativity: [
    { lang: 'en', category: 'Logic', subcategory: 'Formal Logic' },
    { lang: 'en', category: 'Mathematical_logic', subcategory: 'Formal Logic' },
    { lang: 'en', category: 'Formal_fallacies', subcategory: 'Inference & Deduction' },
    { lang: 'en', category: 'Informal_fallacies', subcategory: 'Critical Thinking' },
    { lang: 'en', category: 'Critical_thinking', subcategory: 'Critical Thinking' },
    { lang: 'en', category: 'Problem_solving', subcategory: 'Problem Solving' },
    { lang: 'en', category: 'Heuristics', subcategory: 'Problem Solving' },
    { lang: 'en', category: 'Creativity', subcategory: 'Creative Thinking' },
    { lang: 'en', category: 'Innovation', subcategory: 'Innovation' },
    { lang: 'en', category: 'Strategic_management', subcategory: 'Strategic Planning' },
    { lang: 'en', category: 'Decision_theory', subcategory: 'Decision Theory' },
    { lang: 'en', category: 'Cognitive_biases', subcategory: 'Critical Thinking' },
    { lang: 'en', category: 'Scientific_method', subcategory: 'Scientific Method' },
    { lang: 'en', category: 'Philosophy_of_science', subcategory: 'Scientific Method' },
    { lang: 'en', category: 'Epistemology', subcategory: 'Inference & Deduction' },
    { lang: 'en', category: 'Rhetoric', subcategory: 'Structured Writing' },
    { lang: 'en', category: 'Systems_theory', subcategory: 'Problem Solving' },
    { lang: 'ar', category: 'منطق', subcategory: 'Formal Logic' },
    { lang: 'ar', category: 'تفكير_نقدي', subcategory: 'Critical Thinking' },
    { lang: 'ar', category: 'فلسفة_العلوم', subcategory: 'Scientific Method' },
    { lang: 'ar', category: 'إبداع', subcategory: 'Creative Thinking' },
  ],
};

interface WikiApiPage {
  pageid: number;
  title: string;
  extract?: string;
  fullurl?: string;
  categories?: Array<{ title: string }>;
}

interface WikiApiResponse {
  continue?: {
    gcmcontinue?: string;
  };
  query?: {
    pages?: Record<string, WikiApiPage>;
  };
}

function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const match = cleaned.match(/^(.{25,220}?[.!؟])(?:\s|$)/);
  if (match && match[1]) return match[1].trim();
  return cleaned.length > 180 ? `${cleaned.slice(0, 177).trim()}...` : cleaned;
}

async function fetchWikipediaCategoryBatch(
  seed: CategorySeed,
  continueToken: string | null,
  batchSize: number
): Promise<{
  pages: WikiApiPage[];
  nextContinueToken: string | null;
}> {
  const limit = Math.min(Math.max(batchSize, 5), 50);
  const host = seed.lang === 'ar' ? 'https://ar.wikipedia.org' : 'https://en.wikipedia.org';
  const categoryTitle =
    seed.lang === 'ar' ? `تصنيف:${seed.category}` : `Category:${seed.category}`;

  const params = new URLSearchParams({
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: categoryTitle,
    gcmtype: 'page',
    gcmlimit: String(limit),
    prop: 'extracts|info|categories',
    exintro: '1',
    explaintext: '1',
    exsentences: '4',
    inprop: 'url',
    cllimit: '5',
    format: 'json',
  });

  if (continueToken) {
    params.set('gcmcontinue', continueToken);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${host}/w/api.php?${params.toString()}`, {
      headers: {
        'User-Agent': 'NEXORA-AI-KnowledgeHarvester/1.0 (https://nexora.local)',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Wikipedia API HTTP ${res.status}`);
    }

    const data = (await res.json()) as WikiApiResponse;
    const pages = data.query?.pages ? Object.values(data.query.pages) : [];
    return {
      pages,
      nextContinueToken: data.continue?.gcmcontinue ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function listBatchJobs(db: DatabaseSync = getDatabase()): BatchJob[] {
  return db
    .prepare('SELECT * FROM batch_jobs ORDER BY updated_at DESC LIMIT 50')
    .all() as unknown as BatchJob[];
}

export function createBatchJob(
  section: KnowledgeSectionId,
  targetBatchSize = 50,
  sourceType: BatchJob['source_type'] = 'wikipedia',
  db: DatabaseSync = getDatabase()
): BatchJob {
  const now = new Date().toISOString();
  const id = `job_${crypto.randomUUID().slice(0, 12)}`;
  const clampedTarget = Math.min(Math.max(targetBatchSize, 10), 1000);

  db.prepare(
    `INSERT INTO batch_jobs (
      id, section, source_type, status, target_batch_size,
      processed_count, inserted_count, duplicate_count, rejected_count,
      cursor_category_index, cursor_continue_token, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, 'pending', ?, 0, 0, 0, 0, 0, NULL, NULL, ?, ?)`
  ).run(id, section, sourceType, clampedTarget, now, now);

  return db.prepare('SELECT * FROM batch_jobs WHERE id = ?').get(id) as unknown as BatchJob;
}

export async function runBatchStep(
  jobId: string,
  maxSteps = 4,
  db: DatabaseSync = getDatabase()
): Promise<BatchJob> {
  const job = db.prepare('SELECT * FROM batch_jobs WHERE id = ?').get(jobId) as
    | BatchJob
    | undefined;
  if (!job) {
    throw new Error(`Batch job ${jobId} not found.`);
  }
  if (job.status === 'completed') {
    return job;
  }

  const seeds = SECTION_CATEGORY_TREES[job.section];
  let catIndex = job.cursor_category_index;
  let continueToken = job.cursor_continue_token;
  let processed = job.processed_count;
  let inserted = job.inserted_count;
  let duplicates = job.duplicate_count;
  let rejected = job.rejected_count;

  db.prepare("UPDATE batch_jobs SET status = 'running', last_error = NULL, updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    jobId
  );

  try {
    let steps = 0;
    while (steps < maxSteps && inserted < job.target_batch_size && catIndex < seeds.length) {
      const seed = seeds[catIndex];
      const remaining = job.target_batch_size - inserted;
      const chunkLimit = Math.min(50, Math.max(remaining, 15));
      const { pages, nextContinueToken } = await fetchWikipediaCategoryBatch(
        seed,
        continueToken,
        chunkLimit
      );

      const accessedAt = new Date().toISOString();
      const recordsToInsert: KnowledgeRecordInput[] = [];

      for (const page of pages) {
        processed++;
        const extract = (page.extract ?? '').replace(/\s+/g, ' ').trim();
        if (!page.title || extract.length < 60 || !page.fullurl) {
          rejected++;
          continue;
        }

        const isStrong = extract.length >= 140;
        const cats = (page.categories ?? [])
          .map((c) => c.title.replace(/^Category:|^تصنيف:/, '').trim())
          .filter(Boolean);

        const usageLimits =
          job.section === 'medicine'
            ? 'معلومة طبية تثقيفية مستخرجة من مصدر موسوعي عام؛ لا تُعد تشخيصًا شخصيًا ولا بديلًا عن استشارة الطبيب.'
            : 'مرجع معرفي عام مستخرج من مصدر موسوعي موثق؛ يوصى بمراجعة المصادر الأكاديمية المتخصصة عند الاستخدام الدقيق.';

        recordsToInsert.push({
          section: job.section,
          subcategory: seed.subcategory,
          title: page.title.trim(),
          detailed_content: extract,
          simple_explanation: firstSentence(extract),
          context: `${seed.subcategory} (${seed.lang.toUpperCase()} Encyclopedia Entry)`,
          usage_limits: usageLimits,
          sources: [
            seed.lang === 'ar'
              ? `ويكيبيديا العربية - ${page.title.trim()}`
              : `Wikipedia (EN) - ${page.title.trim()}`,
          ],
          source_urls: [page.fullurl],
          accessed_at: accessedAt,
          confidence_level: isStrong ? 'high' : 'medium',
          review_status: isStrong ? 'verified' : 'needs_review',
          keywords: [seed.subcategory, page.title.trim(), ...cats].slice(0, 8),
          dedup_key: `wiki_${seed.lang}_${page.pageid}_${page.title.trim()}`,
        });
      }

      if (recordsToInsert.length > 0) {
        const batchResult = insertKnowledgeBatch(recordsToInsert, db);
        inserted += batchResult.inserted;
        duplicates += batchResult.duplicates;
        rejected += batchResult.rejected;
      }

      if (nextContinueToken) {
        continueToken = nextContinueToken;
      } else {
        catIndex++;
        continueToken = null;
      }

      steps++;

      // Persist checkpoint after every single batch step for crash-safe resumption
      const nextStatus: BatchJob['status'] =
        inserted >= job.target_batch_size || catIndex >= seeds.length ? 'completed' : 'paused';

      db.prepare(
        `UPDATE batch_jobs
         SET status = ?,
             processed_count = ?,
             inserted_count = ?,
             duplicate_count = ?,
             rejected_count = ?,
             cursor_category_index = ?,
             cursor_continue_token = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(
        nextStatus,
        processed,
        inserted,
        duplicates,
        rejected,
        catIndex,
        continueToken,
        new Date().toISOString(),
        jobId
      );
    }

    logAuditEvent(
      'BATCH_HARVEST_STEP',
      `Job ${jobId} (${job.section}): inserted=${inserted}, dup=${duplicates}, rej=${rejected}`,
      db
    );

    return db.prepare('SELECT * FROM batch_jobs WHERE id = ?').get(jobId) as unknown as BatchJob;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown batch error';
    db.prepare(
      `UPDATE batch_jobs
       SET status = 'failed',
           processed_count = ?,
           inserted_count = ?,
           duplicate_count = ?,
           rejected_count = ?,
           cursor_category_index = ?,
           cursor_continue_token = ?,
           last_error = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      processed,
      inserted,
      duplicates,
      rejected,
      catIndex,
      continueToken,
      message,
      new Date().toISOString(),
      jobId
    );
    throw err;
  }
}

export async function resumeIncompleteBatches(
  db: DatabaseSync = getDatabase()
): Promise<BatchJob[]> {
  const pending = db
    .prepare(
      "SELECT * FROM batch_jobs WHERE status IN ('pending', 'paused', 'running', 'failed') ORDER BY created_at ASC LIMIT 5"
    )
    .all() as unknown as BatchJob[];

  const updated: BatchJob[] = [];
  for (const job of pending) {
    try {
      const res = await runBatchStep(job.id, 3, db);
      updated.push(res);
    } catch {
      const latest = db
        .prepare('SELECT * FROM batch_jobs WHERE id = ?')
        .get(job.id) as unknown as BatchJob;
      if (latest) updated.push(latest);
    }
  }
  return updated;
}
