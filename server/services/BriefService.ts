import fs from 'fs';
import path from 'path';
import { ProjectBrief } from '../models/types.js';

const DATA_DIR = path.resolve(process.cwd(), 'server/data');
const FILE = path.join(DATA_DIR, 'briefs.json');

/**
 * Briefings de projeto, um por cliente.
 *
 * Fica em arquivo separado do `store.json` porque é conteúdo escrito à mão pela
 * agência — não deve ser perdido num reseed do banco de demonstração.
 */
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
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf-8');
  }

  public static get(clientId: string): ProjectBrief | null {
    return this.load()[clientId] ?? null;
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
