// Run explicitly after applying the schema. Never promotes the first registrant automatically.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

async function main() {
  const args = process.argv.slice(2);
  const email = args[0]?.trim().toLowerCase();
  const provider = args[1];
  if (!email || args.length > 2)
    throw new Error(
      'Uso: node scripts/initialize-platform-admin.cjs EMAIL [LOCAL|GOOGLE|GENERIC|...]'
    );
  const db = new PrismaClient();
  try {
    const result = await db.$transaction(
      async (tx) => {
        const existing = await tx.platformSettings.findUnique({
          where: { id: 'platform' },
        });
        const users = await tx.user.findMany({
          where: {
            email: { equals: email, mode: 'insensitive' },
            ...(provider ? { providerName: provider } : {}),
          },
          select: { id: true, email: true, activated: true, disabledAt: true },
        });
        if (users.length !== 1)
          throw new Error(
            'A seleção deve corresponder a exatamente uma conta. Se o e-mail existir em mais de um provedor, informe o provedor.'
          );
        const user = users[0];
        if (existing) {
          if (existing.ownerUserId === user.id)
            return 'O titular já está configurado. Nenhuma alteração realizada.';
          throw new Error(
            'O titular já foi configurado. Este comando não transfere acesso nem promove outra conta.'
          );
        }
        if (!user.activated || user.disabledAt)
          throw new Error('A conta precisa estar ativa e desbloqueada.');
        if (await tx.user.count({ where: { isPlatformAdmin: true } }))
          throw new Error(
            'Já existe um administrador global. Revise a configuração antes de inicializar.'
          );
        await tx.user.update({
          where: { id: user.id },
          data: { isPlatformAdmin: true },
        });
        await tx.platformSettings.create({
          data: {
            id: 'platform',
            ownerUserId: user.id,
            registrationEnabled: process.env.DISABLE_REGISTRATION !== 'true',
            organizationCreationEnabled: true,
          },
        });
        await tx.adminAuditLog.create({
          data: {
            actorId: user.id,
            action: 'admin.initialize',
            targetType: 'user',
            targetId: user.id,
          },
        });
        return 'Administrador global inicial configurado. Acesse /administration com a conta selecionada.';
      },
      { isolationLevel: 'Serializable' }
    );
    console.log(result);
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  // Do not print Prisma connection strings, query payloads or stacks.
  console.error(
    error.code
      ? 'Falha no banco ao inicializar o administrador. Verifique a migração e a conexão.'
      : error.message
  );
  process.exitCode = 1;
});
