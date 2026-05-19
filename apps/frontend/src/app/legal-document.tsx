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
          className="text-blue-400 hover:text-blue-300"
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
    <main className="min-h-screen bg-[#0E0E0E] text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="mx-auto max-w-[920px] px-[20px] py-[24px] md:px-[32px] md:py-[32px]">
          <Link href="/" className="flex items-center gap-[12px] hover:opacity-80 transition-opacity">
            <Image
              src="/logo-escrito-branco.png"
              alt="TrendPostiz Logo"
              width={150}
              height={40}
              priority
            />
          </Link>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1">
        <div className="mx-auto flex w-full max-w-[920px] flex-col px-[20px] py-[48px] md:px-[32px] md:py-[72px]">
          <article className="rounded-[12px] bg-[#1A1919] px-[20px] py-[28px] md:px-[48px] md:py-[44px]">
            <header className="mb-[32px] border-b border-white/10 pb-[24px]">
              <h1 className="text-[32px] font-[600] leading-tight md:text-[44px]">
                {titleText}
              </h1>
            </header>
            <div className="flex flex-col gap-[18px] text-[15px] leading-[1.75] text-white/80">
              {bodyBlocks.map((block, index) => {
                if (block.type === 'heading') {
                  const className =
                    block.level === 2
                      ? 'mt-[12px] border-t border-white/10 pt-[24px] text-[22px] font-[600] leading-snug text-white'
                      : 'mt-[8px] text-[18px] font-[600] leading-snug text-white';

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
                      className="list-disc space-y-[8px] ps-[22px]"
                    >
                      {block.items.map((item) => (
                        <li key={item}>{renderInline(item)}</li>
                      ))}
                    </ul>
                  );
                }

                return (
                  <p key={`${block.text}-${index}`}>{renderInline(block.text)}</p>
                );
              })}
            </div>
          </article>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-auto">
        <div className="mx-auto max-w-[920px] px-[20px] py-[32px] md:px-[32px] text-center">
          <p className="text-[14px] text-white/60">
            TrendPostiz © 2026. Todos os direitos reservados.
          </p>
        </div>
      </footer>
    </main>
  );
}
