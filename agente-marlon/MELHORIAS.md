# Melhorias v1.7: aprendizados das conversas reais da equipe

Situação: `npm run typecheck` sem erros, `npm test` com 20 de 20 testes passando, `npm run test:scenarios` com **50 de 50** cenários passando no modo offline. O cenário 46 continua só no modo live.

A análise completa está em `docs/analise-conversas.md`. Ela foi feita a partir de 48 conversas anonimizadas, sem nenhuma fala copiada para o projeto.

## O que mudou
- **Triagem** como a equipe faz: "só rápido, ou também falhas na rigidez? O que veio primeiro?".
- **Falhas na rigidez:** a conversa vai para a equipe com o motivo "interesse no TREINO DO LEÃO". O agente não inventa preço, link nem detalhes, porque o produto ainda não está na base.
- **Mensagens prontas reconhecidas:** "estou na página do Treino do LEÃO", "suporte do Treino CONTROLE 2.0" e "consultas online" pelo site viram contexto para a IA.
- **"É o Marlon? É o doutor?":** resposta fixa e honesta (assistente virtual).
- **Dúvida sobre exercício ou aula** de quem já comprou: vai para a equipe; o agente não ensina técnica.
- **FAQ:** acesso (e-mail, app Hotmart, Minhas compras, vitalício), pagamento (sem dinheiro, sem venda por aula, boleto parcelado), canais oficiais e como funciona a consulta.
- **Objeções novas:** golpe/confiança, "é o Marlon?", dinheiro ou por aula, "já tentei creme/anestésico/pensar em outra coisa", sem cartão.
- **Cenários novos (47 a 52):** falhas na rigidez, "é o Marlon?", dinheiro ou por aula, dúvida de exercício, página do LEÃO e medo de golpe.

## Pendente (precisa de resposta da equipe)
- **TREINO DO LEÃO:** link de checkout, preço (R$397, ou R$297 comprando junto?), garantia e conteúdo. Com isso, o agente passa a recomendar e vender o LEÃO.
- **CONTROLE 2.0:** quantidade de aulas ("mais de 20 vídeos" nas conversas, "8 exercícios" na base).
- **Consulta:** R$900 ou R$800?
- **Narrativa:** validar com o Marlon a frase "não tratar faz piorar".

---

# Melhorias v1.2: agente humano, inteligente e persuasivo

Situação: `npm run typecheck` sem erros, `npm test` com 19 de 19 testes passando, `npm run test:scenarios` com **44 de 44** cenários passando no modo offline, sem violar nenhuma regra da seção 5 e com todos os links levando `sck=f4-ia`. O cenário 46 só roda no modo live.

**`npm run test:scenarios:live` não foi executado:** não há `ANTHROPIC_API_KEY` neste ambiente. Com a chave no `.env`, o comando roda os 45 cenários com o Claude e grava as transcrições em `docs/conversas-live.md`.

## O que mudou
1. **Base científica** (`agent/knowledge/ciencia.md`): prevalência, causas e estudos com exercícios, com fontes e regras de citação. Entra no prompt automaticamente, porque `loadSystemPrompt` inclui todos os arquivos de `agent/knowledge/`.
2. **Prompt de sistema:**
   - **Estilo:** as seções "Tom" e "Como você vende" foram substituídas por "Quem você é", "Como você conversa" (WhatsApp brasileiro, mensagens curtas com `|||`, frases proibidas) e "Como você conduz a venda" (9 passos, com dado, educação, pequeno sim e fechamento com forma de pagamento).
   - **Seções novas:** "Custo de esperar" e "Sinais de causa médica".
   - **Mantido da v1.1:** ler o momento da pessoa, a escada de produtos e o "vou pensar".
3. **Exemplos** (`agent/knowledge/exemplos.md`): (a) conversa completa do CONTROLE 2.0, (b) objeção de preço que desce para o Express, (c) lead decidido.
4. **Envio humanizado:**
   - A resposta é dividida em até 3 mensagens (`|||`). Antes de cada uma aparece o "digitando" (Cloud API) e há uma espera de `chars/25 s`, entre 1,2 s e 4 s (`HUMAN_DELAY=false` desliga; os testes e o simulador já vêm desligados).
   - Cada mensagem passa pelo filtro de saída.
   - **Sem botões de resposta rápida** na oferta.
   - **O link sai logo depois da mensagem que aponta para ele** ("te mandei o link aqui 👇"). Antes, o link era enviado antes do texto da IA.
   - **Na ligação,** `|||` vira um espaço.
5. **Guardrails:**
   - **Números:** passam só as porcentagens da base (20%, 30%, 30,3%, 82,5%, 54%).
   - **Bloqueios novos:** porcentagem ligada a um produto ("o CONTROLE 2.0 tem X% de sucesso"), "garante" e prazo ("em X semanas você vai").
   - **Negações** ("ninguém garante", "não prometo") continuam permitidas.
6. **Cenários novos:** 43 (dado de prevalência), 44 (causa médica → urologista), 45 (estudo sem promessa) e 46 (conversa (a) inteira, só live: sem frases de robô, retomando detalhes, fechamento com forma de pagamento). O executor ganhou `somente_live`, `sem_frases_proibidas` e `retoma_detalhe`.
7. **Roteiro offline** (usado só sem chave): ganhou o dado de prevalência, o caminho do urologista e o estudo no "funciona?", e perdeu as frases proibidas.

## Próximos passos
1. **Rodar com a chave:** coloque a `ANTHROPIC_API_KEY` no `.env` (veja o `.env.demo.example`) e rode `npm run test:scenarios:live`. Depois, leia `docs/conversas-live.md`.
2. **Calibrar o "retoma detalhe":** é uma heurística (radical de 4 letras ou número dito antes). Se der falso negativo no live, ajuste a lista de palavras ignoradas em `tests/runScenarios.ts`.
3. **Validação:** validar os dados científicos com o Marlon e o advogado (seção 3.1 do `COMPLIANCE.md`).

---

# Melhorias v1.1

Resumo do que mudou em relação à v1.0. Situação: `npm test` com 16 de 16 testes passando, `npm run test:scenarios` com **41 de 41** cenários passando (nenhuma regra da seção 5 violada, todos os links com `sck=f4-ia`) e `npm run typecheck` sem erros.

## 1. Ligações: portões de identidade e privacidade
- **Identidade:** uma resposta ambígua ("Alô?", "Oi", "hã?", silêncio) não desliga mais a ligação. A IA repete uma vez, de forma neutra: "Oi! Aqui é a Clara, da equipe do Marlon Mattedi. Eu falo com o João?". Na segunda resposta sem confirmação, encerra com "é da equipe do Marlon, eu retorno depois".
- **Marcação da ligação:** o status `outra_pessoa` agora só é usado quando a resposta é um "não" de verdade.
- **Privacidade:** frases como "Não tem problema, pode falar" e "tudo bem" agora contam como **sim**. O "não" só vale quando é claro ("agora não", "estou no trabalho", "não estou sozinho" etc.) ou quando aparece sem nenhum sinal de sim.
- **Código:** campo novo `identityTries` em `VoiceSession`.

## 2. Lembrete de "link enviado sem compra"
- **O lembrete:** 3h depois de `enviar_link_checkout`, ajustado à janela 9h–20h, sai um lembrete leve: "conseguiu abrir o link?". Ele usa o template `retorno_combinado` fora da janela de 24h. Uma nota interna orienta a IA a descobrir o que travou e a oferecer o Controle Express se o preço travou no CONTROLE 2.0, sem insistir.
- **Quando é cancelado:** pela compra aprovada (`PURCHASE_APPROVED`/`COMPLETE`) e pela retomada de carrinho (abandono, boleto ou Pix), que assume o acompanhamento.
- **Quando não sai:** se o lead já comprou o produto ou está na etapa `comprou`.

## 3. Link: apresentação e duplicidade
- **Apresentação:** quem chega pedindo o link recebe a apresentação de assistente virtual junto com o link. Antes, o link chegava sozinho como primeira mensagem.
- **Duplicidade:** o mesmo link não é reenviado dentro de 15 minutos. A tool devolve `ja_enviado: true` e a IA avisa que o link está logo acima na conversa.

## 4. Personalização pela origem
- **Captura de lead:** `/webhooks/lead` aceita `produto_interesse`, `perfil_quiz` e `criativo`, que viram uma nota interna para a IA personalizar a abertura.
- **Anúncio:** no clique em anúncio para WhatsApp, o título do anúncio (`referral.headline`) entra como nota na primeira mensagem.
- **Documentação:** os campos estão na tabela "Campos do `/webhooks/lead`" do README.

## 5. Cérebro de vendas (`system_prompt.md` e `faq.md`)
- **Passo 0, "Leia o momento da pessoa":** quem já chega decidido recebe o link; quem veio do quiz, da página ou de um anúncio começa por aí; quem comprou o Express entra em acompanhamento.
- **Fechamento:** pequenos "sins", a pergunta "parcelado em 12x de R$33,08 ou à vista?" e a escada de produtos (Express se o preço travar, consulta se a pessoa já tentou de tudo).
- **Objeções novas:** confiável/golpe, já tentei de tudo, não tenho cartão, em quanto tempo funciona, disfunção erétil (fora do escopo) e se a parceira precisa participar.
- **Prova social:** uma seção nova, sem nenhum depoimento inventado.
- **FAQ:** as seções Confiabilidade, Escopo dos produtos e Prazo de resultado.

## 6. Esforço do modelo por canal
- **Variáveis:** `ANTHROPIC_EFFORT_WHATSAPP` (padrão `medium`) controla o WhatsApp. `ANTHROPIC_EFFORT` (padrão `low`) continua controlando a voz, onde a latência pesa mais.

## 7. Segurança em produção
- **Inicialização:** com `NODE_ENV=production` e `STORE=prisma`, o servidor não sobe se faltar `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `HOTMART_HOTTOK` ou `LEAD_WEBHOOK_SECRET`. Com Vapi, também exige `VAPI_WEBHOOK_SECRET`; com Retell, `RETELL_LLM_SECRET` e `CRON_SECRET`. A função é `missingProdSecrets()`.
- **Vapi:** os dois endpoints exigem `x-vapi-secret`. Sem segredo configurado, só funcionam fora de produção.
- **Retell:** o WebSocket mudou para `/voice/retell/llm/<RETELL_LLM_SECRET>/<call_id>`; com segredo errado, o socket fecha com o código 1008. O webhook exige `?token=CRON_SECRET` em produção.

## 8. Templates e risco
- **Categorias:** `boas_vindas`, `retomada_pedido` e `retorno_combinado` passaram para `MARKETING`, que é como a Meta classifica mensagens de abordagem e retomada comercial.
- **Frases de risco novas:** "quero/queria sumir", "pensando em me matar", "não vale a pena viver", "não tenho motivo pra viver" e "ninguém vai sentir minha falta".

## 9. Cenários novos
| Arquivo | O que testa |
|---|---|
| `36_voz_alo.yaml` | "Alô?" repete a pergunta, sem desligar e sem citar o assunto. |
| `37_voz_nao_tem_problema.yaml` | "Não tem problema, pode falar" é lido como sim. |
| `38_voz_silencio_duas_vezes.yaml` | O primeiro silêncio repete a pergunta; o segundo encerra de forma neutra. |
| `39_link_sem_compra.yaml` | O lembrete sai 3h depois do link, uma vez só. |
| `40_compra_cancela_lembrete_link.yaml` | A compra aprovada cancela o lembrete. |
| `41_carrinho_assume_lembrete.yaml` | A retomada de carrinho substitui o lembrete. |

## Próximos passos
1. **Testar com o Claude real:** `npm run test:scenarios:live`, com `ANTHROPIC_API_KEY` no `.env`. Até agora, os 41 cenários rodaram só com o cérebro offline.
2. **Deduplicação do webhook no Redis:** hoje a deduplicação das mensagens do WhatsApp (`seen` em `src/http/webhooks.ts`) e a fila por contato ficam na memória do processo. Antes de rodar com mais de uma instância, mova as duas para o Redis (por exemplo, `SET wamid NX EX 86400`).
3. **Validação jurídica:** passar o `COMPLIANCE.md` pelo advogado, incluindo as categorias novas de template e o uso de dados de origem (quiz e anúncio) na personalização.
