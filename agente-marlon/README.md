# Agente comercial IA · equipe Marlon Mattedi (Treino CONTROLE 2.0)

Este agente opera como um time comercial no **WhatsApp** (Cloud API oficial da Meta) e no **telefone**: qualifica o lead, educa, recomenda **um** produto, contorna objeções, envia o link de checkout rastreado (`sck=f4-ia`), agenda consultas e faz o pós-venda. As regras de conformidade (seção 5) ficam numa camada determinística: nenhuma delas depende só do modelo. Veja **[COMPLIANCE.md](COMPLIANCE.md)**.

```
WhatsApp Cloud API ─┐                         ┌─ Hotmart (webhooks)
Twilio / Vapi / ────┼─► Fastify ─► Engine ─────┼─ Google Calendar
Retell (voz)        │      │   (guardrails +  │─ Mercado Pago (consulta)
Quiz / LPs ─────────┘      │    Claude + tools)└─ BullMQ/Redis (cadências)
                           ▼
                Supabase (Postgres) ◄── Painel Next.js (equipe)
```

## Estrutura

| Caminho | O que é |
|---|---|
| `agent/system_prompt.md` | Prompt de sistema (Parte B). `{{AGENT_NAME}}` vem do `.env`. |
| `agent/knowledge/*.md` | Base de conhecimento. `produtos.md` é a **fonte única** de preços e checkouts: o código lê os links dele. |
| `agent/templates.json` | Templates neutros da Meta, usados fora da janela de 24h. |
| `src/agent/engine.ts` | Motor da conversa: guardrails de entrada, modelo, filtro de saída, portão de discrição na voz. |
| `src/agent/guardrails.ts` | Detecção de opt-out, risco, menor de idade, reembolso e "é robô?", mais o filtro de promessas, remédios, urgência e links. |
| `src/agent/tools.ts` | As tools: `buscar_lead`, `enviar_link_checkout`, `listar_horarios`, `agendar_consulta`, `agendar_ligacao`, `agendar_retorno_whatsapp`, `transferir_humano`, `registrar_objecao`, `atualizar_etapa` e `optout`. |
| `src/agent/brain/claude.ts` | Claude (`claude-sonnet-5-5`) com *tool use*, cache de prompt e fallback em caso de recusa. |
| `src/agent/brain/offline.ts` | Cérebro de roteiro, sem API: usado pelo simulador, pela CI e como contingência. |
| `src/compliance/rules.ts` | Janela 9h–20h seg–sáb, 3 tentativas por oportunidade, 1 ligação por dia, consentimento e Não Me Perturbe. |
| `src/queue/` | Cadências (seção 4) e execução dos jobs (BullMQ). |
| `src/voice/` | Adaptador de voz: **Vapi**, **Retell** ou **Twilio Media Streams** + Deepgram + ElevenLabs. Ligação de oferta só pelo **0303**. |
| `src/integrations/` | Hotmart, captura de leads, Google Calendar, Mercado Pago e STT. |
| `src/http/` | Webhooks e API do painel (login, conversas, assumir, métricas, CSV, SSE). |
| `panel/` | Painel interno em Next.js. |
| `tests/scenarios/*.yaml` | 35 cenários de conversa e cadência. |

## Rodando localmente

**Requisitos:** Node 20 ou superior. Postgres e Redis só são necessários para o modo completo.

```bash
npm install
```

```bash
npm --prefix panel install
```

### 1) Simulador no terminal (sem nenhuma chave)

```bash
npm run simulate
```

Sem `ANTHROPIC_API_KEY`, o simulador usa o cérebro offline. Com a chave no `.env`, usa o Claude. `-- --offline` força o modo offline e `-- --voz` começa já numa ligação.

Comandos dentro do simulador: `/voz`, `/whatsapp`, `/botao falar_equipe`, `/consentimento`, `/hotmart PURCHASE_OUT_OF_SHOPPING_CART controle2`, `/tempo +30m`, `/jobs`, `/lead`, `/painel` e `/ajuda`.

### 2) Testes

```bash
npm test
```

```bash
npm run test:scenarios
```

```bash
npm run test:scenarios:live
```

`npm test` roda os testes unitários e HTTP (webhooks, assinatura, painel). `test:scenarios` roda os 35 cenários com o cérebro offline (determinístico). `test:scenarios:live` roda os mesmos cenários com o Claude e exige `ANTHROPIC_API_KEY`.

A suíte reprova o cenário se **qualquer** regra da seção 5 for quebrada:

- link sem `sck=f4-ia`;
- primeira mensagem sem a identificação de assistente virtual;
- promessa, remédio ou urgência falsa;
- template que não é neutro;
- contato depois de um opt-out;
- contato fora da janela;
- ligação sem consentimento ou oferta sem 0303.

### 3) Painel com dados de exemplo (sem chaves)

```bash
npm run demo
```

```bash
npm run panel:dev
```

O demo sobe o backend em memória em http://localhost:3333 com conversas de exemplo. O painel abre em http://localhost:3000, com login `demo@equipe.local` / `demo-senha-123`.

### 4) Modo completo (Postgres + Redis)

```bash
cp .env.example .env
```

```bash
npm run db:push
```

```bash
npm run user:create -- equipe@dominio.com "Nome" "senha-forte-aqui"
```

```bash
npm run dev
```

Depois de copiar o `.env.example`, preencha pelo menos `DATABASE_URL`, `REDIS_URL` e `JWT_SECRET`. O `db:push` cria as tabelas no Supabase.

## Prints

Em [`docs/prints/`](docs/prints):

- `cenarios-offline.txt` e `.html`, com os prints `cenarios-offline-inicio.png` e `-fim.png`: **35/35 cenários passando**, cada um com a transcrição completa.
- `simulador-offline.txt`: sessão do simulador nos dois canais (WhatsApp e voz simulada).
- `painel-conversas.png`, `painel-transferencia.png`, `painel-funil.png` e `painel-ligacoes.png`.

## Deploy (Railway ou Render)

São três peças: o **backend** (Fastify + worker), o **painel** (Next.js) e os serviços gerenciados **Postgres (Supabase)** e **Redis**.

### Railway

1. Crie um projeto a partir do repositório e adicione o plugin **Redis**. O Postgres fica no **Supabase**: copie a *connection string* para `DATABASE_URL`.
2. Configure o **serviço backend**:
   - **Root Directory:** `agente-marlon`
   - **Build:** `npm ci && npx prisma generate && npx prisma db push`
   - **Start:** `npm start`
   - **Variáveis:** todas as do `.env.example`, com `WORKER_INLINE=true` (worker no mesmo processo; mantenha **1 instância**).
   - Gere um domínio público e use-o em `PUBLIC_BASE_URL`.
3. Configure o **serviço painel**:
   - **Root Directory:** `agente-marlon/panel`
   - **Build:** `npm ci && npm run build`
   - **Start:** `npm start`
   - **Variável:** `BACKEND_URL=https://<domínio do backend>`
4. Crie o primeiro usuário com `railway run npm run user:create -- email "Nome" "senha"`.

### Render

Use o [`render.yaml`](render.yaml) (Blueprint): ele cria o backend, o painel e o Redis. O Postgres continua no Supabase.

### Depois do deploy: conectar os provedores

| Provedor | O que configurar |
|---|---|
| **Meta / WhatsApp** | Webhook `https://BACKEND/webhooks/whatsapp`, *verify token* = `WA_VERIFY_TOKEN`, assinatura no campo `messages`. Rode `npm run templates:sync` e aguarde a aprovação. |
| **Hotmart** | Webhook (Postback 2.0) `https://BACKEND/webhooks/hotmart` com os eventos de compra, abandono, boleto/Pix, reembolso, chargeback, cancelamento e protesto. O `hottok` vai em `HOTMART_HOTTOK`, e os IDs dos produtos em `HOTMART_PRODUCT_ID_*`. |
| **Quiz / LPs** | `POST https://BACKEND/webhooks/lead` com o header `x-webhook-secret`. Corpo: `{nome, telefone, email, origem, maior_de_18, aceita_ligacao, texto_consentimento_ligacao, quer_ligacao_agora}`. |
| **Vapi** | Importe da Twilio o número normal e o 0303. O agente é criado por chamada (custom LLM → `https://BACKEND/voice/vapi/chat/completions`) e os eventos vão para `/voice/vapi/events`. |
| **Retell** | Agente com *Custom LLM* em `wss://BACKEND/voice/retell/llm` e webhook em `https://BACKEND/voice/retell/webhook?token=CRON_SECRET`. |
| **Twilio Streams** | No número receptivo: *A call comes in* → `POST https://BACKEND/voice/twilio/inbound`. |
| **Google Calendar** | Compartilhe a agenda do Marlon com o e-mail da conta de serviço (permissão "fazer alterações"). |

## Notas técnicas

- **Modelo:** o padrão é `claude-sonnet-5-5`, com `effort: low`. No WhatsApp o raciocínio é adaptativo. Na voz usamos `thinking: between_tools` para reduzir a latência. O prompt e as tools ficam em cache, e o contexto do lead entra como mensagem de sistema no fim da conversa, sem quebrar o cache. O fallback do servidor (`fallbacks: "default"`) fica ligado por padrão. Uma recusa do modelo vira transferência para humano.
- **Latência de voz:** a meta é < 1,2 s, com endpointing de 250 ms, STT e TTS em streaming (Deepgram nova-3 e ElevenLabs Flash) e resposta curta do modelo. Meça em homologação: a latência depende da região do servidor. Hospede perto de São Paulo.
- **Mesmo cérebro em todos os canais:** com Vapi e Retell, o provedor faz só telefonia, STT e TTS. Quem decide o que falar é o nosso backend (custom LLM), então o prompt, as tools e os guardrails são exatamente os mesmos.
- **Tempo real no painel:** o painel recebe eventos por SSE, com polling de reserva a cada 8 s. Para tempo real completo, rode com `WORKER_INLINE=true` e 1 instância.
- **CSV diário e resumo das 8h:** os jobs repetíveis do BullMQ salvam `exports/metricas-AAAA-MM-DD.csv`, e o arquivo também pode ser baixado no painel. O template `resumo_diario` vai para `WA_MARLON_NUMBER`.
