import { createPasswordHash } from '../services/AuthService.js';

/**
 * Gera o valor de ADMIN_PASSWORD_HASH para o .env.
 *
 *   npm run auth:hash -- "minha-senha"
 *
 * A senha entra por argumento e só é usada em memória — nada é gravado em disco
 * por este script além do hash impresso na saída.
 */
const password = process.argv[2];

if (!password) {
  console.error('Uso: npm run auth:hash -- "sua-senha"');
  process.exit(1);
}

console.log(createPasswordHash(password));
