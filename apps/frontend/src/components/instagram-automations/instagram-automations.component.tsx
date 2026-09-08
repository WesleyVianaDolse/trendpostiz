'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import {
  AutomationFormData,
  initialAutomationForm,
  InstagramAccount,
  InstagramAutomation,
  InstagramMedia,
  validateAutomationStep,
} from './types';

const json = async (response: Response) => {
  const data = await response.json();
  if (!response.ok)
    throw new Error(data?.message || 'Não foi possível concluir a operação.');
  return data;
};

const date = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : '—';

const deliveryStatus = (value: string) =>
  ({
    SUCCESS: 'Sucesso',
    FAILED: 'Falhou',
    SKIPPED: 'Ignorado',
    PENDING: 'Pendente',
  }[value] || value);

const Badge = ({
  children,
  ok,
}: {
  children: React.ReactNode;
  ok?: boolean;
}) => (
  <span
    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
      ok
        ? 'bg-emerald-500/15 text-emerald-400'
        : 'bg-white/10 text-newTextColor'
    }`}
  >
    {children}
  </span>
);

const Skeleton = () => (
  <div
    data-testid="automation-skeleton"
    className="animate-pulse rounded-xl border border-newTableBorder bg-newBgColorInner p-5"
  >
    <div className="h-36 rounded-lg bg-white/10" />
    <div className="mt-4 h-5 w-2/3 rounded bg-white/10" />
    <div className="mt-3 h-4 rounded bg-white/10" />
  </div>
);

export function InstagramAutomationsPage() {
  const fetcher = useFetch();
  const toast = useToaster();
  const { data, isLoading, mutate } = useSWR<InstagramAutomation[]>(
    '/instagram-comment-automations',
    (url: string) => fetcher(url).then(json)
  );

  const changeStatus = async (automation: InstagramAutomation) => {
    try {
      await json(
        await fetcher(
          `/instagram-comment-automations/${automation.id}/status`,
          {
            method: 'PATCH',
            body: JSON.stringify({ enabled: !automation.enabled }),
          }
        )
      );
      toast.show(
        automation.enabled ? 'Automação desativada.' : 'Automação ativada.',
        'success'
      );
      await mutate();
    } catch (error) {
      toast.show((error as Error).message, 'warning');
    }
  };

  const remove = async (automation: InstagramAutomation) => {
    if (
      !window.confirm(
        'Excluir esta automação?\n\nEla deixará de responder novos comentários e o histórico será preservado.'
      )
    )
      return;
    try {
      await json(
        await fetcher(`/instagram-comment-automations/${automation.id}`, {
          method: 'DELETE',
        })
      );
      toast.show('Automação desativada e histórico preservado.', 'success');
      await mutate();
    } catch (error) {
      toast.show((error as Error).message, 'warning');
    }
  };

  return (
    <section className="mx-auto w-full max-w-[1400px] p-4 md:p-8">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white md:text-3xl">
            Automações de Comentários
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-newTextColor">
            Responda automaticamente comentários e envie mensagens no Direct com
            base em palavras ou frases.
          </p>
        </div>
        <Link
          href="/instagram/automations/new"
          className="rounded-lg bg-forth px-5 py-3 text-center text-sm font-semibold text-white hover:opacity-90"
        >
          + Nova automação
        </Link>
      </div>
      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {!isLoading && !data?.length && (
        <div className="rounded-2xl border border-dashed border-newTableBorder bg-newBgColorInner px-6 py-16 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-forth/15 text-2xl">
            ◎
          </div>
          <h2 className="text-xl font-semibold text-white">
            Automatize comentários do Instagram
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-newTextColor">
            Escolha um post, defina palavras ou frases e envie respostas
            automáticas no comentário e no Direct.
          </p>
          <Link
            href="/instagram/automations/new"
            className="mt-6 inline-block rounded-lg bg-forth px-5 py-3 text-sm font-semibold text-white"
          >
            Criar primeira automação
          </Link>
        </div>
      )}
      {!!data?.length && (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {data.map((automation) => (
            <article
              key={automation.id}
              className="overflow-hidden rounded-xl border border-newTableBorder bg-newBgColorInner"
            >
              <div className="flex gap-4 p-4">
                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-black/20">
                  {automation.media.thumbnailUrl ? (
                    <img
                      src={automation.media.thumbnailUrl}
                      alt="Post do Instagram"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-newTextColor">
                      Sem imagem
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <Badge ok={automation.enabled}>
                      {automation.enabled ? 'Ativa' : 'Inativa'}
                    </Badge>
                    <Badge>
                      {automation.matchType === 'EXACT'
                        ? 'Exatamente igual'
                        : 'Contém'}
                    </Badge>
                  </div>
                  <p className="mt-2 truncate font-medium text-white">
                    @
                    {automation.integration.profile ||
                      automation.integration.name}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-newTextColor">
                    {automation.media.caption || 'Post sem legenda'}
                  </p>
                  <p className="mt-1 text-xs text-newTextColor">
                    {date(automation.media.timestamp)}
                  </p>
                </div>
              </div>
              <div className="border-y border-newTableBorder px-4 py-3">
                <p className="mb-2 text-xs uppercase tracking-wide text-newTextColor">
                  Gatilhos
                </p>
                <div className="flex flex-wrap gap-2">
                  {automation.triggers.map((trigger) => (
                    <Badge key={trigger.id}>{trigger.phrase}</Badge>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 p-4 text-center">
                <div>
                  <strong className="block text-white">
                    {automation.metrics.executions}
                  </strong>
                  <span className="text-xs text-newTextColor">Execuções</span>
                </div>
                <div>
                  <strong className="block text-emerald-400">
                    {automation.metrics.publicReplies +
                      automation.metrics.privateReplies}
                  </strong>
                  <span className="text-xs text-newTextColor">Sucessos</span>
                </div>
                <div>
                  <strong className="block text-red-400">
                    {automation.metrics.failures}
                  </strong>
                  <span className="text-xs text-newTextColor">Falhas</span>
                </div>
              </div>
              <p className="px-4 pb-3 text-xs text-newTextColor">
                Última execução: {date(automation.metrics.lastExecutionAt)}
              </p>
              <div className="flex flex-wrap gap-2 border-t border-newTableBorder p-3 text-sm">
                <Link
                  href={`/instagram/automations/${automation.id}`}
                  className="rounded-md bg-white/10 px-3 py-2 text-white"
                >
                  Editar
                </Link>
                <button
                  onClick={() => changeStatus(automation)}
                  className="rounded-md bg-white/10 px-3 py-2 text-white"
                >
                  {automation.enabled ? 'Desativar' : 'Ativar'}
                </button>
                <Link
                  href={`/instagram/automations/${automation.id}/executions`}
                  className="rounded-md bg-white/10 px-3 py-2 text-white"
                >
                  Execuções
                </Link>
                <button
                  onClick={() => remove(automation)}
                  className="ml-auto rounded-md px-3 py-2 text-red-400"
                >
                  Excluir
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function InstagramAutomationWizard() {
  const params = useParams<{ id?: string }>();
  const id = params?.id;
  const editing = !!id;
  const fetcher = useFetch();
  const toast = useToaster();
  const router = useRouter();
  const [step, setStep] = useState(editing ? 3 : 1);
  const [form, setForm] = useState<AutomationFormData>(initialAutomationForm);
  const [posts, setPosts] = useState<InstagramMedia[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [postsError, setPostsError] = useState('');
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [saving, setSaving] = useState(false);
  const { data: accounts } = useSWR<InstagramAccount[]>(
    '/instagram-comment-automations/accounts',
    (url: string) => fetcher(url).then(json)
  );
  const { data: existing } = useSWR<InstagramAutomation>(
    editing ? `/instagram-comment-automations/${id}` : null,
    (url: string) => fetcher(url).then(json)
  );
  useEffect(() => {
    if (existing)
      setForm({
        integrationId: existing.integrationId,
        mediaId: existing.mediaId,
        matchType: existing.matchType,
        triggers: existing.triggers.map((t) => t.phrase),
        publicReplyEnabled: existing.publicReplyEnabled,
        publicReplyText: existing.publicReplyText || '',
        privateReplyEnabled: existing.privateReplyEnabled,
        privateReplyText: existing.privateReplyText || '',
        enabled: existing.enabled,
      });
  }, [existing]);
  const account = accounts?.find((item) => item.id === form.integrationId);
  const selectedPost =
    posts.find((item) => item.id === form.mediaId) || existing?.media;
  const loadPosts = async (more = false) => {
    if (!form.integrationId) return;
    setLoadingPosts(true);
    setPostsError('');
    try {
      const suffix =
        more && nextCursor ? `?after=${encodeURIComponent(nextCursor)}` : '';
      const result = await json(
        await fetcher(
          `/instagram-comment-automations/integrations/${form.integrationId}/media${suffix}`
        )
      );
      setPosts((current) =>
        more ? [...current, ...result.items] : result.items
      );
      setNextCursor(result.nextCursor);
    } catch (error) {
      setPostsError((error as Error).message);
    } finally {
      setLoadingPosts(false);
    }
  };
  useEffect(() => {
    if (form.integrationId && !editing) void loadPosts(false);
  }, [form.integrationId]);
  const goNext = () => {
    const error = validateAutomationStep(step, form, account);
    if (error) return toast.show(error, 'warning');
    setStep((value) => Math.min(5, value + 1));
  };
  const save = async () => {
    for (let value = 1; value <= 4; value++) {
      const error = validateAutomationStep(value, form, account);
      if (error) return toast.show(error, 'warning');
    }
    setSaving(true);
    try {
      const body = editing
        ? {
            matchType: form.matchType,
            triggers: form.triggers,
            publicReplyEnabled: form.publicReplyEnabled,
            publicReplyText: form.publicReplyText,
            privateReplyEnabled: form.privateReplyEnabled,
            privateReplyText: form.privateReplyText,
            enabled: form.enabled,
          }
        : form;
      await json(
        await fetcher(
          `/instagram-comment-automations${editing ? `/${id}` : ''}`,
          { method: editing ? 'PUT' : 'POST', body: JSON.stringify(body) }
        )
      );
      toast.show('Automação salva com sucesso.', 'success');
      router.push('/instagram/automations');
    } catch (error) {
      toast.show((error as Error).message, 'warning');
    } finally {
      setSaving(false);
    }
  };
  const steps = ['Conta', 'Post', 'Gatilhos', 'Respostas', 'Revisão'];
  return (
    <section className="mx-auto w-full max-w-5xl p-4 md:p-8">
      <Link href="/instagram/automations" className="text-sm text-newTextColor">
        ← Voltar para automações
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-white">
        {editing ? 'Editar automação' : 'Nova automação'}
      </h1>
      <div className="my-7 grid grid-cols-5 gap-2">
        {steps.map((label, index) => (
          <button
            key={label}
            disabled={!editing && index + 1 > step}
            onClick={() => setStep(index + 1)}
            className={`rounded-lg px-2 py-3 text-xs sm:text-sm ${
              step === index + 1
                ? 'bg-forth text-white'
                : 'bg-newBgColorInner text-newTextColor'
            }`}
          >
            <span className="hidden sm:inline">{index + 1}. </span>
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-[420px] rounded-2xl border border-newTableBorder bg-newBgColorInner p-4 md:p-7">
        {step === 1 && (
          <div>
            <h2 className="text-xl font-semibold text-white">
              Escolha a conta do Instagram
            </h2>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {accounts?.map((item) => (
                <button
                  key={item.id}
                  disabled={!item.capabilities.commentsWebhook}
                  onClick={() =>
                    setForm({ ...form, integrationId: item.id, mediaId: '' })
                  }
                  className={`flex items-center gap-4 rounded-xl border p-4 text-left ${
                    form.integrationId === item.id
                      ? 'border-forth bg-forth/10'
                      : 'border-newTableBorder'
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <div className="h-12 w-12 overflow-hidden rounded-full bg-white/10">
                    {item.picture && (
                      <img
                        src={item.picture}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div>
                    <strong className="text-white">
                      @{item.profile || item.name}
                    </strong>
                    <p className="text-sm text-newTextColor">{item.name}</p>
                    <p className="mt-1 text-xs text-newTextColor">
                      Comentários:{' '}
                      {item.status.comments === 'ACTIVE'
                        ? 'Ativo'
                        : item.status.comments === 'RECONNECT_REQUIRED'
                        ? 'Requer reconexão'
                        : 'Indisponível'}{' '}
                      · Resposta pública:{' '}
                      {item.status.publicReply === 'AVAILABLE'
                        ? 'Disponível'
                        : 'Indisponível'}{' '}
                      · Direct:{' '}
                      {item.status.privateReply === 'AVAILABLE'
                        ? 'Disponível'
                        : 'Indisponível'}
                    </p>
                    {item.capabilities.reconnectRequired && (
                      <p className="mt-2 text-xs text-amber-400">
                        Reconecte esta conta do Instagram para habilitar
                        automações.
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 2 && (
          <div>
            <h2 className="text-xl font-semibold text-white">
              Escolha qualquer post da conta
            </h2>
            <p className="mt-1 text-sm text-newTextColor">
              Posts publicados pelo Instagram, TrendPostiz ou outras
              ferramentas.
            </p>
            {postsError && (
              <div className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">
                {postsError}{' '}
                <button onClick={() => loadPosts(false)} className="underline">
                  Tentar novamente
                </button>
              </div>
            )}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {posts.map((post) => (
                <button
                  key={post.id}
                  onClick={() =>
                    post.automationId
                      ? router.push(
                          `/instagram/automations/${post.automationId}`
                        )
                      : setForm({ ...form, mediaId: post.id })
                  }
                  className={`overflow-hidden rounded-xl border text-left ${
                    form.mediaId === post.id
                      ? 'border-forth ring-2 ring-forth/30'
                      : 'border-newTableBorder'
                  }`}
                >
                  <div className="aspect-square bg-black/20">
                    {post.thumbnailUrl && (
                      <img
                        src={post.thumbnailUrl}
                        alt="Post"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <div className="p-3">
                    <Badge>{post.mediaType || 'POST'}</Badge>
                    <p className="mt-2 line-clamp-2 text-xs text-newTextColor">
                      {post.caption || 'Sem legenda'}
                    </p>
                    {post.automationId && (
                      <p className="mt-2 text-xs font-medium text-amber-400">
                        Já possui automação · Editar
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
            {loadingPosts && (
              <p className="mt-4 text-sm text-newTextColor">
                Carregando posts…
              </p>
            )}
            {nextCursor && !loadingPosts && (
              <button
                onClick={() => loadPosts(true)}
                className="mt-5 rounded-lg bg-white/10 px-4 py-2 text-sm text-white"
              >
                Carregar mais
              </button>
            )}
          </div>
        )}
        {step === 3 && (
          <div>
            <h2 className="text-xl font-semibold text-white">
              Defina os gatilhos
            </h2>
            <p className="mt-1 text-sm text-newTextColor">
              Adicione palavras ou frases que iniciam a automação.
            </p>
            <div className="mt-5 space-y-3">
              {form.triggers.map((trigger, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    aria-label={`Gatilho ${index + 1}`}
                    value={trigger}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        triggers: form.triggers.map((value, position) =>
                          position === index ? event.target.value : value
                        ),
                      })
                    }
                    placeholder="Ex.: EU QUERO"
                    className="w-full rounded-lg border border-newTableBorder bg-transparent px-4 py-3 text-white outline-none focus:border-forth"
                  />
                  <button
                    aria-label="Remover gatilho"
                    disabled={form.triggers.length === 1}
                    onClick={() =>
                      setForm({
                        ...form,
                        triggers: form.triggers.filter(
                          (_, position) => position !== index
                        ),
                      })
                    }
                    className="px-3 text-red-400"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() =>
                setForm({ ...form, triggers: [...form.triggers, ''] })
              }
              className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-sm text-white"
            >
              + Adicionar gatilho
            </button>
            <h3 className="mt-8 font-medium text-white">
              Como identificar o comentário?
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {(['CONTAINS', 'EXACT'] as const).map((type) => (
                <label
                  key={type}
                  className={`cursor-pointer rounded-xl border p-4 ${
                    form.matchType === type
                      ? 'border-forth bg-forth/10'
                      : 'border-newTableBorder'
                  }`}
                >
                  <input
                    type="radio"
                    className="mr-2"
                    checked={form.matchType === type}
                    onChange={() => setForm({ ...form, matchType: type })}
                  />
                  <strong className="text-white">
                    {type === 'CONTAINS' ? 'Contém' : 'Exatamente igual'}
                  </strong>
                  <p className="mt-2 text-sm text-newTextColor">
                    {type === 'CONTAINS'
                      ? 'Ativa quando o comentário contém uma das frases.'
                      : 'Ativa somente quando o comentário é exatamente igual ao gatilho.'}
                  </p>
                </label>
              ))}
            </div>
          </div>
        )}
        {step === 4 && (
          <div>
            <h2 className="text-xl font-semibold text-white">
              Configure as respostas
            </h2>
            <ResponseField
              title="Responder comentário publicamente"
              checked={form.publicReplyEnabled}
              onChecked={(value) =>
                setForm({ ...form, publicReplyEnabled: value })
              }
              value={form.publicReplyText}
              onValue={(value) => setForm({ ...form, publicReplyText: value })}
              placeholder="Dá uma olhadinha no seu direct! 👀"
            />
            <ResponseField
              title="Enviar mensagem no Direct"
              checked={form.privateReplyEnabled}
              onChecked={(value) =>
                setForm({ ...form, privateReplyEnabled: value })
              }
              value={form.privateReplyText}
              onValue={(value) => setForm({ ...form, privateReplyText: value })}
              placeholder="Oi! Aqui está o que você pediu: https://..."
              warning={
                !account?.capabilities.privateReply
                  ? 'O Direct não está disponível para esta conta.'
                  : undefined
              }
            />
            <div className="mt-6 rounded-xl border border-newTableBorder p-4 text-sm text-newTextColor">
              ✓ Enviar somente uma vez por usuário
              <br />
              <span className="text-xs">
                Cada pessoa receberá esta automação apenas uma vez neste post.
              </span>
            </div>
          </div>
        )}
        {step === 5 && (
          <div>
            <h2 className="text-xl font-semibold text-white">
              Revise sua automação
            </h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Summary
                label="Conta"
                value={`@${
                  account?.profile ||
                  existing?.integration.profile ||
                  account?.name ||
                  ''
                }`}
              />
              <Summary
                label="Correspondência"
                value={
                  form.matchType === 'CONTAINS' ? 'Contém' : 'Exatamente igual'
                }
              />
              <Summary
                label="Gatilhos"
                value={form.triggers.filter(Boolean).join(' · ')}
              />
              <Summary
                label="Status"
                value={form.enabled ? 'Ativa' : 'Inativa'}
              />
              <Summary
                label="Resposta pública"
                value={
                  form.publicReplyEnabled
                    ? form.publicReplyText
                    : 'Desabilitada'
                }
              />
              <Summary
                label="Direct"
                value={
                  form.privateReplyEnabled
                    ? form.privateReplyText
                    : 'Desabilitado'
                }
              />
            </div>
            {selectedPost && (
              <div className="mt-5 flex gap-4 rounded-xl border border-newTableBorder p-4">
                {selectedPost.thumbnailUrl && (
                  <img
                    src={selectedPost.thumbnailUrl}
                    alt="Post selecionado"
                    className="h-20 w-20 rounded-lg object-cover"
                  />
                )}
                <p className="line-clamp-3 text-sm text-newTextColor">
                  {selectedPost.caption || 'Post sem legenda'}
                </p>
              </div>
            )}
            <label className="mt-6 flex items-center gap-3 text-sm text-white">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) =>
                  setForm({ ...form, enabled: event.target.checked })
                }
              />{' '}
              Ativar automação agora
            </label>
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-between">
        <button
          disabled={step === 1 || (editing && step === 3)}
          onClick={() => setStep((value) => value - 1)}
          className="rounded-lg bg-white/10 px-5 py-3 text-sm text-white disabled:opacity-30"
        >
          Voltar
        </button>
        {step < 5 ? (
          <button
            onClick={goNext}
            className="rounded-lg bg-forth px-5 py-3 text-sm font-semibold text-white"
          >
            Continuar
          </button>
        ) : (
          <button
            disabled={saving}
            onClick={save}
            className="rounded-lg bg-forth px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar automação'}
          </button>
        )}
      </div>
    </section>
  );
}

function ResponseField({
  title,
  checked,
  onChecked,
  value,
  onValue,
  placeholder,
  warning,
}: {
  title: string;
  checked: boolean;
  onChecked: (v: boolean) => void;
  value: string;
  onValue: (v: string) => void;
  placeholder: string;
  warning?: string;
}) {
  return (
    <div className="mt-6 rounded-xl border border-newTableBorder p-4">
      <label className="flex items-center justify-between font-medium text-white">
        <span>{title}</span>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChecked(event.target.checked)}
        />
      </label>
      {warning && <p className="mt-2 text-xs text-amber-400">{warning}</p>}
      {checked && (
        <>
          <textarea
            value={value}
            onChange={(event) => onValue(event.target.value)}
            placeholder={placeholder}
            rows={4}
            className="mt-3 w-full resize-y rounded-lg border border-newTableBorder bg-transparent p-3 text-white outline-none focus:border-forth"
          />
          <p className="mt-1 text-right text-xs text-newTextColor">
            {value.length} caracteres
          </p>
        </>
      )}
    </div>
  );
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-newTableBorder p-4">
      <p className="text-xs uppercase tracking-wide text-newTextColor">
        {label}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm text-white">
        {value || '—'}
      </p>
    </div>
  );
}

export function InstagramAutomationExecutions() {
  const { id } = useParams<{ id: string }>();
  const fetcher = useFetch();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSWR(
    `/instagram-comment-automations/${id}/executions?page=${page}&limit=20`,
    (url: string) => fetcher(url).then(json)
  );
  const cards = useMemo(() => data?.items || [], [data]);
  return (
    <section className="mx-auto w-full max-w-6xl p-4 md:p-8">
      <Link href="/instagram/automations" className="text-sm text-newTextColor">
        ← Voltar para automações
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-white">
        Histórico de execuções
      </h1>
      {isLoading ? (
        <div className="mt-6">
          <Skeleton />
        </div>
      ) : !cards.length ? (
        <div className="mt-6 rounded-xl border border-dashed border-newTableBorder p-12 text-center text-newTextColor">
          Ainda não há execuções para esta automação.
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {cards.map((item: any) => (
            <article
              key={item.id}
              className="rounded-xl border border-newTableBorder bg-newBgColorInner p-4"
            >
              <div className="flex flex-col justify-between gap-3 sm:flex-row">
                <div>
                  <strong className="text-white">
                    @{item.webhookEvent?.authorUsername || item.authorId}
                  </strong>
                  <p className="mt-1 text-sm text-newTextColor">
                    {item.webhookEvent?.commentText ||
                      'Comentário indisponível'}
                  </p>
                </div>
                <span className="text-xs text-newTextColor">
                  {date(item.createdAt)}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge ok={item.publicReplyStatus === 'SUCCESS'}>
                  Resposta pública: {deliveryStatus(item.publicReplyStatus)}
                </Badge>
                <Badge ok={item.privateReplyStatus === 'SUCCESS'}>
                  Direct: {deliveryStatus(item.privateReplyStatus)}
                </Badge>
              </div>
              <p className="mt-3 text-xs text-newTextColor">
                Processada em: {date(item.processedAt)}
              </p>
              {(item.publicReplyError || item.privateReplyError) && (
                <details className="mt-3 text-sm text-red-300">
                  <summary>Ver detalhes</summary>
                  <p className="mt-2">
                    {item.publicReplyError || item.privateReplyError}
                  </p>
                </details>
              )}
            </article>
          ))}
        </div>
      )}
      <div className="mt-5 flex gap-2">
        <button
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
          className="rounded bg-white/10 px-3 py-2 text-sm text-white disabled:opacity-30"
        >
          Anterior
        </button>
        <button
          disabled={!data || page >= data.pages}
          onClick={() => setPage(page + 1)}
          className="rounded bg-white/10 px-3 py-2 text-sm text-white disabled:opacity-30"
        >
          Próxima
        </button>
      </div>
    </section>
  );
}
