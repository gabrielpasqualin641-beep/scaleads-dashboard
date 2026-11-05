# Conformidade · Agente comercial IA da equipe Marlon Mattedi

> **Status: precisa de validação antes de ir para produção.** Este documento descreve como o sistema implementa as regras da seção 5 e lista o que o **advogado** e o **Marlon** precisam validar, inclusive frente às normas do **CFP** e do **CRP 12**.
> Não é parecer jurídico. As decisões marcadas com ⚖️ são interpretações técnicas que precisam de confirmação.

## 1. Como cada regra está implementada

Cada regra tem uma camada **determinística**, que não depende do modelo de IA, e uma camada **de prompt**. A camada determinística tem a palavra final.

| Regra | Onde no código | Como é garantida |
|---|---|---|
| Identifica-se como assistente virtual na 1ª mensagem | `Engine.withIntro`, `voiceOpener` | Se a 1ª mensagem do WhatsApp não diz "assistente virtual", o sistema acrescenta a apresentação. A ligação sempre abre com a apresentação. |
| "É robô?" → verdade | `detectRobotQuestion` em `guardrails.ts` | Resposta fixa e verdadeira, sem passar pelo modelo. |
| Ligação só com consentimento explícito | `canContact`, `hasCallConsent`, tool `agendar_ligacao` | Sem `callConsent` com data, origem e texto, nenhuma ligação é discada. Isso é conferido de novo na hora de discar. |
| Registro do consentimento | `Lead.callConsent` + tabela `ConsentLog` (imutável) | Guarda data, origem (`quiz`, `lp`, `pedido_do_lead`) e o texto exato aceito. |
| Prefixo 0303 na ligação ativa de oferta | `pickCallerId` em `voice/sessions.ts` | Ligação de oferta sem número 0303 configurado **é bloqueada**. Lembrete de consulta (serviço) sai pelo número normal. |
| Não Me Perturbe | `checkNaoMePerturbe`, `Lead.naoMePerturbe` | Consulta opcional (`NAO_ME_PERTURBE_CHECK_URL`) antes de cada ligação de oferta. Se a consulta falhar, o sistema não liga. |
| Saída oferecida em toda ligação | `handleVoiceTurn` | Depois de confirmar a identidade: "Se preferir não receber ligações, é só me dizer." |
| Gravação só com aviso | `voiceOpener` + `VOICE_RECORD_CALLS` | Com a gravação ligada, o aviso entra na primeira fala. Com ela desligada, nada é gravado. |
| Confirma identidade e privacidade antes do assunto | Fases `identidade → privacidade → aberta` da `VoiceSession` | O modelo só é chamado depois das duas confirmações. Até lá, as falas são fixas e neutras. |
| Outra pessoa atende | `handleVoiceTurn` | Responde só "é da equipe do Marlon, eu retorno depois" e desliga. A ligação fica marcada como `outra_pessoa`. |
| Recado e caixa postal neutros | `VOICEMAIL_NEUTRO`, rota `/voice/twilio/amd` e `voicemailMessage` da Vapi | "Oi, aqui é da equipe do Marlon Mattedi. A gente retorna depois." |
| Pré-visualização neutra | `agent/templates.json` + teste `templates ... neutros` | Nenhum template cita a condição nem o produto. Um teste automatizado bloqueia termos sensíveis. |
| Opt-out imediato ("não quero", "para", "sai", "não me liga") | `detectOptout` → `applyOptout` | O canal é bloqueado na hora, todas as cadências são canceladas e o pedido vai para o `ConsentLog`. "Não me liga" bloqueia só a voz. Os demais bloqueiam tudo. |
| Até 3 tentativas por oportunidade e 1 ligação por dia | `canContact` | Conferido na execução de cada cadência. |
| Nenhum contato das 20h às 9h nem aos domingos | `isWithinContactWindow`, `nextContactWindow` | A cadência fora da janela é adiada para a próxima abertura. Lembretes H-2 que cairiam fora da janela não são enviados. |
| Nunca diagnostica, não promete, não fala de remédio, sem urgência falsa | `checkOutput` (filtro de saída) + prompt | Uma resposta que viole as regras é bloqueada e regenerada uma vez. Se ainda violar, sai um texto seguro. Nomes de medicamentos e doses são bloqueados. |
| Sofrimento ou risco → humano com urgência alta + CVV 188 | `detectCrisis` | Resposta fixa de acolhimento com o CVV (188). A conversa vai para um humano com urgência **alta** e a IA pausa. |
| Menor de 18 anos | `detectMinor` + campo `maior_de_18` na captura | A conversa é encerrada com educação, o lead fica bloqueado e as cadências são canceladas. A captura recusa quem não confirmou ter 18 anos ou mais. |
| Reembolso → humano, sem dificultar | `detectRefund`, webhook `PURCHASE_PROTEST` | Resposta fixa ("já passei para a equipe, sem complicação") e transferência. A IA nunca tenta reverter. |
| Fatos só da base | prompt + `transferir_humano` "pergunta fora da base" | Se a informação não está na base, a resposta é "vou confirmar com a equipe" e abre-se uma tarefa. |
| Links sempre com `sck=f4-ia` + UTMs | `buildCheckoutUrl`, `withTracking`, `autoFixOutput` | O link é montado só pela tool. Se aparecer um link da Hotmart sem rastreamento no texto, ele é corrigido automaticamente. A suíte de cenários reprova qualquer link sem `sck`. |
| LGPD: só resumos de ligação | `endVoiceSession` | A transcrição da ligação fica só em memória durante a chamada. Depois, guarda-se um resumo curto. |
| LGPD: retenção de 90 dias | job `retencao_lgpd` (diário, 3h30) | Apaga as mensagens com mais de 90 dias e os resumos de ligação antigos. |
| LGPD: nada para anúncio ou pixel | arquitetura | Nenhum código envia o conteúdo das conversas para Meta Ads, pixel ou CAPI. O resumo diário e o CSV têm só números agregados. |
| Alerta para a equipe sem conteúdo | `notifyTeam` | O alerta leva só o primeiro nome, os 4 últimos dígitos do telefone e o motivo. |

## 2. Decisões que precisam de validação ⚖️

1. **Responder fora do horário.** A regra "sem contato das 20h às 9h" está aplicada a **todo contato ativo** (cadências, ligações e templates). Por padrão, a IA **responde** quando o próprio lead escreve à noite (`RESPONDER_FORA_DO_HORARIO=true`). Para bloquear também essas respostas, use `false`: a mensagem fica registrada e a resposta sai às 9h.
2. **Qual ligação é "telemarketing ativo".** Toda ligação comercial (retomada de carrinho, ligação pedida pelo lead, retorno combinado) sai pelo **0303**. Só a confirmação de consulta agendada é tratada como **serviço** e sai pelo número normal.
3. **O botão "Falar com a equipe" como consentimento.** Tocar o botão é registrado como consentimento explícito de ligação (origem `pedido_do_lead`, com o texto do botão). Confirmar se basta ou se é preciso uma frase mais explícita no botão.
4. **Contato pós-compra.** O WhatsApp de acompanhamento (D+1/D+3/D+6 e D+2/D+7/D+21) usa como base a relação de compra. Confirmar a base legal (execução de contrato ou legítimo interesse) e o texto da política de privacidade.
5. **Histórico de WhatsApp.** As mensagens do WhatsApp ficam guardadas por até 90 dias, porque o contexto da conversa e o painel dependem delas. As ligações guardam só o resumo. Confirmar se o mesmo critério serve para o WhatsApp ou se é preciso resumir antes disso.
6. **Base legal para dados de saúde (art. 11 da LGPD).** O lead conta detalhes íntimos na conversa. Definir a base legal, o texto de aviso no quiz e nas LPs e o canal para o titular exercer seus direitos (acesso e exclusão).
7. **Subprocessadores.** Anthropic (IA), Meta (WhatsApp), Twilio, Vapi ou Retell, Deepgram, ElevenLabs, Google, Supabase, Mercado Pago e Hotmart. Avaliar contratos (DPA), transferência internacional e retenção de cada um.
8. **A palavra "treino" na abertura da ligação.** Depois da confirmação de identidade **e** de privacidade, a IA diz o motivo da ligação (ex.: "você pediu informações sobre o treino"). Antes disso, nada é dito.

## 3. Pontos para o Marlon e as normas do CFP

- [ ] A Resolução CFP 11/2018 (e atualizações) permite a **oferta comercial por IA** em nome de um psicólogo? A IA não faz atendimento psicológico, mas é preciso confirmar que a comunicação não configura publicidade irregular (CFP 10/2005, Código de Ética, art. 20).
- [ ] As frases de autoridade (23 anos, 10 mil consultas, 70 mil clientes em 20 países, formação) estão corretas, são comprováveis e podem ser usadas em publicidade?
- [ ] A frase "na maioria dos casos isso está ligado a ansiedade e a um ritmo que o corpo aprendeu" é aceitável como **educação**, sem configurar diagnóstico?
- [ ] O fluxo de risco (CVV 188 + transferência urgente) e quem da equipe atende em até quanto tempo, inclusive fora do horário comercial.
- [ ] A política de **sessões não reembolsáveis** foi revisada à luz do CDC e do Código de Ética.
- [ ] A consulta online segue o cadastro no e-Psi e a Resolução CFP 11/2018.
- [ ] O nome e o gênero da assistente (`AGENT_NAME`, `VOICE_GENDER`). As falas fixas usam o feminino ("obrigada").

## 3.1 Dados científicos citados pelo agente (v1.2)
- [ ] Validar com o Marlon (e o advogado) o uso dos estudos de `agent/knowledge/ciencia.md` na conversa comercial: prevalência (Gillman & Gillman 2019; Moreira Jr. et al. 2005) e exercícios do assoalho pélvico (Pastore et al. 2014; La Pera 2014).
- [ ] Confirmar que a forma de citar (sem atribuir os números ao CONTROLE 2.0, sempre com "os resultados variam") está adequada às normas de publicidade do CFP e ao CDC.
- O sistema bloqueia qualquer porcentagem fora da base (20%, 30%, 30,3%, 82,5%, 54%), qualquer porcentagem ligada ao nome de um produto, "garante" e prazos ("em X semanas você vai").

## 4. Checklist antes de produção

**Jurídico**
- [ ] Revisar os itens ⚖️ da seção 2.
- [ ] Texto do checkbox "Aceito receber ligação..." no quiz e nas LPs. O mesmo texto vai no campo `texto_consentimento_ligacao`.
- [ ] Política de privacidade atualizada (IA, gravação, retenção de 90 dias, subprocessadores).
- [ ] Contratação ou registro do número **0303** e processo de consulta ao **Não Me Perturbe**.
- [ ] Aviso de gravação (se `VOICE_RECORD_CALLS=true`) e retenção das gravações no provedor de voz.

**Operação**
- [ ] Templates aprovados pela Meta (`npm run templates:sync`) com textos neutros.
- [ ] Números da equipe em `WA_TEAM_NUMBERS` e um responsável de plantão para urgência alta.
- [ ] Usuários do painel criados com senha forte (`npm run user:create`).
- [ ] Teste de ponta a ponta em homologação: WhatsApp, Hotmart (sandbox), ligação para um número interno e agenda.
- [ ] `npm run test:scenarios:live` passando com a chave da Anthropic de produção.
- [ ] Revisão semanal das conversas com transferência e das respostas bloqueadas pelo filtro (logs `[engine] resposta bloqueada`).
