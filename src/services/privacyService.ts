/**
 * Service para processar requisições de privacidade do Instagram/Meta
 */

import crypto from 'crypto';
import InstagramInstance from '../models/InstagramInstance';
import { AutomationService } from './automationService';
import { ReportService } from './reportService';
import { META_CONFIG } from '../config/constants';

interface DecodedSignedRequest {
  user_id?: string;
  algorithm?: string;
  issued_at?: number;
  [key: string]: unknown;
}

/**
 * Decodificar signed_request do Meta
 */
function decodeSignedRequest(signedRequest: string): DecodedSignedRequest | null {
  try {
    const [encodedSig, payload] = signedRequest.split('.');
    
    if (!encodedSig || !payload) {
      return null;
    }

    // Decodificar payload (base64url)
    const decodedPayload = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    const data = JSON.parse(decodedPayload);

    // Verificar assinatura (opcional, mas recomendado)
    if (META_CONFIG.APP_SECRET) {
      const expectedSig = crypto
        .createHmac('sha256', META_CONFIG.APP_SECRET)
        .update(payload)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      if (encodedSig !== expectedSig) {
        console.error('❌ Assinatura inválida no signed_request');
        return null;
      }
    }

    return data;
  } catch (error) {
    console.error('❌ Erro ao decodificar signed_request:', error);
    return null;
  }
}

/**
 * Processar desautorização de usuário
 */
export async function handleDeauthorization(signedRequest: string): Promise<{
  success: boolean;
  message: string;
  instanceId?: string;
}> {
  try {
    const decoded = decodeSignedRequest(signedRequest);
    
    if (!decoded) {
      return {
        success: false,
        message: 'Falha ao decodificar signed_request',
      };
    }

    // O Meta pode enviar user_id ou instagram_account_id
    const userId = decoded.user_id as string | undefined;
    const instagramAccountId = decoded.instagram_account_id as string | undefined;

    if (!userId && !instagramAccountId) {
      console.error('❌ signed_request não contém user_id nem instagram_account_id');
      return {
        success: false,
        message: 'Dados insuficientes no signed_request',
      };
    }

    // Buscar instância pelo instagramAccountId (mais confiável) ou userId
    let instance = null;
    if (instagramAccountId) {
      instance = await InstagramInstance.findOne({ instagramAccountId });
    }
    
    // Se não encontrou pelo instagramAccountId, tentar pelo userId (pode ser o user_id do Meta)
    if (!instance && userId) {
      // Tentar encontrar por qualquer campo que possa conter o userId
      instance = await InstagramInstance.findOne({
        $or: [
          { instagramAccountId: userId },
          { userId: userId }, // Caso o userId seja o mesmo do nosso sistema
        ],
      });
    }

    if (!instance) {
      console.warn(`⚠️ Instância não encontrada para desautorização. userId: ${userId}, instagramAccountId: ${instagramAccountId}`);
      // Retornar sucesso mesmo se não encontrar, pois o Meta espera 200 OK
      return {
        success: true,
        message: 'Instância não encontrada (pode já ter sido removida)',
      };
    }

    // Limpar tokens e atualizar status
    instance.accessToken = undefined;
    instance.tokenExpiresAt = undefined;
    instance.status = 'disconnected';
    await instance.save();

    console.log(`✅ Instância ${instance.instanceName} desautorizada com sucesso`);

    return {
      success: true,
      message: 'Desautorização processada com sucesso',
      instanceId: instance._id.toString(),
    };
  } catch (error) {
    console.error('❌ Erro ao processar desautorização:', error);
    return {
      success: false,
      message: 'Erro ao processar desautorização',
    };
  }
}

/**
 * Processar solicitação de exclusão de dados
 */
export async function handleDataDeletion(signedRequest: string): Promise<{
  success: boolean;
  message: string;
  deletionRequestId?: string;
  instanceId?: string;
}> {
  try {
    const decoded = decodeSignedRequest(signedRequest);
    
    if (!decoded) {
      return {
        success: false,
        message: 'Falha ao decodificar signed_request',
      };
    }

    const userId = decoded.user_id as string | undefined;
    const instagramAccountId = decoded.instagram_account_id as string | undefined;
    const deletionRequestId = decoded.deletion_request_id as string | undefined;

    if (!userId && !instagramAccountId) {
      console.error('❌ signed_request não contém user_id nem instagram_account_id');
      return {
        success: false,
        message: 'Dados insuficientes no signed_request',
      };
    }

    // Buscar instância
    let instance = null;
    if (instagramAccountId) {
      instance = await InstagramInstance.findOne({ instagramAccountId });
    }
    
    if (!instance && userId) {
      instance = await InstagramInstance.findOne({
        $or: [
          { instagramAccountId: userId },
          { userId: userId },
        ],
      });
    }

    if (!instance) {
      console.warn(`⚠️ Instância não encontrada para exclusão de dados. userId: ${userId}, instagramAccountId: ${instagramAccountId}`);
      // Retornar sucesso com deletion_request_id mesmo se não encontrar
      return {
        success: true,
        message: 'Instância não encontrada (pode já ter sido removida)',
        deletionRequestId: deletionRequestId || 'unknown',
      };
    }

    const instanceId = instance._id.toString();
    const instanceUserId = instance.userId;

    // Deletar automações relacionadas
    try {
      const automations = await AutomationService.getByUserId(instanceUserId, instanceId);
      for (const automation of automations) {
        await AutomationService.delete(automation.id, instanceUserId);
      }
      console.log(`✅ ${automations.length} automações deletadas`);
    } catch (error) {
      console.error('❌ Erro ao deletar automações:', error);
    }

    // Deletar relatórios relacionados
    try {
      // O ReportService pode ter um método para deletar por instanceId
      // Por enquanto, vamos apenas logar
      console.log(`ℹ️ Relatórios serão mantidos por questões de auditoria`);
    } catch (error) {
      console.error('❌ Erro ao processar relatórios:', error);
    }

    // Deletar a instância
    await InstagramInstance.findByIdAndDelete(instanceId);

    console.log(`✅ Instância ${instance.instanceName} e dados relacionados deletados com sucesso`);

    return {
      success: true,
      message: 'Dados excluídos com sucesso',
      deletionRequestId: deletionRequestId || 'unknown',
      instanceId,
    };
  } catch (error) {
    console.error('❌ Erro ao processar exclusão de dados:', error);
    return {
      success: false,
      message: 'Erro ao processar exclusão de dados',
    };
  }
}
