import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

export type JobType =
  | "boas_vindas"
  | "retomada_carrinho"
  | "ligacao"
  | "pos_venda"
  | "lembrete_consulta"
  | "confirmacao_por_voz"
  | "retorno_combinado"
  | "resumo_diario"
  | "export_csv"
  | "retencao_lgpd";

export interface JobSpec {
  type: JobType;
  leadId?: string;
  opportunity?: string;
  step?: string; // ex.: "D+1", "H-2"
  payload?: Record<string, unknown>;
}

export interface Scheduler {
  schedule(job: JobSpec, runAt: Date): Promise<string>;
  cancelForLead(leadId: string, filter?: (j: JobSpec) => boolean): Promise<number>;
  list(leadId?: string): Promise<Array<JobSpec & { runAt: string; id: string }>>;
}

export type JobHandler = (job: JobSpec) => Promise<{ rescheduleAt?: Date } | void>;

/** Fila em memória (simulador e testes). `runDue` executa o que já venceu. */
export class MemoryScheduler implements Scheduler {
  jobs: Array<JobSpec & { runAt: string; id: string }> = [];
  private seq = 0;
  async schedule(job: JobSpec, runAt: Date) {
    const id = `job-${++this.seq}`;
    this.jobs.push({ ...job, runAt: runAt.toISOString(), id });
    return id;
  }
  async cancelForLead(leadId: string, filter: (j: JobSpec) => boolean = () => true) {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => !(j.leadId === leadId && filter(j)));
    return before - this.jobs.length;
  }
  async list(leadId?: string) {
    return this.jobs.filter((j) => !leadId || j.leadId === leadId);
  }
  async runDue(handler: JobHandler, now = new Date()) {
    const due = this.jobs.filter((j) => new Date(j.runAt) <= now);
    this.jobs = this.jobs.filter((j) => new Date(j.runAt) > now);
    for (const j of due) {
      try {
        const r = await handler(j);
        if (r && r.rescheduleAt) await this.schedule(j, r.rescheduleAt);
      } catch (e) {
        console.warn(`[fila] job ${j.type} falhou: ${(e as Error).message}`);
      }
    }
    return due.length;
  }
}

const QUEUE = "agente-cadencias";

/** BullMQ + Redis (produção): jobs atrasados com id por lead para permitir cancelamento. */
export class BullScheduler implements Scheduler {
  private queue: Queue;
  constructor(private connection: Redis) {
    this.queue = new Queue(QUEUE, { connection });
  }
  async schedule(job: JobSpec, runAt: Date) {
    const delay = Math.max(0, runAt.getTime() - Date.now());
    const j = await this.queue.add(job.type, job, { delay, removeOnComplete: 1000, removeOnFail: 1000, attempts: 3, backoff: { type: "exponential", delay: 60_000 } });
    return j.id!;
  }
  async cancelForLead(leadId: string, filter: (j: JobSpec) => boolean = () => true) {
    const jobs = await this.queue.getJobs(["delayed", "waiting", "prioritized"]);
    let n = 0;
    for (const j of jobs) {
      if (j?.data?.leadId === leadId && filter(j.data)) {
        await j.remove();
        n++;
      }
    }
    return n;
  }
  async list(leadId?: string) {
    const jobs = await this.queue.getJobs(["delayed", "waiting"]);
    return jobs
      .filter((j) => j && (!leadId || j.data.leadId === leadId))
      .map((j) => ({ ...(j.data as JobSpec), id: j.id!, runAt: new Date(j.timestamp + (j.opts.delay ?? 0)).toISOString() }));
  }
  /** Agenda repetíveis (resumo às 8h, CSV diário, retenção LGPD). */
  async ensureRepeatables(tz: string) {
    await this.queue.upsertJobScheduler("resumo_diario", { pattern: "0 8 * * *", tz }, { name: "resumo_diario", data: { type: "resumo_diario" } });
    await this.queue.upsertJobScheduler("export_csv", { pattern: "5 0 * * *", tz }, { name: "export_csv", data: { type: "export_csv" } });
    await this.queue.upsertJobScheduler("retencao_lgpd", { pattern: "30 3 * * *", tz }, { name: "retencao_lgpd", data: { type: "retencao_lgpd" } });
  }
  startWorker(handler: JobHandler) {
    return new Worker(
      QUEUE,
      async (job: Job<JobSpec>) => {
        const r = await handler(job.data);
        if (r && r.rescheduleAt) await this.schedule(job.data, r.rescheduleAt);
      },
      { connection: this.connection, concurrency: 5 },
    );
  }
}

export function redisConnection(url: string) {
  return new Redis(url, { maxRetriesPerRequest: null });
}
