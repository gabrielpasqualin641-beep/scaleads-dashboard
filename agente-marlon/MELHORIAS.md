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
