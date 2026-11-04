# Instruções para agentes de IA (Antigravity, Claude Code etc.)

Este projeto é o agente comercial de IA (WhatsApp + voz) da equipe do psicólogo Marlon Mattedi. Leia o `README.md` para entender a arquitetura, o `COMPLIANCE.md` para as regras legais e o `COMO_RODAR.md` para os comandos.

## Comandos
- `npm run local`: sobe o demo (backend em memória na porta 3333 + painel na 3000). O simulador fica em http://localhost:3000/simulador (login `demo@equipe.local` / `demo-senha-123`).
- `npm run typecheck`, `npm test` e `npm run test:scenarios`: **rode os três depois de qualquer mudança**. Todos precisam passar.
- `npm run test:scenarios:live`: os mesmos cenários com o Claude real (exige `ANTHROPIC_API_KEY` no `.env`).

## Regras que não podem ser quebradas
- Conformidade (seção 5 do `COMPLIANCE.md`): identificação como assistente virtual, discrição, consentimento e 0303 nas ligações, opt-out imediato, janela 9h–20h (seg–sáb), sem diagnóstico, sem promessa, sem remédio, CVV 188 em caso de risco, encerramento com menor de idade, reembolso sempre com um humano.
- Todo link de checkout é montado por `buildCheckoutUrl` e leva `sck=f4-ia`. Nunca escreva um link à mão.
- Fatos sobre os produtos vêm só de `agent/knowledge/produtos.md`.
- Não remova nem enfraqueça cenários em `tests/scenarios/` para fazer um teste passar.
- Não adicione dados de conversa a anúncios ou pixel.

## Onde ficam as coisas
- `agent/`: prompt de sistema, base de conhecimento e templates do WhatsApp.
- `src/agent/`: o motor da conversa (`engine.ts`), as regras fixas (`guardrails.ts`), as tools (`tools.ts`) e os cérebros (`brain/claude.ts`, `brain/offline.ts`).
- `src/queue/`: as cadências (lembretes, retomadas, pós-venda).
- `src/http/simApi.ts`: a API do simulador (só no modo demo).
- `panel/`: o painel em Next.js (`app/simulador/page.tsx` é a tela de conversa).
