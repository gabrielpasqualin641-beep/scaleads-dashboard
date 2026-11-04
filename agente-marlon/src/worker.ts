import { config } from "./config.js";
import { buildApp } from "./app.js";
import { runJob } from "./queue/jobs.js";
import { BullScheduler } from "./queue/scheduler.js";

// Worker separado (opcional). Com WORKER_INLINE=false no servidor, rode este processo à parte.
// Observação: o painel em tempo real vê os eventos do processo do servidor; mensagens enviadas pelo worker
// aparecem no painel ao recarregar a conversa (ou rode o worker inline para tempo real total).
const app = buildApp();
if (!(app.scheduler instanceof BullScheduler)) throw new Error("O worker precisa de QUEUE_MODE=bullmq");
await app.scheduler.ensureRepeatables(config.TZ_OPERACAO);
app.scheduler.startWorker((job) => runJob(app.deps, job));
console.log("[worker] cadências em execução");
