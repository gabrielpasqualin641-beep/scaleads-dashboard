import { Router } from 'express';
import { AnalysisService } from '../services/AnalysisService.js';
import { BriefService } from '../services/BriefService.js';
import { requireRole, requireClientAccess } from '../middleware/requireAuth.js';
import { queryParam } from '../utils/http.js';
import { PeriodSelection } from '../models/types.js';
import { ResearchService, researchConfigured } from '../services/ResearchService.js';
import { DashboardService } from '../services/DashboardService.js';
import { db } from '../db/database.js';

export const analysisRouter = Router();

const scopedByQuery = requireClientAccess(req => queryParam(req, 'clientId'));

function periodFrom(req: Parameters<typeof queryParam>[0]): PeriodSelection {
  return {
    preset: 'custom',
    startDate: queryParam(req, 'startDate') || '',
    endDate: queryParam(req, 'endDate') || '',
    compare: false,
    includeMetaTax: queryParam(req, 'includeMetaTax') !== 'false'
  };
}

analysisRouter.get('/', scopedByQuery, async (req, res) => {
  try {
    const clientId = queryParam(req, 'clientId')!;
    const period = periodFrom(req);

    if (!period.startDate || !period.endDate) {
      return res.status(400).json({ success: false, error: 'startDate e endDate são obrigatórios.' });
    }

    const data = await AnalysisService.analyze(clientId, queryParam(req, 'accountId') || 'all', period);
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[Analysis] Falha:', err?.message || err);
    res.status(500).json({ success: false, error: 'Erro ao gerar a análise.' });
  }
});

analysisRouter.get('/brief', scopedByQuery, (req, res) => {
  const clientId = queryParam(req, 'clientId')!;
  res.json({ success: true, data: BriefService.get(clientId) });
});

analysisRouter.put('/brief', requireRole('editor'), scopedByQuery, (req, res) => {
  try {
    const clientId = queryParam(req, 'clientId')!;
    const brief = BriefService.upsert(clientId, req.body || {}, req.user!.email);
    res.json({ success: true, data: brief });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erro ao salvar o briefing.' });
  }
});

/** Estudo já gravado, se houver, e se a chave está configurada. */
analysisRouter.get('/research', scopedByQuery, (req, res) => {
  const clientId = queryParam(req, 'clientId')!;
  res.json({
    success: true,
    data: { configured: researchConfigured(), study: ResearchService.get(clientId) }
  });
});

/** Gera o estudo. Consome crédito da API, então é ação de editor. */
analysisRouter.post('/research', requireRole('editor'), scopedByQuery, async (req, res) => {
  try {
    const clientId = queryParam(req, 'clientId')!;
    const client = db.getClientById(clientId);
    if (!client) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado.' });
    }

    const period = periodFrom(req);
    if (!period.startDate || !period.endDate) {
      return res.status(400).json({ success: false, error: 'startDate e endDate são obrigatórios.' });
    }

    // O estudo se apoia nos números reais do período: busca o consolidado.
    const overview = await DashboardService.getOverview(clientId, queryParam(req, 'accountId') || 'all', period);

    const study = await ResearchService.generate({
      clientId,
      clientName: client.name,
      brief: BriefService.get(clientId),
      metrics: overview.currentMetrics,
      periodLabel: overview.period.label,
      generatedBy: req.user!.email
    });

    res.json({ success: true, data: study });
  } catch (err: any) {
    const message = err?.message || 'Erro ao gerar o estudo.';
    console.error('[Research] Falha:', message);
    // Chave ausente é erro de configuração, não falha interna.
    const status = /ANTHROPIC_API_KEY/.test(message) ? 503 : 500;
    res.status(status).json({ success: false, error: message });
  }
});
