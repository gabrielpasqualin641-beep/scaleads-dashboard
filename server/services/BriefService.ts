import fs from 'fs';
import path from 'path';
import { ProjectBrief } from '../models/types.js';
import { dataFile, ensureDataDir } from '../config/paths.js';
import { persist } from '../persistence/remoteState.js';

const FILE = dataFile('briefs.json');

/**
 * Briefings de projeto, um por cliente.
 *
 * Fica em arquivo separado do `store.json` porque é conteúdo escrito à mão pela
 * agência — não deve ser perdido num reseed do banco de demonstração.
 */
/**
 * Metas de custo definidas pela agência, no código.
 *
 * Não é duplicação do briefing: é o valor padrão de quem ainda não tem arquivo
 * salvo. O `briefs.json` mora no disco da hospedagem, que é efêmero no plano
 * atual — cadastrar a meta pelo painel funcionava até o próximo deploy, e aí os
 * indicadores voltavam a ficar cinza sem ninguém entender por quê.
 *
 * Assim que alguém salva o briefing pelo painel, o que foi salvo manda: o seed
 * só preenche cliente que ainda não tem registro nenhum.
 */
const SEED_TARGETS: Record<string, Pick<ProjectBrief, 'targetCpl' | 'targetCpmql' | 'targetCpa' | 'targetCpm' | 'targetRoas'>> = {
  client_marcio_giacobelli: {
    targetCpl: 100,
    targetCpmql: 200,
    targetCpa: null,
    targetCpm: 35,
    targetRoas: null
  }
};

function briefFromSeed(clientId: string): ProjectBrief | null {
  const targets = SEED_TARGETS[clientId];
  if (!targets) return null;
  return {
    clientId,
    description: '',
    offer: '',
    audience: '',
    ...targets,
    averageTicket: null,
    monthlyBudget: null,
    constraints: '',
    updatedAt: '2026-09-09T00:00:00Z',
    updatedBy: 'seed'
  };
}

export class BriefService {
  private static load(): Record<string, ProjectBrief> {
    try {
      if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    } catch (err) {
      console.error('[BriefService] Falha ao ler briefs.json:', err);
    }
    return {};
  }

  private static save(all: Record<string, ProjectBrief>): void {
    ensureDataDir();
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf-8');
    persist('briefs.json');
  }

  public static get(clientId: string): ProjectBrief | null {
    return this.load()[clientId] ?? briefFromSeed(clientId);
  }

  public static upsert(clientId: string, input: Partial<ProjectBrief>, updatedBy: string): ProjectBrief {
    const all = this.load();
    const current = all[clientId];

    const num = (value: unknown, fallback: number | null): number | null => {
      if (value === null || value === '') return null;
      if (value === undefined) return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    const brief: ProjectBrief = {
      clientId,
      description: input.description ?? current?.description ?? '',
      offer: input.offer ?? current?.offer ?? '',
      audience: input.audience ?? current?.audience ?? '',
      targetCpl: num(input.targetCpl, current?.targetCpl ?? null),
      targetCpa: num(input.targetCpa, current?.targetCpa ?? null),
      targetRoas: num(input.targetRoas, current?.targetRoas ?? null),
      targetCpmql: num(input.targetCpmql, current?.targetCpmql ?? null),
      targetCpm: num(input.targetCpm, current?.targetCpm ?? null),
      averageTicket: num(input.averageTicket, current?.averageTicket ?? null),
      monthlyBudget: num(input.monthlyBudget, current?.monthlyBudget ?? null),
      constraints: input.constraints ?? current?.constraints ?? '',
      updatedAt: new Date().toISOString(),
      updatedBy
    };

    all[clientId] = brief;
    this.save(all);
    return brief;
  }
}
