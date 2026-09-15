import rateLimit from 'express-rate-limit';

/**
 * Limitador de taxa para a rota de login (/api/auth/login).
 * Protege contra ataques de força bruta de credenciais.
 * 5 tentativas por minuto por IP.
 */
export const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Muitas tentativas de login a partir deste IP. Aguarde 1 minuto e tente novamente.'
  }
});

/**
 * Limitador de taxa para a rota de ingestão do snapshot (/api/meta-mcp/snapshot).
 * Protege contra flood de snapshots volumosos de até 25MB.
 * 20 requisições por minuto por IP.
 */
export const snapshotLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Muitas requisições de ingestão enviadas. Aguarde um momento e tente novamente.'
  }
});
