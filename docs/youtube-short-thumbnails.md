# Capas personalizadas do YouTube e Shorts

Implementação baseada na [revisão de 03/11/2026](https://developers.google.com/youtube/data/revision_history), em [thumbnails.set](https://developers.google.com/youtube/data/reference/rest/v3/thumbnails/set), em [videos.list](https://developers.google.com/youtube/data/reference/rest/v3/videos/list) e no recurso [thumbnails](https://developers.google.com/youtube/data/reference/rest/v3/thumbnails).

## Caminho completo

| Etapa | Implementação |
| --- | --- |
| Seleção | `YoutubeThumbnailPicker` reutiliza `MediaComponent` e a biblioteca/editor existentes, no formulário completo e em `Publisher/ProviderSettings` (criação e edição de agendamentos). |
| Formato | `settings.thumbnailLayout` representa intenção editorial: `short` apresenta editor 1080×1920 e prévia de corte 9:16; `standard` mantém editor 1280×720. A prévia não altera o vídeo nem garante o enquadramento final do YouTube. |
| Classificação | Não existia um campo confiável de classificação como Short no repositório. A escolha de layout não classifica o vídeo, não acrescenta hashtags e não usa orientação vertical como prova. Por segurança, toda capa aguarda processamento, inclusive quando o layout é padrão. |
| Validação | A seleção verifica assinatura JPEG/PNG e tamanho até 50 MiB; o worker repete a validação nos bytes baixados e limita o download. A API ainda valida o conteúdo da imagem. |
| Persistência/agendamento | O arquivo usa a infraestrutura de mídia existente. `settings.thumbnail` guarda `{id,path}` em `Post.settings`; os payloads do Publisher e da edição preservam esse objeto e o layout. `media[0].thumbnail` continua como fallback, com precedência da capa por conta. |
| Upload | `PostActivity.postSocial` usa `YoutubePublicationService` exclusivamente para YouTube. Um claim atômico registra `youtubeUploadKey`/`youtubeUploadState` antes de `videos.insert`. O callback do provider grava `youtubeVideoId`, `releaseId` e `releaseURL` imediatamente após receber o ID. |
| Capa | O workflow independente `youtubeThumbnailWorkflow`, na fila `youtube`, chama `videos.list(part=processingDetails,id=videoId)` com a conta autorizada. Só chama `thumbnails.set` quando o resultado é `succeeded`. Não chama `videos.update`. |
| Publicação/erros | A publicação do vídeo segue o fluxo existente para `PUBLISHED`. Falhas da capa são registradas em campos separados e não invalidam o vídeo. `YoutubeThumbnailStatus` mostra o estado, a mensagem e a tentativa isolada nos detalhes do Publisher e no modal completo. |
| Nova tentativa | `GET /posts/:id/youtube-thumbnail` e `POST /posts/:id/youtube-thumbnail/retry` verificam organização e provider. A nova tentativa usa o `videoId` persistido e nunca chama `videos.insert`. |

## Estados e limites

- `pending`: processamento não confirmado, inclusive quando `processingDetails` estiver ausente. Nenhuma chamada prematura a `thumbnails.set`.
- `retrying`: falha transitória de rede, HTTP 408/429/5xx ou 403 por limite de taxa. Backoff exponencial e respeito a `Retry-After`.
- `applying` / `applied`: claim atômico antes do envio e confirmação após resposta bem-sucedida. Uma capa confirmada não é reenviada automaticamente.
- `failed`: processamento `failed`/`terminated`, imagem inválida, vídeo ausente, 403 por permissão ou autorização que não pôde ser renovada. A mensagem orienta corrigir a causa antes da tentativa isolada.
- `waiting`: limite de tentativas, quota diária, pausa administrativa ou indisponibilidade ao agendar a capa. Uma quota esgotada preserva o prazo mínimo de 24 horas (ou `Retry-After` maior) antes de permitir nova tentativa manual.
- `uncertain`: um worker perdeu a confirmação do envio. A interface pede conferir a capa no YouTube antes de reenviar, pois outra chamada pode consumir quota.

Cada execução tem até 12 ciclos persistidos. Para processamento pendente, as esperas vão de 30 segundos a 15 minutos; para falhas transitórias, de 1 a 30 minutos. São timers duráveis do Temporal, sem manter o worker ocupado. Cada activity tem timeout de 5 minutos e até 3 tentativas para falhas de infraestrutura; as chamadas Google desabilitam repetição automática do SDK. Consulta, download e envio da capa têm timeouts próprios (20/30/60 segundos). Um 401 permite uma renovação de token e repetição da operação com a mesma conta, sem refazer o upload.

`thumbnails.set` custa aproximadamente 50 unidades. O polling usa somente `videos.list` (1 unidade); não usa envios de thumbnail como teste de processamento. Uma repetição manual inicia outro orçamento limitado de tentativas e pode consumir quota adicional.

O workflow ID de publicação é a chave estável entre repetições de activity e reinícios. Publicações recorrentes intencionais recebem outro workflow ID e podem criar outro vídeo. O ID do workflow da capa inclui o post e o vídeo; `signalWithStart` reúne chamadas concorrentes. Jobs antigos não alteram o estado de um vídeo de outra geração.

Nenhuma API externa fornece uma transação com o banco local. Se o upload perder a resposta ou o checkpoint falhar, o estado `uploading` bloqueia outro upload automático. É necessária reconciliação operacional com o canal antes de liberar esse estado. Não se promete entrega externa exatamente uma vez após uma resposta de rede perdida; o envio da mesma capa ao mesmo vídeo é repetível, mas tem custo de quota. A implementação evita repetir uploads de vídeo e não repete uma capa cuja aplicação foi confirmada.

## Verificação local

```powershell
pnpm exec jest --config apps/backend/jest.instagram-webhook.config.js --runInBand --runTestsByPath libraries/nestjs-libraries/src/integrations/youtube-publication.service.spec.ts apps/orchestrator/src/workflows/youtube-thumbnail.workflow.spec.ts libraries/nestjs-libraries/src/integrations/social/youtube.provider.spec.ts apps/orchestrator/src/activities/post-access.spec.ts apps/orchestrator/src/workflows/post-workflows/post-notification.workflow.spec.ts
pnpm exec jest --config apps/frontend/jest.youtube.config.cjs --runInBand
pnpm exec tsc --noEmit -p apps/frontend/tsconfig.json --pretty false
pnpm exec tsc --noEmit -p apps/orchestrator/tsconfig.json --pretty false
pnpm exec prisma validate --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma
```

Os testes usam APIs e persistência simuladas, sem publicar vídeos. O ambiente DOM focado dispensa o módulo nativo opcional `canvas`, que não é usado nesses testes. O typecheck completo do orchestrator encontra quatro erros anteriores fora desta alteração: `integration.repository.ts:298`, `media.repository.ts:110`, `emails/empty.provider.ts:5` e `short-linking/providers/empty.ts:6`.

## Aplicação e validação com conta real

A migration `20261109000000_youtube_thumbnail_delivery` é aditiva e precisa ser aplicada antes de executar o código atualizado; o Prisma Client também deve ser gerado. Nenhuma migration foi aplicada ao banco durante esta implementação.

Ainda dependem de validação controlada com uma conta real: permissões de thumbnails personalizadas do canal, acesso a `processingDetails` pelo proprietário, tempo real de processamento e classificação de Shorts, comportamento visual do corte 9:16 e diferenças entre superfícies do YouTube, renovação/reconexão OAuth e respostas reais de quota/limite. A exibição da capa em todas as superfícies não é garantida. Não houve deploy nem publicação real para testar.
