'use client';

import Link from 'next/link';
import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  hasMore: boolean;
}
interface Session {
  id: string;
  email: string;
  name: string;
  isOwner: boolean;
}
interface Settings {
  registrationEnabled: boolean;
  organizationCreationEnabled: boolean;
}
interface Organization {
  id: string;
  name: string;
  createdAt: string;
  suspendedAt: string | null;
  suspensionReason: string | null;
  deletionRequestedAt?: string | null;
  deletionError?: string | null;
  _count: { users: number; Integration: number };
}
interface User {
  id: string;
  email: string;
  name: string | null;
  providerName: string;
  activated: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  isPlatformAdmin: boolean;
  createdAt: string;
  organizations: {
    role: string;
    disabled: boolean;
    organization: { id: string; name: string; suspendedAt: string | null };
  }[];
}
interface OrganizationDetail extends Organization {
  users: { id: string; role: string; disabled: boolean; user: User }[];
  Integration: {
    id: string;
    name: string;
    providerIdentifier: string;
    disabled: boolean;
    refreshNeeded: boolean;
  }[];
  heldPosts: number;
}
interface Audit {
  id: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  details: { name?: string } | null;
  createdAt: string;
}
type Operation =
  | { kind: 'delete'; organization: Organization }
  | { kind: 'suspend'; organization: Organization }
  | { kind: 'disable'; user: User }
  | { kind: 'admin'; user: User }
  | { kind: 'organization' }
  | { kind: 'user' };
const inputClass =
  'w-full rounded-xl border border-newTableBorder bg-newBgColor px-3 py-2.5 text-sm text-newTextColor focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary';
const buttonClass =
  'rounded-xl border border-newTableBorder px-4 py-2.5 text-sm font-semibold hover:bg-boxHover disabled:cursor-wait disabled:opacity-50';
const primaryClass = `${buttonClass} border-transparent bg-btnPrimary text-white hover:opacity-90`;
const date = (value: string) => new Date(value).toLocaleString('pt-BR');

async function readResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      Array.isArray(body.message)
        ? body.message.join(' ')
        : body.message || 'Não foi possível concluir a operação.'
    );
  return body;
}
function useAdminData<T>(path: string | null) {
  const fetch = useFetch();
  const load = useCallback(
    async (url: string): Promise<T> => readResponse(await fetch(url)),
    [fetch]
  );
  return useSWR<T>(path === null ? null : `/platform-admin${path}`, load, {
    refreshInterval: 30000,
    shouldRetryOnError: false,
  });
}
function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <p
      role={error ? 'alert' : 'status'}
      className={`rounded-xl border p-4 text-sm ${
        error
          ? 'border-red-500/30 bg-red-500/10'
          : 'border-emerald-500/30 bg-emerald-500/10'
      }`}
    >
      {children}
    </p>
  );
}
function Pager({
  page,
  hasMore,
  total,
  onChange,
}: {
  page: number;
  hasMore: boolean;
  total: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-4 text-sm text-textItemBlur">
      <span>
        {total} registros · Página {page + 1}
      </span>
      <div className="flex gap-2">
        <button
          className={buttonClass}
          disabled={!page}
          onClick={() => onChange(page - 1)}
        >
          Anterior
        </button>
        <button
          className={buttonClass}
          disabled={!hasMore}
          onClick={() => onChange(page + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
function StateBadge({
  suspended,
  children,
}: {
  suspended?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
        suspended
          ? 'bg-amber-500/15 text-amber-500'
          : 'bg-emerald-500/15 text-emerald-500'
      }`}
    >
      {children}
    </span>
  );
}
function Dialog({
  title,
  onClose,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto max-h-[90vh] w-[min(94vw,600px)] overflow-y-auto rounded-2xl border border-newTableBorder bg-newBgColorInner p-6 text-newTextColor shadow-2xl backdrop:bg-black/70"
      aria-label={title}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <h2 className="text-xl font-bold">{title}</h2>
        <button
          type="button"
          aria-label="Fechar"
          onClick={onClose}
          disabled={busy}
          className={buttonClass}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Lookup({
  kind,
  value,
  onChange,
}: {
  kind: 'users' | 'organizations';
  value: string;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState('');
  const { data, error } = useAdminData<Page<User | Organization>>(
    `/${kind}?search=${encodeURIComponent(search)}`
  );
  return (
    <div className="space-y-2">
      <input
        className={inputClass}
        aria-label={
          kind === 'users'
            ? 'Buscar responsável por nome ou e-mail'
            : 'Buscar organização'
        }
        placeholder={
          kind === 'users' ? 'Buscar nome ou e-mail' : 'Buscar organização'
        }
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          onChange('');
        }}
      />
      <select
        required
        className={inputClass}
        aria-label={kind === 'users' ? 'Responsável' : 'Organização'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Selecione uma opção</option>
        {data?.items
          .filter((item) =>
            'email' in item
              ? item.activated && !item.disabledAt
              : !item.suspendedAt
          )
          .map((item) => (
            <option key={item.id} value={item.id}>
              {item.name || item.id}
              {'email' in item ? ` · ${item.email} (${item.providerName})` : ''}
            </option>
          ))}
      </select>
      {error && <Notice error>{error.message}</Notice>}
      <p className="text-xs text-textItemBlur">
        Até 20 resultados. Refine a busca para localizar outra conta.
      </p>
    </div>
  );
}

function Overview() {
  const { data, error, isLoading, mutate } =
    useAdminData<Record<string, number>>('/overview');
  const cards = [
    ['users', 'Usuários'],
    ['organizations', 'Organizações'],
    ['socialAccounts', 'Contas sociais'],
    ['suspendedOrganizations', 'Organizações suspensas'],
    ['disabledUsers', 'Usuários bloqueados'],
    ['queuedPosts', 'Posts na fila'],
    ['heldPosts', 'Posts pausados'],
  ] as const;
  if (error)
    return (
      <Notice error>
        {error.message}{' '}
        <button onClick={() => mutate()} className="underline">
          Tentar novamente
        </button>
      </Notice>
    );
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {cards.map(([key, label]) => (
          <article
            key={key}
            className="rounded-2xl border border-newTableBorder bg-newBgColorInner p-5"
          >
            <p className="text-sm text-textItemBlur">{label}</p>
            <p className="mt-3 text-4xl font-bold tracking-tight">
              {isLoading ? '…' : data?.[key] ?? 0}
            </p>
          </article>
        ))}
      </div>
      <section className="rounded-2xl border border-newTableBorder bg-newBgColorInner p-6">
        <h2 className="font-bold">Controle da plataforma</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-textItemBlur">
          Gerencie o acesso de seus clientes em Organizações e Usuários. As
          suspensões são manuais e preservam os dados. Ao reativar uma
          organização, posts vencidos voltam como rascunhos para revisão;
          horários futuros continuam programados.
        </p>
      </section>
    </div>
  );
}

function Organizations({
  onAction,
  canDelete,
}: {
  onAction: (operation: Operation) => void;
  canDelete: boolean;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const { data, error, isLoading } = useAdminData<Page<Organization>>(
    `/organizations?search=${encodeURIComponent(search)}&page=${page}`
  );
  const { data: detail, error: detailError } = useAdminData<OrganizationDetail>(
    detailId ? `/organizations/${encodeURIComponent(detailId)}` : null
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <input
          className={`${inputClass} max-w-md`}
          aria-label="Buscar organizações"
          placeholder="Buscar organização ou e-mail de membro"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <button
          className={primaryClass}
          onClick={() => onAction({ kind: 'organization' })}
        >
          Nova organização
        </button>
      </div>
      {error && <Notice error>{error.message}</Notice>}
      {isLoading && <p role="status">Carregando organizações…</p>}
      {data && (
        <>
          <div className="overflow-x-auto rounded-2xl border border-newTableBorder bg-newBgColorInner">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-newTableBorder text-xs uppercase text-textItemBlur">
                <tr>
                  {[
                    'Organização',
                    'Status',
                    'Membros',
                    'Contas sociais',
                    'Ações',
                  ].map((label) => (
                    <th key={label} className="p-4">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((org) => (
                  <tr
                    key={org.id}
                    className="border-b border-newTableBorder last:border-0"
                  >
                    <td className="p-4">
                      <button
                        className="text-left font-semibold hover:underline"
                        onClick={() => setDetailId(org.id)}
                      >
                        {org.name}
                      </button>
                      <div className="mt-1 text-xs text-textItemBlur">
                        Criada em {date(org.createdAt)}
                      </div>
                    </td>
                    <td className="p-4">
                      <StateBadge suspended={!!org.suspendedAt}>
                        {org.deletionRequestedAt
                          ? 'Exclusão em andamento'
                          : org.suspendedAt
                          ? 'Suspensa'
                          : 'Ativa'}
                      </StateBadge>
                      {org.suspensionReason && (
                        <p className="mt-2 max-w-xs text-xs text-textItemBlur">
                          {org.suspensionReason}
                        </p>
                      )}
                      {org.deletionError && (
                        <p
                          role="alert"
                          className="mt-2 max-w-xs text-xs text-red-400"
                        >
                          {org.deletionError}
                        </p>
                      )}
                    </td>
                    <td className="p-4">{org._count.users}</td>
                    <td className="p-4">{org._count.Integration}</td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={buttonClass}
                          disabled={!!org.deletionRequestedAt}
                          onClick={() =>
                            onAction({ kind: 'suspend', organization: org })
                          }
                        >
                          {org.suspendedAt ? 'Reativar' : 'Suspender'}
                        </button>
                        {canDelete && (
                          <button
                            className={`${buttonClass} border-red-500/30 text-red-400 hover:bg-red-500/10`}
                            disabled={
                              !!org.deletionRequestedAt && !org.deletionError
                            }
                            onClick={() =>
                              onAction({ kind: 'delete', organization: org })
                            }
                          >
                            {org.deletionError
                              ? 'Tentar exclusão novamente'
                              : 'Excluir'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.items.length && (
              <p className="p-8 text-center text-textItemBlur">
                Nenhuma organização encontrada.
              </p>
            )}
          </div>
          <Pager {...data} onChange={setPage} />
        </>
      )}
      {detailId && (
        <Dialog
          title={detail?.name || 'Detalhes da organização'}
          onClose={() => setDetailId(null)}
        >
          {detailError && <Notice error>{detailError.message}</Notice>}
          {!detail && !detailError && <p>Carregando…</p>}
          {detail && (
            <div className="space-y-5">
              <StateBadge suspended={!!detail.suspendedAt}>
                {detail.suspendedAt ? 'Suspensa' : 'Ativa'}
              </StateBadge>
              <p className="break-all text-xs text-textItemBlur">
                ID: {detail.id}
              </p>
              <p className="text-sm">Posts pausados: {detail.heldPosts}</p>
              <h3 className="font-semibold">Membros</h3>
              <ul className="space-y-2">
                {detail.users.map((member) => (
                  <li
                    key={member.id}
                    className="rounded-lg border border-newTableBorder p-3 text-sm"
                  >
                    <p>{member.user.name || member.user.email}</p>
                    <p className="break-all text-xs text-textItemBlur">
                      {member.user.email} · {member.role}
                      {member.disabled || member.user.disabledAt
                        ? ' · Bloqueado'
                        : ''}
                    </p>
                  </li>
                ))}
              </ul>
              <h3 className="font-semibold">Contas de redes sociais</h3>
              {!detail.Integration.length && (
                <p className="text-sm text-textItemBlur">
                  Nenhuma conta conectada.
                </p>
              )}
              <ul className="space-y-2">
                {detail.Integration.map((account) => (
                  <li
                    key={account.id}
                    className="rounded-lg border border-newTableBorder p-3 text-sm"
                  >
                    {account.name} · {account.providerIdentifier}
                    {account.disabled
                      ? ' · Desativada'
                      : account.refreshNeeded
                      ? ' · Reconexão necessária'
                      : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

function Users({
  session,
  onAction,
}: {
  session: Session;
  onAction: (operation: Operation) => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const { data, error, isLoading } = useAdminData<Page<User>>(
    `/users?search=${encodeURIComponent(search)}&page=${page}`
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <input
          className={`${inputClass} max-w-md`}
          aria-label="Buscar usuários"
          placeholder="Buscar usuário por nome ou e-mail"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <button
          className={primaryClass}
          onClick={() => onAction({ kind: 'user' })}
        >
          Novo usuário
        </button>
      </div>
      {error && <Notice error>{error.message}</Notice>}
      {isLoading && <p role="status">Carregando usuários…</p>}
      {data && (
        <>
          <div className="overflow-x-auto rounded-2xl border border-newTableBorder bg-newBgColorInner">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-newTableBorder text-xs uppercase text-textItemBlur">
                <tr>
                  {['Usuário', 'Status', 'Organizações', 'Ações'].map(
                    (label) => (
                      <th key={label} className="p-4">
                        {label}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {data.items.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-newTableBorder last:border-0"
                  >
                    <td className="p-4">
                      <p className="font-semibold">{user.name || user.email}</p>
                      <p className="text-xs text-textItemBlur">
                        {user.email} · {user.providerName}
                      </p>
                      {user.isPlatformAdmin && (
                        <p className="mt-1 text-xs text-btnPrimary">
                          {user.id === session.id && session.isOwner
                            ? 'Titular da plataforma'
                            : 'Administrador global'}
                        </p>
                      )}
                    </td>
                    <td className="p-4">
                      <StateBadge
                        suspended={!!user.disabledAt || !user.activated}
                      >
                        {user.disabledAt
                          ? 'Bloqueado'
                          : user.activated
                          ? 'Ativo'
                          : 'Aguardando ativação'}
                      </StateBadge>
                      {user.disabledReason && (
                        <p className="mt-2 max-w-xs text-xs text-textItemBlur">
                          {user.disabledReason}
                        </p>
                      )}
                    </td>
                    <td className="p-4">
                      <ul className="space-y-1">
                        {user.organizations.map((membership) => (
                          <li key={membership.organization.id}>
                            {membership.organization.name}
                            <span className="text-xs text-textItemBlur">
                              {' '}
                              · {membership.role}
                              {membership.organization.suspendedAt
                                ? ' · Suspensa'
                                : ''}
                              {membership.disabled
                                ? ' · Membro desativado'
                                : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={buttonClass}
                          disabled={
                            user.isPlatformAdmin || user.id === session.id
                          }
                          onClick={() => onAction({ kind: 'disable', user })}
                        >
                          {user.disabledAt ? 'Desbloquear' : 'Bloquear'}
                        </button>
                        {session.isOwner && user.id !== session.id && (
                          <button
                            className={buttonClass}
                            disabled={!!user.disabledAt || !user.activated}
                            onClick={() => onAction({ kind: 'admin', user })}
                          >
                            {user.isPlatformAdmin
                              ? 'Revogar administrador'
                              : 'Autorizar administrador'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.items.length && (
              <p className="p-8 text-center text-textItemBlur">
                Nenhum usuário encontrado.
              </p>
            )}
          </div>
          <Pager {...data} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function SettingsPanel({
  onSave,
  busy,
}: {
  onSave: (body: Settings) => Promise<boolean>;
  busy: boolean;
}) {
  const { data, error } = useAdminData<Settings>('/settings');
  const [draft, setDraft] = useState<Settings | null>(null);
  const values = draft || data;
  if (error) return <Notice error>{error.message}</Notice>;
  if (!values) return <p role="status">Carregando configurações…</p>;
  return (
    <form
      className="max-w-3xl space-y-5 rounded-2xl border border-newTableBorder bg-newBgColorInner p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave(values)) setDraft(null);
      }}
    >
      <h2 className="text-lg font-bold">Cadastros e organizações</h2>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-newTableBorder p-4">
        <input
          type="checkbox"
          checked={values.registrationEnabled}
          disabled={busy}
          onChange={(e) =>
            setDraft({ ...values, registrationEnabled: e.target.checked })
          }
          className="mt-1 h-4 w-4 accent-[#612bd3]"
        />
        <span>
          <span className="block font-semibold">
            Permitir cadastros públicos
          </span>
          <span className="mt-1 block text-sm text-textItemBlur">
            Ao fechar, novos visitantes não podem se cadastrar. Membros
            convidados e cadastros feitos por administradores continuam
            permitidos.
          </span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-newTableBorder p-4">
        <input
          type="checkbox"
          checked={values.organizationCreationEnabled}
          disabled={busy}
          onChange={(e) =>
            setDraft({
              ...values,
              organizationCreationEnabled: e.target.checked,
            })
          }
          className="mt-1 h-4 w-4 accent-[#612bd3]"
        />
        <span>
          <span className="block font-semibold">
            Permitir organizações pelo cadastro público
          </span>
          <span className="mt-1 block text-sm text-textItemBlur">
            Cada novo cadastro cria uma organização. Desligar esta opção também
            impede o cadastro público. Organizações adicionais são criadas
            somente neste painel.
          </span>
        </span>
      </label>
      <p className="text-sm text-textItemBlur">
        As alterações entram em vigor ao salvar, sem reiniciar o servidor.
      </p>
      <button type="submit" className={primaryClass} disabled={busy || !draft}>
        {busy ? 'Salvando…' : 'Salvar configurações'}
      </button>
    </form>
  );
}
const actionNames: Record<string, string> = {
  'organization.delete': 'Organização excluída permanentemente',
  'admin.initialize': 'Administrador inicial configurado',
  'settings.update': 'Configurações alteradas',
  'organization.suspend': 'Organização suspensa',
  'organization.reactivate': 'Organização reativada',
  'organization.create': 'Organização criada',
  'user.disable': 'Usuário bloqueado',
  'user.enable': 'Usuário desbloqueado',
  'user.create': 'Usuário criado',
  'admin.grant': 'Administrador autorizado',
  'admin.revoke': 'Permissão administrativa revogada',
};
function AuditPanel() {
  const [page, setPage] = useState(0);
  const { data, error, isLoading } = useAdminData<Page<Audit>>(
    `/audit?page=${page}`
  );
  return (
    <div className="space-y-4">
      {error && <Notice error>{error.message}</Notice>}
      {isLoading && <p role="status">Carregando histórico…</p>}
      {data && (
        <>
          <div className="divide-y divide-newTableBorder rounded-2xl border border-newTableBorder bg-newBgColorInner">
            {data.items.map((item) => (
              <article key={item.id} className="space-y-1 p-5">
                <div className="flex flex-wrap justify-between gap-2">
                  <h2 className="font-semibold">
                    {actionNames[item.action] || item.action}
                  </h2>
                  <time className="text-xs text-textItemBlur">
                    {date(item.createdAt)}
                  </time>
                </div>
                <p className="text-sm">Por {item.actorEmail}</p>
                <p className="break-all text-xs text-textItemBlur">
                  {item.details?.name ? `${item.details.name} · ` : ''}
                  {item.targetType}: {item.targetId}
                </p>
                {item.reason && (
                  <p className="text-sm">Motivo: {item.reason}</p>
                )}
              </article>
            ))}
            {!data.items.length && (
              <p className="p-8 text-center text-textItemBlur">
                Nenhuma alteração registrada.
              </p>
            )}
          </div>
          <Pager {...data} onChange={setPage} />
        </>
      )}
    </div>
  );
}

interface DeletionPreview {
  id: string;
  name: string;
  posts: number;
  socialAccounts: number;
  media: number;
  deletedUsers: number;
  preservedUsers: number;
  hasExternalBilling: boolean;
  blocker: string | null;
}

function DeleteOrganizationDialog({
  organization,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  organization: Organization;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (path: string, body: unknown, method?: string) => Promise<boolean>;
}) {
  const [confirmation, setConfirmation] = useState('');
  const {
    data,
    error: previewError,
    isLoading,
    mutate,
  } = useAdminData<DeletionPreview>(
    `/organizations/${encodeURIComponent(organization.id)}/deletion-preview`
  );
  const allowed =
    !!data &&
    !data.blocker &&
    confirmation === data.name &&
    !previewError &&
    !busy;
  return (
    <Dialog
      title="Excluir organização permanentemente"
      onClose={onClose}
      busy={busy}
    >
      <form
        className="space-y-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            allowed &&
            (await onSubmit(
              `/organizations/${encodeURIComponent(organization.id)}`,
              { confirmation },
              'DELETE'
            ))
          )
            onClose();
        }}
      >
        <p className="text-sm text-red-400">
          Esta ação é definitiva e não pode ser desfeita. Não será criada uma
          cópia de recuperação.
        </p>
        <p className="break-all font-semibold">
          {data?.name || organization.name}
        </p>
        <p className="break-all text-xs text-textItemBlur">
          ID: {organization.id}
        </p>
        {isLoading && <p role="status">Conferindo os dados vinculados…</p>}
        {previewError && (
          <Notice error>
            {previewError.message}{' '}
            <button
              type="button"
              className="underline"
              onClick={() => mutate()}
            >
              Tentar novamente
            </button>
          </Notice>
        )}
        {data && (
          <>
            <ul className="space-y-1 rounded-xl border border-newTableBorder p-4 text-sm">
              <li>{data.posts} registros de publicações</li>
              <li>
                {data.socialAccounts} contas de redes sociais e credenciais
              </li>
              <li>
                {data.media} itens de mídia, incluindo os arquivos próprios
                armazenados
              </li>
              <li>{data.deletedUsers} usuários exclusivos serão excluídos</li>
              <li>
                {data.preservedUsers} usuários compartilhados ou administrativos
                serão preservados
              </li>
            </ul>
            <p className="text-sm text-textItemBlur">
              Agendamentos, automações, vínculos e demais dados desta
              organização serão removidos. A organização ficará bloqueada
              durante a limpeza e sairá da lista ao concluir.
            </p>
            <p className="text-sm text-textItemBlur">
              Publicações já feitas nas redes sociais não são removidas por esta
              ação.
            </p>
            {data.hasExternalBilling && (
              <Notice error>
                Confira e cancele eventuais cobranças no serviço de pagamentos.
                A exclusão da organização não cancela cobranças externas.
              </Notice>
            )}
            {data.blocker && <Notice error>{data.blocker}</Notice>}
            <label className="block space-y-2">
              <span className="block text-sm">
                Digite exatamente{' '}
                <strong className="break-all">{data.name}</strong> para
                confirmar:
              </span>
              <input
                aria-label="Nome da organização para confirmar exclusão"
                autoComplete="off"
                spellCheck={false}
                maxLength={500}
                required
                className={inputClass}
                value={confirmation}
                disabled={busy || !!data.blocker}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
          </>
        )}
        {error && <Notice error>{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-3 border-t border-newTableBorder pt-4">
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!allowed}
            className={`${buttonClass} border-transparent bg-red-600 text-white hover:bg-red-700`}
          >
            {busy ? 'Iniciando exclusão…' : 'Excluir permanentemente'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ActionForm({
  operation,
  busy,
  onSubmit,
  onClose,
  error,
}: {
  operation: Exclude<Operation, { kind: 'delete' }>;
  busy: boolean;
  onSubmit: (path: string, body: unknown, method?: string) => Promise<boolean>;
  onClose: () => void;
  error: string;
}) {
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [entityId, setEntityId] = useState('');
  const [newOwner, setNewOwner] = useState(false);
  const [ownerName, setOwnerName] = useState('');
  const [role, setRole] = useState('USER');
  const title =
    operation.kind === 'organization'
      ? 'Nova organização'
      : operation.kind === 'user'
      ? 'Novo usuário'
      : operation.kind === 'suspend'
      ? operation.organization.suspendedAt
        ? 'Reativar organização'
        : 'Suspender organização'
      : operation.kind === 'disable'
      ? operation.user.disabledAt
        ? 'Desbloquear usuário'
        : 'Bloquear usuário'
      : operation.user.isPlatformAdmin
      ? 'Revogar administrador global'
      : 'Autorizar administrador global';
  async function submit(event: FormEvent) {
    event.preventDefault();
    let path: string;
    let body: unknown;
    let method = 'PATCH';
    if (operation.kind === 'suspend') {
      path = `/organizations/${encodeURIComponent(
        operation.organization.id
      )}/suspension`;
      body = { suspended: !operation.organization.suspendedAt, reason };
    } else if (operation.kind === 'disable') {
      path = `/users/${encodeURIComponent(operation.user.id)}/status`;
      body = { disabled: !operation.user.disabledAt, reason };
    } else if (operation.kind === 'admin') {
      path = `/users/${encodeURIComponent(operation.user.id)}/admin`;
      body = { enabled: !operation.user.isPlatformAdmin };
    } else if (operation.kind === 'organization') {
      path = '/organizations';
      body = newOwner
        ? { name, ownerName, ownerEmail: email, ownerPassword: password }
        : { name, ownerUserId: entityId };
      method = 'POST';
    } else {
      path = '/users';
      body = { name, email, password, organizationId: entityId, role };
      method = 'POST';
    }
    if (await onSubmit(path, body, method)) {
      setPassword('');
      onClose();
    }
  }
  return (
    <Dialog title={title} onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={busy} className="space-y-4">
          {operation.kind === 'suspend' && (
            <>
              <p className="text-sm font-semibold">
                {operation.organization.name}
              </p>
              <p className="text-sm text-textItemBlur">
                {operation.organization.suspendedAt
                  ? 'O acesso será restabelecido. Posts que perderam o horário ficarão como rascunhos para revisão e reagendamento. Horários futuros continuam programados.'
                  : 'Os membros perderão o acesso à organização e suas publicações serão pausadas. Os dados serão preservados.'}
              </p>
            </>
          )}
          {operation.kind === 'disable' && (
            <>
              <p className="text-sm font-semibold">{operation.user.email}</p>
              <p className="text-sm text-textItemBlur">
                {operation.user.disabledAt
                  ? 'O usuário poderá acessar novamente suas organizações ativas.'
                  : 'O bloqueio impede novas entradas e o uso de sessões abertas em todas as organizações. As publicações da organização continuam; para pausá-las, suspenda a organização.'}
              </p>
            </>
          )}
          {operation.kind === 'admin' && (
            <>
              <p className="text-sm font-semibold">{operation.user.email}</p>
              <p className="text-sm text-textItemBlur">
                {operation.user.isPlatformAdmin
                  ? 'Este usuário perderá o acesso ao painel administrativo global.'
                  : 'Este usuário poderá visualizar todas as organizações e usuários, suspender clientes e alterar as configurações da plataforma.'}
              </p>
            </>
          )}
          {(operation.kind === 'suspend' || operation.kind === 'disable') && (
            <label className="block space-y-2">
              <span className="text-sm font-semibold">Motivo</span>
              <textarea
                maxLength={500}
                required={
                  (operation.kind === 'suspend' &&
                    !operation.organization.suspendedAt) ||
                  (operation.kind === 'disable' && !operation.user.disabledAt)
                }
                className={inputClass}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
          {(operation.kind === 'organization' || operation.kind === 'user') && (
            <label className="block space-y-2">
              <span className="text-sm font-semibold">
                {operation.kind === 'organization'
                  ? 'Nome da organização'
                  : 'Nome do usuário'}
              </span>
              <input
                required
                maxLength={160}
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          {operation.kind === 'organization' && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">
                Responsável pela organização
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={newOwner}
                  onChange={(e) => setNewOwner(e.target.checked)}
                />
                Cadastrar um novo responsável
              </label>
              {newOwner ? (
                <div className="space-y-3">
                  <label className="block space-y-2">
                    <span className="text-sm">Nome do responsável</span>
                    <input
                      className={inputClass}
                      required
                      maxLength={160}
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm">E-mail do responsável</span>
                    <input
                      type="email"
                      className={inputClass}
                      required
                      maxLength={254}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm">
                      Senha inicial do responsável
                    </span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      className={inputClass}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <p className="text-xs text-textItemBlur">
                    O responsável terá acesso à nova organização. Entregue os
                    dados de acesso por um canal seguro.
                  </p>
                </div>
              ) : (
                <Lookup kind="users" value={entityId} onChange={setEntityId} />
              )}
            </div>
          )}
          {operation.kind === 'user' && (
            <>
              <label className="block space-y-2">
                <span className="text-sm font-semibold">E-mail</span>
                <input
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="off"
                  className={inputClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-semibold">
                  Senha inicial (mínimo de 12 caracteres)
                </span>
                <input
                  type="password"
                  minLength={12}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                  className={inputClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <p className="text-xs text-textItemBlur">
                A conta será ativada. Entregue os dados de acesso ao cliente por
                um canal seguro.
              </p>
              <Lookup
                kind="organizations"
                value={entityId}
                onChange={setEntityId}
              />
              <label className="block space-y-2">
                <span className="text-sm font-semibold">
                  Permissão na organização
                </span>
                <select
                  className={inputClass}
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="USER">Membro</option>
                  <option value="ADMIN">Administrador da organização</option>
                </select>
              </label>
            </>
          )}
        </fieldset>
        {error && <Notice error>{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-3 border-t border-newTableBorder pt-4">
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button className={primaryClass} type="submit" disabled={busy}>
            {busy ? 'Salvando…' : 'Confirmar'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function PlatformAdminConsole() {
  const fetch = useFetch();
  const { mutate } = useSWRConfig();
  const {
    data: session,
    error: sessionError,
    isLoading,
    mutate: retrySession,
  } = useAdminData<Session>('/session');
  const [tab, setTab] = useState('overview');
  const [operation, setOperation] = useState<Operation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function save(path: string, body: unknown, method = 'PATCH') {
    if (busy) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await readResponse(
        await fetch(`/platform-admin${path}`, {
          method,
          body: JSON.stringify(body),
        })
      );
      await mutate(
        (key) =>
          typeof key === 'string' &&
          key.startsWith('/platform-admin') &&
          !key.endsWith('/deletion-preview')
      ).catch(() => undefined);
      setNotice(
        method === 'DELETE'
          ? 'Exclusão definitiva iniciada. A organização está bloqueada e sairá da lista quando a limpeza dos dados e arquivos terminar.'
          : 'Alteração salva com sucesso.'
      );
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Não foi possível salvar.'
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  const tabs = [
    ['overview', 'Visão geral'],
    ['organizations', 'Organizações'],
    ['users', 'Usuários'],
    ['settings', 'Configurações'],
    ['audit', 'Histórico'],
  ];
  return (
    <main className="min-h-screen bg-newBgColor px-4 py-6 text-newTextColor sm:px-8">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-newTableBorder bg-newBgColorInner p-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-btnPrimary">
              TrendPostiz · Plataforma
            </p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
              Administração
            </h1>
            <p className="mt-2 text-sm text-textItemBlur">
              Organizações, usuários e controle de acesso em um só lugar.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {session && (
              <span className="text-xs text-textItemBlur">{session.email}</span>
            )}
            <Link href="/launches" className={buttonClass}>
              Voltar à ferramenta
            </Link>
            <Link href="/auth/logout" className={buttonClass}>
              Sair
            </Link>
          </div>
        </header>
        {isLoading && <p role="status">Verificando acesso administrativo…</p>}
        {sessionError && (
          <Notice error>
            {sessionError.message}{' '}
            <button className="underline" onClick={() => retrySession()}>
              Tentar novamente
            </button>
          </Notice>
        )}
        {session && !sessionError && (
          <>
            <nav
              aria-label="Seções administrativas"
              className="flex flex-wrap gap-2"
            >
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  aria-current={tab === key ? 'page' : undefined}
                  onClick={() => {
                    setTab(key);
                    setError('');
                    setNotice('');
                  }}
                  className={tab === key ? primaryClass : buttonClass}
                >
                  {label}
                </button>
              ))}
            </nav>
            {notice && <Notice>{notice}</Notice>}
            {error && !operation && <Notice error>{error}</Notice>}
            {tab === 'overview' && <Overview />}
            {tab === 'organizations' && (
              <Organizations
                canDelete={session.isOwner}
                onAction={(op) => {
                  setError('');
                  setOperation(op);
                }}
              />
            )}
            {tab === 'users' && (
              <Users
                session={session}
                onAction={(op) => {
                  setError('');
                  setOperation(op);
                }}
              />
            )}
            {tab === 'settings' && (
              <SettingsPanel
                busy={busy}
                onSave={(body) => save('/settings', body)}
              />
            )}
            {tab === 'audit' && <AuditPanel />}
            {operation?.kind === 'delete' && (
              <DeleteOrganizationDialog
                organization={operation.organization}
                busy={busy}
                error={error}
                onSubmit={save}
                onClose={() => {
                  setOperation(null);
                  setError('');
                }}
              />
            )}
            {operation && operation.kind !== 'delete' && (
              <ActionForm
                operation={operation}
                busy={busy}
                error={error}
                onSubmit={save}
                onClose={() => {
                  setOperation(null);
                  setError('');
                }}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}
