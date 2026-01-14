import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createValidationError,
  createNotFoundError,
  handleControllerError,
} from '../utils/errorHelpers';
import { AutomationService } from '../services/automationService';

interface CreateAutomationBody {
  instanceId: string;
  name: string;
  type: 'dm' | 'comment';
  triggerType: 'keyword' | 'all';
  keywords?: string[];
  responseText: string;
  responseType: 'direct' | 'comment';
  delaySeconds?: number;
  isActive?: boolean;
}

interface UpdateAutomationBody {
  name?: string;
  triggerType?: 'keyword' | 'all';
  keywords?: string[];
  responseText?: string;
  responseType?: 'direct' | 'comment';
  delaySeconds?: number;
  isActive?: boolean;
}

/**
 * Criar nova automação
 */
export const createAutomation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(createValidationError('Usuário não autenticado'));
    }

    const {
      instanceId,
      name,
      type,
      triggerType,
      keywords,
      responseText,
      responseType,
      delaySeconds,
      isActive,
    }: CreateAutomationBody = req.body;

    // Validações
    if (!instanceId || !name || !type || !triggerType || !responseText || !responseType) {
      return next(createValidationError('Todos os campos obrigatórios devem ser preenchidos'));
    }

    if (name.trim().length < 3) {
      return next(createValidationError('Nome deve ter no mínimo 3 caracteres'));
    }

    if (responseText.trim().length === 0) {
      return next(createValidationError('Texto da resposta não pode estar vazio'));
    }

    // Validação rigorosa para palavras-chave quando triggerType é 'keyword'
    if (triggerType === 'keyword') {
      if (!keywords || keywords.length === 0) {
        return next(createValidationError('É necessário informar pelo menos uma palavra-chave quando o tipo de trigger é "Palavra-chave"'));
      }
      
      // Verificar se todas as palavras-chave não estão vazias após trim
      const validKeywords = keywords.filter((keyword) => keyword && keyword.trim().length > 0);
      if (validKeywords.length === 0) {
        return next(createValidationError('As palavras-chave não podem estar vazias. Informe pelo menos uma palavra-chave válida'));
      }
      
      // Atualizar keywords para remover strings vazias
      keywords.splice(0, keywords.length, ...validKeywords.map((k) => k.trim()));
    }

    // Validação do delay
    if (delaySeconds !== undefined && (delaySeconds < 0 || !Number.isInteger(delaySeconds))) {
      return next(createValidationError('Delay deve ser um número inteiro não negativo (em segundos)'));
    }

    const automation = await AutomationService.create({
      userId,
      instanceId,
      name: name.trim(),
      type,
      triggerType,
      keywords: triggerType === 'keyword' ? keywords : undefined,
      responseText: responseText.trim(),
      responseType,
      delaySeconds: delaySeconds !== undefined ? delaySeconds : 0,
      isActive: isActive !== undefined ? isActive : true,
    });

    res.status(201).json({
      status: 'success',
      data: automation,
    });
  } catch (error: unknown) {
    return next(handleControllerError(error, 'Erro ao criar automação'));
  }
};

/**
 * Listar automações do usuário
 */
export const getAutomations = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { instanceId } = req.query;

    if (!userId) {
      return next(createValidationError('Usuário não autenticado'));
    }

    const automations = await AutomationService.getByUserId(
      userId,
      instanceId as string | undefined
    );

    res.status(200).json({
      status: 'success',
      data: automations,
    });
  } catch (error: unknown) {
    return next(handleControllerError(error, 'Erro ao listar automações'));
  }
};

/**
 * Obter automação por ID
 */
export const getAutomationById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return next(createValidationError('Usuário não autenticado'));
    }

    const automation = await AutomationService.getById(id, userId);

    if (!automation) {
      return next(createNotFoundError('Automação'));
    }

    res.status(200).json({
      status: 'success',
      data: automation,
    });
  } catch (error: unknown) {
    return next(handleControllerError(error, 'Erro ao buscar automação'));
  }
};

/**
 * Atualizar automação
 */
export const updateAutomation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const {
      name,
      triggerType,
      keywords,
      responseText,
      responseType,
      delaySeconds,
      isActive,
    }: UpdateAutomationBody = req.body;

    if (!userId) {
      return next(createValidationError('Usuário não autenticado'));
    }

    if (name && name.trim().length < 3) {
      return next(createValidationError('Nome deve ter no mínimo 3 caracteres'));
    }

    if (responseText && responseText.trim().length === 0) {
      return next(createValidationError('Texto da resposta não pode estar vazio'));
    }

    // Buscar automação atual para verificar o triggerType atual
    const currentAutomation = await AutomationService.getById(id, userId);
    if (!currentAutomation) {
      return next(createNotFoundError('Automação'));
    }

    // Validação rigorosa para palavras-chave quando triggerType é 'keyword'
    const finalTriggerType = triggerType || currentAutomation.triggerType;
    if (finalTriggerType === 'keyword') {
      // Se está mudando para 'keyword' ou já é 'keyword' e está atualizando keywords
      if (triggerType === 'keyword' || (triggerType === undefined && currentAutomation.triggerType === 'keyword')) {
        // Se keywords foi fornecido, validar
        if (keywords !== undefined) {
          if (keywords.length === 0) {
            return next(createValidationError('É necessário informar pelo menos uma palavra-chave quando o tipo de trigger é "Palavra-chave"'));
          }
          
          // Verificar se todas as palavras-chave não estão vazias após trim
          const validKeywords = keywords.filter((keyword) => keyword && keyword.trim().length > 0);
          if (validKeywords.length === 0) {
            return next(createValidationError('As palavras-chave não podem estar vazias. Informe pelo menos uma palavra-chave válida'));
          }
          
          // Atualizar keywords para remover strings vazias
          keywords.splice(0, keywords.length, ...validKeywords.map((k) => k.trim()));
        } else if (triggerType === 'keyword' && currentAutomation.triggerType !== 'keyword') {
          // Se está mudando de 'all' para 'keyword' mas não forneceu keywords
          return next(createValidationError('É necessário informar pelo menos uma palavra-chave ao mudar o tipo de trigger para "Palavra-chave"'));
        }
      }
    }

    // Validação do delay
    if (delaySeconds !== undefined && (delaySeconds < 0 || !Number.isInteger(delaySeconds))) {
      return next(createValidationError('Delay deve ser um número inteiro não negativo (em segundos)'));
    }

    const updateData: UpdateAutomationBody = {};
    if (name) updateData.name = name.trim();
    if (triggerType) updateData.triggerType = triggerType;
    if (keywords !== undefined) updateData.keywords = keywords;
    if (responseText) updateData.responseText = responseText.trim();
    if (responseType) updateData.responseType = responseType;
    if (delaySeconds !== undefined) updateData.delaySeconds = delaySeconds;
    if (isActive !== undefined) updateData.isActive = isActive;

    const automation = await AutomationService.update(id, userId, updateData);

    if (!automation) {
      return next(createNotFoundError('Automação'));
    }

    res.status(200).json({
      status: 'success',
      data: automation,
    });
  } catch (error: unknown) {
    return next(handleControllerError(error, 'Erro ao atualizar automação'));
  }
};

/**
 * Deletar automação
 */
export const deleteAutomation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return next(createValidationError('Usuário não autenticado'));
    }

    const deleted = await AutomationService.delete(id, userId);

    if (!deleted) {
      return next(createNotFoundError('Automação'));
    }

    res.status(200).json({
      status: 'success',
      message: 'Automação deletada com sucesso',
    });
  } catch (error: unknown) {
    return next(handleControllerError(error, 'Erro ao deletar automação'));
  }
};

/**
 * Ativar/Desativar automação
 */
export const toggleAutomation = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return next(createValidationError('Usuário não autenticado'));
    }

    const automation = await AutomationService.getById(id, userId);

    if (!automation) {
      return next(createNotFoundError('Automação'));
    }

    const updated = await AutomationService.update(id, userId, {
      isActive: !automation.isActive,
    });

    if (!updated) {
      return next(createNotFoundError('Automação'));
    }

    res.status(200).json({
      status: 'success',
      data: updated,
    });
  } catch (error: unknown) {
    return next(handleControllerError(error, 'Erro ao alternar automação'));
  }
};
