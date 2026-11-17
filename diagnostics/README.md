# Diagnósticos locais

Os diretórios separam programas de diagnóstico e evidências por finalidade. A presença de um script não autoriza executá-lo contra produção.

| Diretório | Conteúdo e uso |
| --- | --- |
| `repository-review/` | Inventário Git, recibo do snapshot externo, limpeza de caches e proposta de preservação. [Relatório](repository-review/README.md). |
| `recovery/` | Harnesses isolados, fixtures sintéticos e resultados históricos de R01–R31; `archive/` preserva estados anteriores. |
| `temporal-startup/` | Investigação histórica de startup e recursos do Temporal. |
| `instagram-regression/` | Evidências da comparação v1.7.3/v1.7.4. |
| `instagram-business-discovery/` | Material técnico da integração tradicional. |

O [estado atual da v1.7.5](../docs/v1.7.5/README.md) prevalece para orientação sobre pendências e autorização. Logs, JSONs e manifests antigos não provam o estado atual da VPS nem a disponibilidade atual de imagens locais.

Os caminhos existentes foram mantidos: fixtures fazem imports relativos e relatórios referenciam arquivos por nome. Logs sem conteúdo e manifests semelhantes só devem ser removidos após revisão das dependências e aprovação. Não incluir `.env`, chaves, exports de clientes ou conteúdo de `tmp/` em commits ou em evidências compartilhadas.
