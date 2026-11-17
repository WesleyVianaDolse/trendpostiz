# Scripts de manutenção

| Caminho | Finalidade |
| --- | --- |
| `initialize-platform-admin.cjs` | Administração da plataforma; mantido sem alterações. |
| `recovery/r28-infrastructure-readonly.py` | Coletor R28 somente de leitura, com sidecar SHA-256. Não foi executado na VPS neste trabalho. |
| `recovery/verify-owned-chain.cjs` | Verificação local dos hashes e da fronteira da cadeia Prisma-owned. |
| `recovery/inventory-dry-run.cjs` | Preparação de inventário de recuperação; não é autorização de aplicação. |
| `recovery/review-artifact.cjs`, `recovery/runtime-artifact.cjs` | Contratos de artefato/revisão; caminhos e conteúdo vinculados a hashes. |
| `recovery/preflight.cjs`, `recovery/deny-shared-schema-push.cjs` | Barreiras locais do desenvolvimento de recuperação. O preflight impede o startup normal. |
| `recovery/watchdog-observe.cjs`, exemplos systemd | Observação externa, sem autorização de reinício ou ativação. |

Os testes correspondentes ficam em `diagnostics/recovery/`. A documentação principal está em [docs/v1.7.5/README.md](../docs/v1.7.5/README.md). Nenhum script foi movido durante a limpeza: imports, hashes e chamadas de package.json continuam nos caminhos existentes.
