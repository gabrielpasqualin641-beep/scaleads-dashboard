import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { clientsRouter } from './routes/clients.routes.js';
import { accountsRouter } from './routes/accounts.routes.js';
import { dashboardRouter } from './routes/dashboard.routes.js';
import { metaMcpRouter } from './routes/metaMcp.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { usersRouter } from './routes/users.routes.js';
import { analysisRouter } from './routes/analysis.routes.js';
import { requireAuth } from './middleware/requireAuth.js';
import { AuthService } from './services/AuthService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
// O snapshot do MCP traz as séries diárias de várias contas e passa dos 100 KB
// que o Express aceita por padrão.
app.use(express.json({ limit: '25mb' }));

// Request logger limpo (sem expor credenciais)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[API] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'ScaleAds Meta Performance API'
  });
});

// Login é a única rota de dados aberta — todo o resto exige sessão válida.
app.use('/api/auth', authRouter);

app.use('/api/users', requireAuth, usersRouter);
app.use('/api/clients', requireAuth, clientsRouter);
app.use('/api/accounts', requireAuth, accountsRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/analysis', requireAuth, analysisRouter);
// A autenticação do meta-mcp fica dentro do router: POST /snapshot aceita a
// chave de ingestão, o resto exige sessão de editor.
app.use('/api/meta-mcp', metaMcpRouter);

/**
 * Serve o painel já compilado, quando existir.
 *
 * Com isso um único processo na porta 3001 entrega API e interface — é o que
 * permite deixar o backend rodando sozinho no logon, sem depender do Vite.
 * Em desenvolvimento a pasta não existe e o Vite continua servindo o front.
 */
const CLIENT_DIST = path.resolve(process.cwd(), 'dist/client');

if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  app.use(express.static(CLIENT_DIST));

  // SPA: qualquer rota que não seja /api cai no index.html.
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Unhandled API Error]', err?.message || err);
  res.status(500).json({
    success: false,
    error: 'Ocorreu um erro interno no servidor ao processar sua solicitação.'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 [Server] Backend rodando com sucesso em http://localhost:${PORT}`);
  // Primeiro boot: cria o admin inicial a partir do .env.
  const bootstrap = AuthService.bootstrapAdminFromEnv();
  if (bootstrap.created) {
    console.log('👤 [Auth] Administrador inicial criado a partir do .env.');
  }

  const auth = AuthService.configStatus();
  if (auth.configured) {
    console.log('🔒 [Auth] Login habilitado — rotas protegidas por papel e escopo de cliente.');
  } else {
    console.warn(`⚠️  [Auth] Login NÃO configurado. Pendente: ${auth.missing.join(', ')}`);
  }
});
