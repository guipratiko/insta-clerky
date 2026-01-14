import { Router } from 'express';
import instanceRoutes from './instance.routes';
import automationRoutes from './automation.routes';
import reportRoutes from './report.routes';

const router = Router();

// Rotas de Instâncias Instagram
router.use('/instagram/instances', instanceRoutes);

// Rotas de Automações
router.use('/instagram/automations', automationRoutes);

// Rotas de Relatórios
router.use('/instagram/reports', reportRoutes);

export default router;
