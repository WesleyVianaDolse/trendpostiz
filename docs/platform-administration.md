# Administração da plataforma

O painel fica em `/administration`. O acesso é global e separado das permissões `USER`, `ADMIN` e `SUPERADMIN` de cada organização. O campo novo `User.isPlatformAdmin` não reutiliza nem concede a permissão legada de impersonação (`isSuperAdmin`).

O painel sempre verifica a identidade original do usuário autenticado. Cookies de impersonação de organizações não concedem permissões nem mudam o autor registrado nas ações administrativas.

## Comportamento

- Visão geral com usuários, organizações, contas sociais, suspensões e posts pausados.
- Listas paginadas e busca por nome, e-mail ou ID; detalhes de membros e contas sociais de uma organização.
- Suspensão manual por organização, com motivo, bloqueio das sessões existentes, API pública e MCP. Quem pertence a outra organização ativa mantém o acesso àquela organização.
- Bloqueio individual de usuário em todas as organizações. Isso não pausa as publicações da organização; para esse fim, suspenda a organização.
- Pausa dos posts que já estavam agendados, incluindo verificações no executor imediatamente antes da chamada ao provedor. Posts que perderem o horário durante a suspensão ficam como rascunhos após a reativação, com aviso no editor. É preciso revisar e reagendar. Posts com horário futuro mantêm a programação.
- Recorrências de posts já publicados também ficam retidas para revisão e novo agendamento; o histórico publicado é preservado. Autopost e respostas automáticas do Instagram não executam ações durante a suspensão. Eventos de comentários recebidos durante a suspensão são descartados, sem resposta retroativa.
- Cadastro público pode ser aberto/fechado pelo painel, sem reinício, em todos os provedores de login. A opção de criação de organizações controla o cadastro público que cria uma organização. Não há criação de organizações adicionais pelo cliente: apenas administradores globais podem criá-las.
- Convites locais para organizações ativas continuam funcionando com cadastro público fechado.
- Criação manual de organizações com responsável existente ou novo responsável; criação de usuários dentro de organizações existentes. Contas locais criadas manualmente já ficam ativadas. O operador define uma senha inicial de pelo menos 12 caracteres e entrega o acesso ao cliente.
- Somente o titular pode conceder/revogar acesso a outros administradores globais. O titular não pode ser despromovido ou bloqueado pelo painel. Para bloquear outro administrador, primeiro revogue a permissão dele.
- As alterações são registradas em `AdminAuditLog`, junto com a identidade de quem as executou. Senhas, tokens de integração, segredos e chaves de API não são retornados nas listagens nem gravados nesse histórico.

A suspensão não remove publicações já feitas e não consegue cancelar uma requisição que já foi enviada e aceita pela rede social. A aplicação confere o estado atual antes de iniciar novas chamadas. Automações externas que já copiaram os dados não são controladas por este painel.

## Ativação no deploy

1. Publique backend, frontend e orchestrator da mesma revisão. O executor também precisa ser atualizado para aplicar a pausa de posts. Não basta atualizar o frontend.
2. Aplique o schema atualizado **antes de iniciar os novos processos**. A alteração é aditiva: novas colunas, duas tabelas e índices; nenhuma exclusão de dados. A migração SQL está em `libraries/nestjs-libraries/src/database/prisma/migrations/20261028000000_platform_administration/migration.sql`.
3. Use o mecanismo de atualização de banco já adotado pela instalação. Instalações que usam `prisma db push` devem continuar com esse fluxo; não introduza `prisma migrate deploy` sem conferir o baseline das migrações anteriores. O comando `pm2-run` atual já executa a atualização do schema antes dos serviços. No build, gere o cliente Prisma a partir do schema novo.
4. Uma única vez, no ambiente da instalação e com sua configuração de banco carregada, execute:

```sh
node scripts/initialize-platform-admin.cjs wesley@trendbyte.com.br
```

Se houver contas do mesmo e-mail em mais de um provedor, o comando para sem conceder acesso; informe o provedor da conta desejada, por exemplo:

```sh
node scripts/initialize-platform-admin.cjs wesley@trendbyte.com.br LOCAL
```

O comando usa o `.env` do diretório atual ou as variáveis do processo. Não aceita a troca do titular depois de inicializado. Repetir para o mesmo titular não altera os dados. A conta precisa já existir, estar ativada e desbloqueada. Nenhum usuário é promovido apenas por cadastrar esse e-mail: a atribuição depende desta inicialização explícita com acesso ao servidor.

5. Entre novamente com a conta selecionada. O login de administradores globais abre `/administration`. Há atalhos no menu da ferramenta e no perfil mobile. O painel funciona mesmo se a organização do administrador estiver suspensa.

Antes da inicialização, a regra de cadastro conserva o valor atual de `DISABLE_REGISTRATION` e a exceção de primeira conta em instalação vazia. Ao inicializar, esse valor é salvo como configuração inicial. Depois disso, o banco passa a ser a fonte das configurações; mudar a variável não sobrepõe o que foi salvo no painel.

## Exclusão definitiva de organizações

Na aba **Organizações**, o titular da plataforma pode clicar em **Excluir**. A tela apresenta uma prévia do impacto e exige digitar exatamente o nome atual da organização; a API confere novamente o nome e a permissão do titular. Administradores delegados não podem iniciar exclusões definitivas.

A operação apaga os registros da organização, vínculos, credenciais, publicações agendadas, automações, eventos de comentários, configurações, histórico administrativo identificável e memória de IA vinculada. Também remove arquivos próprios do armazenamento local ou Cloudflare R2, miniaturas conhecidas, uploads temporários e caches/estados OAuth identificados no Redis. Os agendamentos são encerrados e seus históricos são solicitados para exclusão no Temporal. Não há exportação, arquivo de recuperação ou opção de desfazer.

Usuários exclusivos da organização são excluídos. Contas compartilhadas com outras organizações e contas administrativas são preservadas; suas imagens de perfil podem ser desvinculadas se pertencerem à organização excluída. Arquivos que também possuem registro de propriedade em outra organização são preservados para aquele cliente. Relações opcionais em registros de outras organizações são desvinculadas; seu conteúdo é preservado. Pedidos/conversas do marketplace que impedem a separação entre organizações bloqueiam a operação antes de iniciá-la.

A exclusão ocorre em etapas. A organização é bloqueada imediatamente e aparece como **Exclusão em andamento** até terminar. O backend remove primeiro os dados externos e arquivos e só então conclui a remoção dos registros em uma transação. Falhas deixam uma mensagem de pendência; o backend tenta novamente e o titular também pode usar **Tentar exclusão novamente**. Reiniciar o servidor não perde a solicitação: apenas o estado da operação fica na própria organização até sua eliminação, sem criar cópia dos dados.

O registro técnico final contém o autor administrativo, data, contagens e ID opaco, sem nome, e-mail ou conteúdo do cliente removido. Publicações já feitas nas redes sociais, cobrança em provedores de pagamento, exportações manuais, backups e logs de infraestrutura externos não são apagados por este botão. Esses serviços precisam de tratamento próprio quando fizerem parte da solicitação de eliminação.

Esta alteração exige aplicar o schema com as novas colunas de controle em `Organization`, incluídas na migração `20261028010000_organization_deletion`, e atualizar backend e frontend. A permissão do titular já configurada não precisa ser inicializada novamente. A limpeza física no R2 foi implementada no método `CloudflareStorage.removeFile`.

Os testes de integração usam somente um PostgreSQL local descartável com nome de banco/usuário `deletion_test`, passado explicitamente em `ORGANIZATION_DELETION_TEST_DATABASE_URL`; eles ficam desabilitados sem essa variável e recusam URLs de produção. Os arquivos usados nos testes são fictícios e ficam em diretórios temporários próprios.

Validação da exclusão em 28/10/2026: 37 testes aprovados, incluindo quatro testes com PostgreSQL isolado e arquivos físicos locais, limpeza de memória/rastros de IA identificados, falha e nova tentativa, e proteção de outra organização. Chamadas do Cloudflare, Temporal e Redis foram verificadas com mocks, sem acessar serviços de produção. A confirmação foi exercitada em navegador no desktop/celular, e o build padrão de produção do frontend e as checagens de tipos foram aprovados.

## Verificações

```sh
pnpm exec jest --config apps/backend/jest.platform-admin.config.cjs --runInBand
pnpm exec tsc --project apps/frontend/tsconfig.json --noEmit --incremental false
pnpm exec tsc --project apps/backend/tsconfig.build.json --noEmit --incremental false
pnpm exec tsc --project apps/orchestrator/tsconfig.build.json --noEmit --incremental false
```

Teste de homologação com dados descartáveis: criar cliente e responsável; fechar cadastros públicos; aceitar convite em organização existente; agendar posts para durante/depois da suspensão; suspender; verificar bloqueio de sessão/API e ausência de envio; reativar; confirmar rascunhos vencidos e execução dos horários futuros; revisar/reagendar um rascunho; conferir o histórico e a revogação de um administrador delegado.

As verificações locais não aplicam migrações, não atribuem permissões a contas reais e não executam publicações reais.

Validação local em 28/10/2026: build padrão do frontend concluído; checagens de tipos do frontend, backend e orchestrator aprovadas; schema Prisma validado e SQL conferido por diff entre schemas; 28 testes novos e 37 testes de regressão aprovados. A interface foi exercitada em navegador com dados simulados, em desktop e celular, incluindo suspensão, cadastro de cliente com responsável, configurações, proteção do titular e acesso negado. Ainda é necessária a homologação do fluxo completo com um banco de teste antes do release.

Durante o build foi corrigido também o empacotamento do sanitizador do preview público: `isomorphic-dompurify` fica externo ao bundle de servidor em `next.config.js`, preservando os arquivos internos de `jsdom`. O sanitizador foi conferido com conteúdo de script e links inseguros; suas regras de sanitização foram preservadas.
