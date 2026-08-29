'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

function HomeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path d="M3.5 10.8 12 3.5l8.5 7.3v8.7a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1v-8.7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path d="M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 20c.6-3.7 3-5.5 7-5.5s6.4 1.8 7 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

interface NavigationItemProps {
  href?: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
}

function NavigationItem({ href, label, icon, active }: NavigationItemProps) {
  const content = (
    <>
      {icon}
      <span className="text-[11px] font-semibold">{label}</span>
    </>
  );
  const className = `flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl transition-colors ${
    active ? 'text-btnPrimary' : 'text-textItemBlur'
  }`;

  if (!href) {
    return (
      <div className={`${className} opacity-60`} aria-disabled="true" title="Em breve">
        {content}
      </div>
    );
  }

  return (
    <Link href={href} className={className} aria-current={active ? 'page' : undefined}>
      {content}
    </Link>
  );
}

export function BottomNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação do Publisher"
      className="fixed bottom-0 left-1/2 z-40 w-full max-w-[430px] -translate-x-1/2 border-t border-newTableBorder bg-newBgColorInner/95 px-2 pt-1 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex">
        <NavigationItem href="/publish" label="Início" icon={<HomeIcon />} active={pathname === '/publish'} />
        <NavigationItem href="/publish/new" label="Criar" icon={<PlusIcon />} active={pathname.startsWith('/publish/new')} />
        <NavigationItem href="/publish/scheduled" label="Agenda" icon={<CalendarIcon />} active={pathname.startsWith('/publish/scheduled')} />
        <NavigationItem label="Perfil" icon={<ProfileIcon />} />
      </div>
    </nav>
  );
}
