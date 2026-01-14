import { Router } from 'express';
import * as webhookController from '../controllers/webhookController';

const router = Router();

// Webhook não requer autenticação (usa verify token)
router.get('/instagram/:instanceName', webhookController.verifyWebhook);
router.post('/instagram/:instanceName', webhookController.handleWebhook);

export default router;
