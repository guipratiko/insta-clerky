import { Request, Response, NextFunction } from 'express';
import { META_CONFIG } from '../config/constants';
import { handleControllerError } from '../utils/errorHelpers';
import { processWebhook } from '../services/webhookProcessor';

/**
 * Verificar webhook do Meta (GET request)
 */
export const verifyWebhook = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === META_CONFIG.VERIFY_TOKEN) {
      console.log('✅ Webhook verificado com sucesso!');
      return res.status(200).send(challenge);
    }

    console.error('❌ Token inválido ou modo incorreto');
    return res.sendStatus(403);
  } catch (error: unknown) {
    return next(handleControllerError(error, 'Erro ao verificar webhook'));
  }
};

/**
 * Receber eventos do webhook do Meta (POST request)
 */
export const handleWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { instanceName } = req.params;
    const body = req.body;

    console.log(`📨 Webhook recebido para instância: ${instanceName}`);
    console.log('📦 Dados:', JSON.stringify(body, null, 2));

    // Processar webhook de forma assíncrona
    // Não aguardar para retornar resposta rápida ao Meta
    processWebhook(instanceName, body).catch((error) => {
      console.error('❌ Erro ao processar webhook (assíncrono):', error);
    });

    // Retornar 200 OK imediatamente para o Meta
    res.status(200).send('EVENT_RECEIVED');
  } catch (error: unknown) {
    console.error('❌ Erro ao processar webhook:', error);
    // Mesmo com erro, retornar 200 para evitar retentativas do Meta
    res.status(200).send('EVENT_RECEIVED');
  }
};
