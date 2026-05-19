import Link from 'next/link';
import Image from 'next/image';
import { ReactNode } from 'react';

type Block =
  | {
      type: 'heading';
      level: 1 | 2 | 3;
      text: string;
    }
  | {
      type: 'paragraph';
      text: string;
    }
  | {
      type: 'list';
      items: string[];
    };

function parseLegalContent(content: string) {
  const blocks: Block[] = [];
  const lines = content.split(/\r?\n/);
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list.length) {
      blocks.push({ type: 'list', items: list });
      list = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line === '---') {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith('### ')) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: 3, text: line.slice(4) });
      continue;
    }

    if (line.startsWith('## ')) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: 2, text: line.slice(3) });
      continue;
    }

    if (line.startsWith('# ')) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: 1, text: line.slice(2) });
      continue;
    }

    if (line.startsWith('* ')) {
      flushParagraph();
      list.push(line.slice(2));
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\[([^\]]+)\]\((mailto:[^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      nodes.push(<strong key={`${match.index}-strong`}>{match[2]}</strong>);
    } else if (match[3] && match[4]) {
      nodes.push(
        <a
          key={`${match.index}-link`}
          href={match[4]}
          className="text-purple-400 hover:text-purple-300 transition-colors duration-300 underline decoration-purple-400/30 hover:decoration-purple-300"
        >
          {match[3]}
        </a>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export function LegalDocument({ content }: { content: string }) {
  const blocks = parseLegalContent(content);
  const [titleBlock, ...bodyBlocks] =
    blocks[0]?.type === 'heading' && blocks[0].level === 1
      ? blocks
      : [{ type: 'heading' as const, level: 1 as const, text: '' }, ...blocks];

  // Extract title text from titleBlock
  const titleText = titleBlock && (titleBlock.type === 'heading' || titleBlock.type === 'paragraph')
    ? titleBlock.text
    : '';

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-950/80 border-b border-white/5">
        <div className="mx-auto max-w-[1200px] px-[20px] py-[16px] md:px-[40px] md:py-[20px]">
          <Link href="/" className="inline-flex items-center hover:opacity-70 transition-opacity duration-300">
            <Image
              src="/logo-escrito-branco.png"
              alt="TrendPostiz Logo"
              width={160}
              height={40}
              priority
              className="h-auto w-auto"
            />
          </Link>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1">
        <div className="mx-auto w-full max-w-[900px] px-[20px] py-[60px] md:px-[40px] md:py-[80px]">
          {/* Title Section */}
          <div className="mb-[60px]">
            <h1 className="text-[44px] md:text-[56px] font-[700] leading-tight mb-[16px] bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
              {titleText}
            </h1>
            <div className="h-[2px] w-[60px] bg-gradient-to-r from-purple-500 to-transparent"></div>
          </div>

          {/* Content Card */}
          <article className="space-y-[32px]">
            <div className="flex flex-col gap-[24px] text-[16px] leading-[1.8] text-slate-300">
              {bodyBlocks.map((block, index) => {
                if (block.type === 'heading') {
                  const className =
                    block.level === 2
                      ? 'mt-[40px] pt-[32px] text-[28px] font-[600] leading-snug text-white border-t border-white/5'
                      : 'mt-[24px] text-[20px] font-[600] leading-snug text-white/90';

                  return (
                    <h2 key={`${block.text}-${index}`} className={className}>
                      {block.text}
                    </h2>
                  );
                }

                if (block.type === 'list') {
                  return (
                    <ul
                      key={`list-${index}`}
                      className="list-none space-y-[12px] ps-0"
                    >
                      {block.items.map((item) => (
                        <li key={item} className="flex gap-[12px] items-start">
                          <span className="text-purple-400 font-[600] mt-[2px] flex-shrink-0">→</span>
                          <span className="text-slate-300">{renderInline(item)}</span>
                        </li>
                      ))}
                    </ul>
                  );
                }

                return (
                  <p key={`${block.text}-${index}`} className="text-slate-300">
                    {renderInline(block.text)}
                  </p>
                );
              })}
            </div>
          </article>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 backdrop-blur-md bg-slate-950/50">
        <div className="mx-auto max-w-[1200px] px-[20px] py-[40px] md:px-[40px]">
          <div className="flex flex-col md:flex-row items-center justify-between gap-[24px]">
            <p className="text-[14px] text-slate-400">
              © 2026 TrendPostiz. Todos os direitos reservados.
            </p>
            <Link 
              href="/" 
              className="text-[14px] text-slate-400 hover:text-white transition-colors duration-300"
            >
              Voltar ao início
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
