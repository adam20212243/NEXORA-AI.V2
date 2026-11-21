import { Check, ChevronDown, ChevronRight, Code2, Copy, Download, Eye, EyeOff } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { AppLanguage } from '../shared/types.ts';

interface MarkdownRendererProps {
  content: string;
  lang: AppLanguage;
}

type Block =
  | { type: 'code'; language: string; code: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'quote'; lines: string[] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'paragraph'; text: string };

function isSafeHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseBlocks(raw: string): Block[] {
  const blocks: Block[] = [];
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced Code Block
    const fenceMatch = line.match(/^```([A-Za-z0-9_+-]*)\s*$/);
    if (fenceMatch) {
      const language = (fenceMatch[1] || 'text').toLowerCase();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // Markdown Table (header | ... + separator | --- |)
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])
    ) {
      const splitCells = (rowStr: string) =>
        rowStr
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
      const headers = splitCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitCells(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', lines: quoteLines });
      continue;
    }

    // Unordered list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, '').trim());
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '').trim());
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Paragraph (accumulate non-empty lines until structural delimiter)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
    }
  }

  return blocks;
}

function InlineRichText({ text, isAr }: { text: string; isAr: boolean }) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Tokenize bold **...**, inline code `...`, math $...$, markdown links [label](url), and bare https:// links
  const tokenRe =
    /(\*\*[^*\n]+\*\*|`[^`\n]+`|\$\$[^$\n]+\$\$|\$[^$\n]+\$|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()]+)/g;

  const parts = text.split(tokenRe);

  const handleCopyUrl = (url: string) => {
    void navigator.clipboard?.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl((c) => (c === url ? null : c)), 1800);
  };

  return (
    <>
      {parts.map((part, idx) => {
        if (!part) return null;
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return (
            <strong key={idx} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <code
              key={idx}
              dir="ltr"
              className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-[0.85em]"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (
          (part.startsWith('$$') && part.endsWith('$$') && part.length > 4) ||
          (part.startsWith('$') && part.endsWith('$') && part.length > 2)
        ) {
          const expr = part.startsWith('$$') ? part.slice(2, -2) : part.slice(1, -1);
          return (
            <span
              key={idx}
              dir="ltr"
              className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-blue-50/70 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 font-mono text-[0.9em]"
            >
              {expr}
            </span>
          );
        }

        const mdLinkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
        if (mdLinkMatch && isSafeHttpsUrl(mdLinkMatch[2])) {
          const label = mdLinkMatch[1];
          const url = mdLinkMatch[2];
          return (
            <span key={idx} className="inline-flex items-center gap-1 mx-0.5">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 underline hover:opacity-80 break-all"
              >
                {label}
              </a>
              <button
                type="button"
                onClick={() => handleCopyUrl(url)}
                className="text-slate-400 hover:text-blue-600 p-0.5"
                title={isAr ? 'نسخ الرابط' : 'Copy link'}
              >
                {copiedUrl === url ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </span>
          );
        }

        if (/^https?:\/\//.test(part) && isSafeHttpsUrl(part)) {
          return (
            <span key={idx} className="inline-flex items-center gap-1 mx-0.5">
              <a
                href={part}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 underline hover:opacity-80 break-all"
              >
                {part}
              </a>
              <button
                type="button"
                onClick={() => handleCopyUrl(part)}
                className="text-slate-400 hover:text-blue-600 p-0.5"
                title={isAr ? 'نسخ الرابط' : 'Copy link'}
              >
                {copiedUrl === part ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </span>
          );
        }

        // Preserve single line breaks inside paragraphs
        const lines = part.split('\n');
        return (
          <Fragment key={idx}>
            {lines.map((ln, lIdx) => (
              <Fragment key={lIdx}>
                {lIdx > 0 && <br />}
                {ln}
              </Fragment>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

const LANG_EXT_MAP: Record<string, string> = {
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  javascript: 'js',
  js: 'js',
  jsx: 'jsx',
  python: 'py',
  py: 'py',
  html: 'html',
  css: 'css',
  json: 'json',
  sql: 'sql',
  bash: 'sh',
  sh: 'sh',
  kotlin: 'kt',
  kt: 'kt',
  svg: 'svg',
};

function CodeBlockCard({
  language,
  code,
  isAr,
}: {
  language: string;
  code: string;
  isAr: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const canPreview = language === 'html' || language === 'svg';

  const handleCopyCode = () => {
    void navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadCode = () => {
    const ext = LANG_EXT_MAP[language] || 'txt';
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexora-snippet.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const previewDoc =
    language === 'svg'
      ? `<!doctype html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#ffffff;">${code}</body></html>`
      : code;

  return (
    <div
      dir="ltr"
      className="my-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-950 text-slate-100 overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-slate-900 border-b border-slate-800 text-[11px]">
        <span className="inline-flex items-center gap-1.5 font-mono text-slate-300 uppercase">
          <Code2 className="w-3.5 h-3.5 text-blue-400" />
          <span>{language || 'code'}</span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyCode}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? (isAr ? 'تم النسخ' : 'Copied') : isAr ? 'نسخ الكود' : 'Copy Code'}</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadCode}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            <Download className="w-3 h-3" />
            <span>{isAr ? 'تنزيل' : 'Download'}</span>
          </button>
          {canPreview && (
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              <span>
                {showPreview
                  ? isAr
                    ? 'إخفاء المعاينة'
                    : 'Hide Preview'
                  : isAr
                  ? 'معاينة آمنة'
                  : 'Safe Preview'}
              </span>
            </button>
          )}
        </div>
      </div>

      <pre className="p-3.5 overflow-x-auto text-xs leading-relaxed font-mono">
        <code>{code}</code>
      </pre>

      {canPreview && showPreview && (
        <div className="border-t border-slate-800 bg-white p-2">
          <iframe
            title="NEXORA Safe Code Preview"
            sandbox=""
            srcDoc={previewDoc}
            className="w-full h-64 rounded border border-slate-200 bg-white"
          />
        </div>
      )}
    </div>
  );
}

export function MarkdownRenderer({ content, lang }: MarkdownRendererProps) {
  const isAr = lang === 'ar';
  const [expandedLong, setExpandedLong] = useState(false);

  const blocks = parseBlocks(content);
  const isVeryLong = content.length > 2600 && blocks.length > 6;
  const visibleBlocks = isVeryLong && !expandedLong ? blocks.slice(0, 6) : blocks;

  return (
    <div className="space-y-2.5 text-sm sm:text-[15px] leading-relaxed break-words">
      {visibleBlocks.map((block, idx) => {
        if (block.type === 'code') {
          return (
            <CodeBlockCard key={idx} language={block.language} code={block.code} isAr={isAr} />
          );
        }
        if (block.type === 'heading') {
          const sizes = [
            'text-base sm:text-lg font-bold mt-2',
            'text-sm sm:text-base font-bold mt-2',
            'text-sm font-semibold mt-1.5',
            'text-xs font-semibold uppercase tracking-wide mt-1',
          ];
          return (
            <div key={idx} className={sizes[block.level - 1] ?? sizes[1]}>
              <InlineRichText text={block.text} isAr={isAr} />
            </div>
          );
        }
        if (block.type === 'quote') {
          return (
            <blockquote
              key={idx}
              className="border-s-4 border-blue-500/70 ps-3.5 py-1 my-2 text-slate-600 dark:text-slate-300 bg-slate-50/70 dark:bg-slate-800/40 rounded-e-lg"
            >
              {block.lines.map((ln, qIdx) => (
                <p key={qIdx}>
                  <InlineRichText text={ln} isAr={isAr} />
                </p>
              ))}
            </blockquote>
          );
        }
        if (block.type === 'ul') {
          return (
            <ul key={idx} className="list-disc ps-5 space-y-1">
              {block.items.map((item, uIdx) => (
                <li key={uIdx}>
                  <InlineRichText text={item} isAr={isAr} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ol') {
          return (
            <ol key={idx} className="list-decimal ps-5 space-y-1">
              {block.items.map((item, oIdx) => (
                <li key={oIdx}>
                  <InlineRichText text={item} isAr={isAr} />
                </li>
              ))}
            </ol>
          );
        }
        if (block.type === 'table') {
          return (
            <div
              key={idx}
              className="my-2.5 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <table className="w-full text-xs text-start border-collapse">
                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                  <tr>
                    {block.headers.map((h, hIdx) => (
                      <th
                        key={hIdx}
                        className="px-3 py-2 font-semibold border-b border-slate-200 dark:border-slate-700"
                      >
                        <InlineRichText text={h} isAr={isAr} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {block.rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-3 py-2">
                          <InlineRichText text={cell} isAr={isAr} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={idx}>
            <InlineRichText text={block.text} isAr={isAr} />
          </p>
        );
      })}

      {isVeryLong && (
        <button
          type="button"
          onClick={() => setExpandedLong((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline pt-1"
        >
          {expandedLong ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <span>
            {expandedLong
              ? isAr
                ? 'طي القسم المطوّل'
                : 'Collapse Long Section'
              : isAr
              ? `عرض بقية الرد (${blocks.length - 6} أجزاء إضافية)`
              : `Expand Remaining Sections (${blocks.length - 6} more)`}
          </span>
        </button>
      )}
    </div>
  );
}
