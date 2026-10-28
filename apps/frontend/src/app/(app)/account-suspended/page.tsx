import Link from 'next/link';

export default function SuspendedAccountPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-5 px-6 text-newTextColor">
      <p className="text-sm font-semibold text-btnPrimary">TrendPostiz</p>
      <h1 className="text-3xl font-bold">Acesso suspenso</h1>
      <p>
        Sua conta ou organização está suspensa. Entre em contato com o
        administrador da plataforma para regularizar o acesso.
      </p>
      <p className="text-sm text-textItemBlur">
        Os dados foram preservados. Após a reativação, posts que perderam o
        horário precisam ser revisados e reagendados.
      </p>
      <Link
        href="/launches"
        className="rounded-lg bg-btnPrimary px-4 py-3 text-center text-white"
      >
        Verificar acesso novamente
      </Link>
      <Link href="/administration" className="text-sm underline">
        Painel do administrador global
      </Link>
      <Link href="/auth/logout" className="text-sm underline">
        Sair da conta
      </Link>
    </main>
  );
}
