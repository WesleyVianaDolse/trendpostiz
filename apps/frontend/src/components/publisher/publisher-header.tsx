interface PublisherHeaderProps {
  userName?: string | null;
  userEmail?: string | null;
}

export function PublisherHeader({
  userName,
  userEmail,
}: PublisherHeaderProps) {
  return (
    <header className="px-5 pb-5 pt-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-btnPrimary text-lg font-bold text-white shadow-sm">
          T
        </div>
        <div className="min-w-0">
          <p className="text-xl font-bold tracking-[-0.02em] text-newTextColor">
            TrendPostiz
          </p>
          <p className="truncate text-sm text-textItemBlur">
            {userName || userEmail || 'Organização ativa'}
          </p>
        </div>
      </div>
    </header>
  );
}
