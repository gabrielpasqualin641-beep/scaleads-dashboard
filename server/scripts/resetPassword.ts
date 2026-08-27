import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { db } from '../db/database.js';
import { createPasswordHash } from '../services/AuthService.js';
import { UserService } from '../services/UserService.js';

const terminal = readline.createInterface({ input, output });

try {
  const email = (await terminal.question('E-mail do usuário: ')).trim().toLowerCase();
  const password = await terminal.question('Nova senha: ');
  const user = db.getUserByEmail(email);

  if (!user) {
    throw new Error('Usuário não encontrado.');
  }

  const validationError = UserService.validatePassword(password);
  if (validationError) {
    throw new Error(validationError);
  }

  db.updateUser(user.id, { passwordHash: createPasswordHash(password), mustChangePassword: false });
  console.log('Senha atualizada com sucesso.');
} catch (error: any) {
  console.error(error?.message || 'Não foi possível atualizar a senha.');
  process.exitCode = 1;
} finally {
  terminal.close();
}