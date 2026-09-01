'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { LogoutComponent } from '@gitroom/frontend/components/layout/logout.component';
import { reloadWithoutCache } from '@gitroom/frontend/components/layout/version.update';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { BottomNavigation } from '@gitroom/frontend/components/publisher/bottom-navigation';

function UserIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 20c.6-3.7 3-5.5 7-5.5s6.4 1.8 7 5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
      <path
        d="M20 11a8 8 0 1 0-2.34 5.66M20 5v6h-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ProfileShell() {
  const user = useUser();
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheError, setCacheError] = useState(false);
  const initials = useMemo(() => {
    const source = user?.name || user?.email || 'T';
    return source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
  }, [user?.email, user?.name]);

  const clearCache = useCallback(async () => {
    if (clearingCache) return;
    setClearingCache(true);
    setCacheError(false);
    try {
      await reloadWithoutCache();
    } catch {
      setCacheError(true);
      setClearingCache(false);
    }
  }, [clearingCache]);

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-y-auto bg-newBgColor">
      <div className="mx-auto min-h-full w-full max-w-[430px] bg-newBgColor pb-[calc(6rem+env(safe-area-inset-bottom))] shadow-[0_0_40px_rgba(0,0,0,0.06)]">
        <header className="px-5 pb-5 pt-6">
          <p className="text-xs font-semibold text-textItemBlur">Sua conta</p>
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.02em] text-newTextColor">
            Perfil
          </h1>
        </header>

        <main className="space-y-5 px-5">
          <section className="flex items-center gap-4 rounded-2xl border border-newTableBorder bg-newBgColorInner p-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-btnPrimary text-lg font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-newTextColor">
                {user?.name || 'Usuário'}
              </p>
              <p className="truncate text-sm text-textItemBlur">
                {user?.email}
              </p>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-newTableBorder bg-newBgColorInner">
            <Link
              href="/settings"
              className="flex min-h-16 items-center gap-3 border-b border-newTableBorder px-4 text-newTextColor active:bg-boxHover"
            >
              <span className="text-btnPrimary">
                <UserIcon />
              </span>
              <span className="flex-1 text-sm font-bold">
                Configurações da conta
              </span>
              <span aria-hidden="true" className="text-textItemBlur">
                ›
              </span>
            </Link>

            <button
              type="button"
              onClick={() => void clearCache()}
              disabled={clearingCache}
              className="flex min-h-16 w-full items-center gap-3 px-4 text-left text-newTextColor disabled:opacity-60 active:bg-boxHover"
            >
              <span className="text-btnPrimary">
                <RefreshIcon />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-bold">
                  Limpar cache e atualizar
                </span>
                <span className="mt-0.5 block text-xs text-textItemBlur">
                  Corrige uma versão antiga salva no celular
                </span>
              </span>
              {clearingCache ? (
                <span className="text-xs text-textItemBlur">Limpando…</span>
              ) : null}
            </button>
          </section>

          {cacheError ? (
            <p role="alert" className="text-sm text-red-400">
              Não foi possível limpar o cache. Feche e abra o aplicativo e tente
              novamente.
            </p>
          ) : null}

          <section className="rounded-2xl border border-red-500/30 bg-newBgColorInner p-4">
            <p className="mb-3 text-xs text-textItemBlur">
              Encerra sua sessão neste dispositivo.
            </p>
            <div className="flex min-h-12 items-center justify-center rounded-xl border border-red-500/40 text-sm font-bold">
              <LogoutComponent />
            </div>
          </section>
        </main>

        <BottomNavigation />
      </div>
    </div>
  );
}
