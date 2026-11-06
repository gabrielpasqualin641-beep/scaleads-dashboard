# Instruções para agentes de IA (Antigravity, Claude Code etc.)

Este projeto é o agente comercial de IA (WhatsApp + voz) da equipe do psicólogo Marlon Mattedi. Leia o `README.md` para entender a arquitetura, o `COMPLIANCE.md` para as regras legais e o `COMO_RODAR.md` para os comandos.

## Como trabalhar neste projeto
- O dono do projeto usa **Windows com PowerShell**. Não junte comandos com `&&`: passe um comando por vez.
- **Não suba nada para o GitHub** (sem `git push`). O projeto roda só localmente, por decisão do dono.
- Antes de alterar fatos de produto (preço, link, conteúdo), confirme com o dono. Nunca invente.
- Depois de qualquer mudança, rode `npm run typecheck`, `npm test` e `npm run test:scenarios`, e mostre o resultado.

## Comandos
- `npm run demo`: sobe o backend em memória na porta 3333. O simulador de conversa fica em http://localhost:3333 (sem login; página em `src/sim/simulador.html`).
- `npm run local`: demo + painel Next.js completo na porta 3000 (login `demo@equipe.local` / `demo-senha-123`).
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
- `src/http/simApi.ts` e `src/sim/simulador.html`: a API e a página do simulador (só no modo demo).
- `panel/`: o painel em Next.js (`app/simulador/page.tsx` é a tela de conversa).
