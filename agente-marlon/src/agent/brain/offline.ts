/**
 * Cérebro offline (sem chamada à API): roteiro por intenção, seguindo o método consultivo do prompt.
 * Usos: simulador sem chave, suíte de cenários em CI e modo de contingência se a API cair.
 * Ele chama as MESMAS tools do agente, então todo o fluxo (links, agenda, transferência) é exercitado.
 */
import { firstName } from "../../channels/messenger.js";
import { norm } from "../guardrails.js";
import { runTool } from "../tools.js";
import type { Brain, BrainInput, BrainOutput } from "./types.js";

type Product = "controle_express" | "controle_2" | "consulta";

function lastAi(input: BrainInput): string {
  const ai = [...input.history].reverse().find((m) => m.author === "ai");
  return ai ? norm(ai.text) : "";
}

function recommendedProduct(input: BrainInput): Product | null {
  for (const m of [...input.history].reverse()) {
    if (m.author !== "ai") continue;
    const t = norm(m.text);
    if (/consulta (online )?com o marlon|atendimento individual/.test(t)) return "consulta";
    if (/controle 2\.0|treino completo/.test(t)) return "controle_2";
    if (/controle express|porta de entrada/.test(t)) return "controle_express";
  }
  return null;
}

const has = (t: string, re: RegExp) => re.test(t);

export class OfflineBrain implements Brain {
  name = "offline";

  async respond(input: BrainInput): Promise<BrainOutput> {
    const { lead, channel, toolCtx } = input;
    const voz = channel === "voz";
    const userMsg = [...input.history].reverse().find((m) => m.author === "lead");
    const t = norm(userMsg?.text ?? "");
    const nome = lead.name ? firstName(lead) : "";
    const tool = (name: string, args: Record<string, unknown>) => runTool(name, { telefone: lead.phone, ...args }, toolCtx);
    const prev = lastAi(input);
    const rec = recommendedProduct(input);
    const userTurns = input.history.filter((m) => m.author === "lead").length;

    // Ligação: identidade e privacidade confirmadas → diz o motivo e começa a descoberta.
    const voiceStart = input.notes.find((n) => n.startsWith("A pessoa confirmou que é ela"));
    if (voz && voiceStart) {
      const motivo = voiceStart.match(/Motivo da ligação: ([^.]+)\./)?.[1] ?? "você pediu informação";
      return { text: `Ótimo. Estou ligando porque ${motivo.replace(/^lead /, "você ")}. Pra eu te ajudar melhor: o que te fez buscar ajuda agora?` };
    }

    // Escolha de horário (resposta de lista interativa ou número)
    const slotId = (userMsg?.meta?.replyId as string | undefined) ?? t.match(/slot:(\S+)/)?.[1];
    if (slotId?.startsWith("slot:") || (prev.includes("horarios") && /^\s*[1-3]\s*$/.test(t))) {
      let iso = slotId?.startsWith("slot:") ? slotId.slice(5) : undefined;
      if (!iso) {
        const r = (await tool("listar_horarios", { dias: 7 })) as { horarios: Array<{ inicio: string }> };
        iso = r.horarios[Number(t.trim()) - 1]?.inicio;
      }
      const r = (await tool("agendar_consulta", { horario: iso })) as { ok: boolean; horario?: string };
      return { text: r.ok ? `Pronto, reservei ${r.horario}. Te mandei o link de pagamento e a confirmação. Qualquer dúvida, é só me chamar.` : "Esse horário acabou de ser ocupado. Quer que eu veja outras opções?" };
    }

    // Pergunta fora da base (fatura, nota fiscal, outros produtos, prazos)
    if (has(t, /\b(fatura|extrato|nome (que )?aparece|nota fiscal|cnpj|aplicativo|app proprio|certificado|livro|presencial|endereco|consultorio|plano de saude|convenio|desconto|cupom|parcel\w* (em|no) boleto)\b/)) {
      await tool("transferir_humano", { motivo: "pergunta fora da base", urgencia: "baixa" });
      return { text: "Boa pergunta. Não quero te passar nada errado, então vou confirmar com a equipe e eles te respondem por aqui." };
    }

    // Pedido de falar com o Marlon / equipe
    if (has(t, /\b(falar com (o )?marlon|falar com (a )?equipe|falar com (um )?humano|atendente|pessoa de verdade)\b/) && !has(t, /\b(robo|bot)\b/)) {
      await tool("transferir_humano", { motivo: "pediu para falar com a equipe", urgencia: "media" });
      return { text: "Claro. Já avisei a equipe e alguém continua com você por aqui." };
    }

    // Objeções
    if (has(t, /\b(caro|cara|muito dinheiro|nao tenho dinheiro|sem grana|apertado|salgado)\b/)) {
      await tool("registrar_objecao", { tipo: "preco" });
      return {
        text: voz
          ? "Entendo. O CONTROLE 2.0 sai em 12 vezes de 33 reais e 8 centavos. E tem garantia de 7 dias. Se preferir começar menor, o Express custa 47 reais. Qual faz mais sentido pra você?"
          : "Entendo. Vale pensar no custo de continuar como está.\nO CONTROLE 2.0 sai em 12x de R$33,08 sem juros, com garantia de 7 dias. Se preferir começar menor, o Controle Express custa R$47.\nQual faz mais sentido pra você agora?",
      };
    }
    if (has(t, /\b(remedio|medicament\w*|comprimido|viagra|sildenafil\w*|tadalafil\w*|cialis|dapoxetin\w*|pilula|farmacia)\b/)) {
      await tool("registrar_objecao", { tipo: "remedio" });
      return {
        text: "Sobre remédios eu não falo, porque isso é com um médico.\nO que o treino faz é trabalhar corpo e mente com exercícios, e as duas coisas não se excluem.\nQuer saber como são os exercícios?",
      };
    }
    if (has(t, /\b(funciona|da certo|vai dar certo|serve pra mim|resolve|adianta)\b/)) {
      await tool("registrar_objecao", { tipo: "funciona_pra_mim" });
      return {
        text: voz
          ? "O método vem de 23 anos de clínica do Marlon e mais de 70 mil clientes. Mas os resultados variam de pessoa para pessoa. Por isso tem garantia de 7 dias. Dá para testar sem risco."
          : "O método vem de 23 anos de clínica do Marlon e de mais de 70 mil clientes, mas os resultados variam de pessoa para pessoa.\nPor isso existe a garantia de 7 dias: dá para testar sem risco.\nQuer que eu te explique como funciona o treino?",
      };
    }
    if (has(t, /\b(sigil\w*|discreto|discrecao|alguem vai saber|ninguem saber|minha (esposa|mulher|namorada) (vai )?(ver|saber)|privacidade|anonim\w*)\b/)) {
      await tool("registrar_objecao", { tipo: "sigilo" });
      return {
        text: "Sim. O acesso chega no seu e-mail e você faz tudo sozinho, pelo celular, em casa, no seu ritmo.\nFicou mais alguma dúvida?",
      };
    }
    if (has(t, /\b(vergonha|constrang\w*|tenho medo de (contar|falar))\b/)) {
      await tool("registrar_objecao", { tipo: "vergonha" });
      return { text: "É mais comum do que parece, e o Marlon atende isso há 23 anos. Ninguém precisa saber: você faz no seu ritmo, em casa.\nPosso te contar como funciona?" };
    }
    if (has(t, /\b(nao tenho tempo|sem tempo|correria|muito ocupado)\b/)) {
      await tool("registrar_objecao", { tipo: "tempo" });
      return { text: "Os exercícios são simples e dá para fazer de onde você estiver, no seu horário.\nQuer que eu te mande o link para começar?" };
    }
    if (has(t, /\b(vou pensar|deixa eu pensar|depois eu vejo|mais tarde|outra hora|vou ver)\b/)) {
      await tool("registrar_objecao", { tipo: "vou_pensar" });
      return { text: "Claro, sem pressa. Ficou alguma dúvida que eu possa te ajudar agora?\nSe quiser, posso te chamar amanhã para a gente continuar." };
    }
    if (has(t, /\b(amanha|pode me chamar|me chama)\b/) && prev.includes("te chamar amanha")) {
      const amanha = new Date(toolCtx.deps.now().getTime() + 24 * 3600 * 1000).toISOString();
      await tool("agendar_retorno_whatsapp", { quando: amanha, motivo: "retorno combinado (vou pensar)" });
      return { text: "Combinado. Te chamo amanhã por aqui. Até lá!" };
    }

    // Consulta individual
    if (has(t, /\b(consulta|sessao|atendimento individual|terapia|psicoterapia|agendar|marcar horario)\b/)) {
      const r = (await tool("listar_horarios", { dias: 7 })) as { horarios: Array<{ inicio: string; rotulo: string }> };
      await tool("atualizar_etapa", { etapa: "recomendacao" });
      const top = r.horarios.slice(0, 3);
      if (!top.length) {
        await tool("transferir_humano", { motivo: "sem horários livres na agenda", urgencia: "baixa" });
        return { text: "Estou sem horários livres na agenda agora. Vou pedir para a equipe te passar as próximas datas." };
      }
      return {
        text:
          `A consulta online com o Marlon custa R$900 por sessão de 50 minutos. As sessões não são reembolsáveis.\n` +
          `Tenho estes horários: ${top.map((h, i) => `${i + 1}) ${h.rotulo}`).join("; ")}.\nQual fica melhor pra você?`,
      };
    }

    // Pediu o link / aceitou
    const wantsLink = has(t, /\b(quero o link|manda o link|pode mandar|me manda|quero comprar|quero comecar|vamos|bora|quero sim|pode ser|fechado|quero o (express|controle|2\.0))\b/) || /^(sim|quero|pode|ok|beleza|claro)\b/.test(t);
    if (wantsLink && (prev.includes("link") || prev.includes("mandar") || has(t, /link|comprar|express|controle/))) {
      const produto: "controle_express" | "controle_2" = has(t, /express|47|basico|mais barato/) ? "controle_express" : has(t, /controle|2\.0|completo/) ? "controle_2" : rec === "controle_express" ? "controle_express" : "controle_2";
      if (rec === "consulta" && !has(t, /express|controle|2\.0/)) {
        const r = (await tool("listar_horarios", { dias: 7 })) as { horarios: Array<{ rotulo: string }> };
        return { text: `Para a consulta, tenho: ${r.horarios.slice(0, 3).map((h, i) => `${i + 1}) ${h.rotulo}`).join("; ")}. Qual prefere?` };
      }
      await tool("enviar_link_checkout", { produto });
      return {
        text: voz
          ? "Pronto, te mandei o link no WhatsApp. Se tiver qualquer dúvida no pagamento, me fala."
          : "Pronto, te mandei o link aqui em cima. Você começa ainda hoje.\nSe aparecer qualquer dúvida no pagamento, é só me chamar.",
      };
    }
    if (/^(nao|agora nao|nao obrigado)\b/.test(t) && /posso te mandar|quer que eu|quer ver/.test(prev)) {
      return { text: "Tudo bem, sem problema. Se quiser retomar depois, é só me chamar por aqui." };
    }

    // Preço
    if (has(t, /\b(preco|quanto custa|quanto e|valor|valores|quanto fica|custa quanto)\b/)) {
      await tool("atualizar_etapa", { etapa: "recomendacao" });
      return {
        text: voz
          ? "O treino completo, o CONTROLE 2.0, sai em 12 vezes de 33 reais e 8 centavos, ou 397 à vista. Tem também o Controle Express, de 47 reais. Posso te mandar o link no WhatsApp?"
          : "O Treino CONTROLE 2.0 custa R$397 à vista ou 12x de R$33,08 sem juros, com garantia de 7 dias.\nSe quiser começar pelo básico, o Controle Express custa R$47.\nPosso te fazer uma pergunta rápida para indicar o melhor para você?",
      };
    }

    // Descoberta → educação → recomendação
    if (userTurns <= 1 || has(t, /^(oi|ola|bom dia|boa tarde|boa noite|quero saber|informac\w*|pode mandar|tenho interesse)\b/)) {
      await tool("atualizar_etapa", { etapa: "descoberta" });
      return { text: `${nome ? `${nome}, ` : ""}pra eu te indicar o melhor caminho: o que te fez buscar ajuda agora?` };
    }
    if (prev.includes("o que te fez buscar ajuda")) {
      return { text: "Entendi, obrigado por me contar. Isso acontece há quanto tempo?" };
    }
    if (prev.includes("ha quanto tempo")) {
      return { text: "Faz sentido. E você já tentou alguma coisa antes?" };
    }
    if (prev.includes("ja tentou alguma coisa")) {
      await tool("atualizar_etapa", { etapa: "recomendacao" });
      const educ = "Na maioria dos casos, isso está ligado à ansiedade e a um ritmo que o corpo aprendeu. E o que foi aprendido pode ser treinado. Essa é a visão do Marlon em 23 anos de clínica.";
      if (has(t, /\b(tudo|varias coisas|terapia|psicolog\w*|medico|nada funcionou|ja tentei de tudo|emocional|trauma)\b/)) {
        return { text: `${educ}\nPelo que você contou, eu indicaria a consulta online com o Marlon: atendimento individual, R$900 por sessão de 50 min.\nQuer ver os horários?` };
      }
      if (has(t, /\b(nao|nunca|nada)\b/) && has(t, /\b(barato|pouco|desconfiado|duvida|primeiro passo)\b/)) {
        return { text: `${educ}\nPara começar, eu indicaria o Controle Express (R$47): 7 exercícios, acesso imediato e garantia de 7 dias.\nPosso te mandar o link? Você começa ainda hoje.` };
      }
      return { text: `${educ}\nEu indicaria o Treino CONTROLE 2.0: são 8 exercícios em vídeo, passo a passo, por 12x de R$33,08 ou R$397, com garantia de 7 dias.\nPosso te mandar o link? Você começa ainda hoje.` };
    }

    if (has(t, /\b(como funciona|o que (e|tem)|quais exercicios|detalhes)\b/)) {
      return {
        text: "O CONTROLE 2.0 tem 8 exercícios em aulas de vídeo, passo a passo: controle dos impulsos, resposta do corpo, ansiedade, confiança e sinais do corpo. Acesso vitalício, no celular ou computador.\nPosso te mandar o link?",
      };
    }

    // Qualquer outra coisa: não inventa.
    await tool("transferir_humano", { motivo: "pergunta fora da base", urgencia: "baixa" });
    return { text: "Vou confirmar isso com a equipe para não te passar nada errado. Eles te respondem por aqui." };
  }

  async summarize(lines: string[], previous: string): Promise<string> {
    const last = lines.slice(-4).map((l) => l.replace(/\s+/g, " ").slice(0, 80));
    return [previous, ...last].filter(Boolean).join(" | ").slice(-600);
  }
}
