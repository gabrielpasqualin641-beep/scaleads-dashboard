import { MetaSyncService, defaultRange } from './MetaSyncService.js';

/**
 * Agendador da sincronização com a Meta.
 *
 * Roda dentro do próprio processo, com `setInterval` — o projeto não tem
 * infraestrutura de fila ou worker, e adicionar uma para isto seria maior que o
 * problema. Em hospedagem que hiberna o serviço, o intervalo só corre enquanto
 * o processo estiver de pé.
 *
 * Desligado por padrão: ativa com META_SYNC_ENABLED=true.
 */

const DEFAULT_INTERVAL_MINUTES = 60;

let timer: NodeJS.Timeout | null = null;

function intervalMs(): number {
  const minutes = Number(process.env.META_SYNC_INTERVAL_MINUTES) || DEFAULT_INTERVAL_MINUTES;
  // Menos de 15 minutos não traz dado novo e só consome cota da Meta.
  return Math.max(minutes, 15) * 60_000;
}

async function runOnce(reason: string): Promise<void> {
  try {
    const accounts = MetaSyncService.syncableAccounts();
    if (accounts.length === 0) return;

    console.log(`[Meta sync] Disparo automático (${reason})`);
    await MetaSyncService.syncAll(defaultRange());
  } catch (err) {
    // Falha do agendador nunca derruba o servidor.
    console.error('[Meta sync] Erro no disparo automático:', err instanceof Error ? err.message : err);
  }
}

export function startMetaSyncScheduler(): void {
  if (process.env.META_SYNC_ENABLED !== 'true') return;
  if (timer) return;

  const ms = intervalMs();
  console.log(`🔄 [Meta sync] Agendador ativo · a cada ${ms / 60_000} minuto(s)`);

  // Primeira execução após um minuto, para não competir com a subida do processo.
  setTimeout(() => void runOnce('inicialização'), 60_000);
  timer = setInterval(() => void runOnce('intervalo'), ms);
}

export function stopMetaSyncScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
