import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createValidationError,
  createNotFoundError,
  handleControllerError,
} from '../utils/errorHelpers';
import { AutomationService, ResponseSequenceItem } from '../services/automationService';

interface CreateAutomationBody {
  instanceId: string;
  name: string;
  type: 'dm' | 'comment';
  triggerType: 'keyword' | 'all';
  keywords?: string[];
  responseText: string;
  responseType: 'direct' | 'comment';
  responseSequence?: ResponseSequenceItem[];
  delaySeconds?: number;
  isActive?: boolean;
}

interface UpdateAutomationBody {
  name?: string;
  triggerType?: 'keyword' | 'all';
  keywords?: string[];
  responseText?: string;
  responseType?: 'direct' | 'comment';
  responseSequence?: ResponseSequenceItem[];
  delaySeconds?: number;
  isActive?: boolean;
}

/**
 * Validar URL de mídia
 */
function validateMediaUrl(url: string, type: 'image' | 'video' | 'audio'): boolean {
  if (!url.startsWith('https://')) {
    return false;
  }

  const urlLower = url.toLowerCase();
  const validExtensions: Record<string, string[]> = {
    image: ['jpg', 'jpeg', 'png'],
    video: ['mp4', 'ogg', 'avi', 'mov', 'webm'],
    audio: ['aac', 'm4a', 'wav', 'mp4', 'mp3'],
  };

  const extensions = validExtensions[type] || [];
  return extensions.some((ext) => urlLower.endsWith(`.${ext}`));
}

/**
 * Validar sequência de resposta
 */
function validateResponseSequence(sequence: ResponseSequenceItem[]): string | null {
  if (sequence.length === 0) {
    return 'Sequência não pode estar vazia';
  }

  if (sequence.length > 4) {
    return 'Sequência pode ter no máximo 4 mensagens';
  }

  for (let i = 0; i < sequence.length; i++) {
    const item = sequence[i];
    
    if (!['text', 'image', 'video', 'audio'].includes(item.type)) {
      return `Tipo inválido na mensagem ${i + 1}: ${item.type}`;
    }

    if (!item.content || item.content.trim().length === 0) {
      return `Conteúdo não pode estar vazio na mensagem ${i + 1}`;
    }

    if (item.delay < 0 || !Number.isInteger(item.delay)) {
      return `Delay deve ser um número inteiro não negativo na mensagem ${i + 1}`;
    }

    // Validar URL para tipos de mídia
    if (item.type !== 'text') {
      if (!validateMediaUrl(item.content, item.type)) {
        return `URL inválida na mensagem ${i + 1}. Deve ser HTTPS e ter extensão válida para ${item.type}`;
      }
    }
  }

  return null;
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
      responseSequence,
      delaySeconds,
      isActive,
    }: CreateAutomationBody = req.body;

    // Validações básicas
    if (!instanceId || !name || !type || !triggerType || !responseType) {
      return next(createValidationError('Todos os campos obrigatórios devem ser preenchidos'));
    }

    // Validações específicas por tipo de resposta
    if (responseType === 'comment') {
      // Comentários: apenas texto, sem sequência
      if (!responseText || responseText.trim().length === 0) {
        return next(createValidationError('Texto da resposta é obrigatório para comentários'));
      }
      if (responseSequence && responseSequence.length > 0) {
        return next(createValidationError('Comentários não suportam sequência de mensagens. Use apenas texto.'));
      }
    } else if (responseType === 'direct') {
      // DM: sequência obrigatória
      if (!responseSequence || responseSequence.length === 0) {
        return next(createValidationError('Sequência de mensagens é obrigatória para Direct Messages'));
      }
      const sequenceError = validateResponseSequence(responseSequence);
      if (sequenceError) {
        return next(createValidationError(sequenceError));
      }
      // DM não deve ter responseText quando tem sequência
      if (responseText && responseText.trim().length > 0) {
        return next(createValidationError('Direct Messages com sequência não devem ter responseText. Use a sequência de mensagens.'));
      }
    }

    if (name.trim().length < 3) {
      return next(createValidationError('Nome deve ter no mínimo 3 caracteres'));
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
      responseText: responseType === 'comment' ? (responseText || '').trim() : '',
      responseType,
      responseSequence: responseType === 'direct' ? responseSequence : undefined,
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
      responseSequence,
      delaySeconds,
      isActive,
    }: UpdateAutomationBody = req.body;

    if (!userId) {
      return next(createValidationError('Usuário não autenticado'));
    }

    if (name && name.trim().length < 3) {
      return next(createValidationError('Nome deve ter no mínimo 3 caracteres'));
    }

    // Buscar automação atual para verificar o triggerType atual
    const currentAutomation = await AutomationService.getById(id, userId);
    if (!currentAutomation) {
      return next(createNotFoundError('Automação'));
    }

    // Determinar responseType final
    const finalResponseType = responseType || currentAutomation.responseType;

    // Validações específicas por tipo de resposta
    if (finalResponseType === 'comment') {
      // Comentários: apenas texto, sem sequência
      if (responseText !== undefined && responseText.trim().length === 0) {
        return next(createValidationError('Texto da resposta não pode estar vazio para comentários'));
      }
      if (responseSequence !== undefined && responseSequence.length > 0) {
        return next(createValidationError('Comentários não suportam sequência de mensagens. Use apenas texto.'));
      }
    } else if (finalResponseType === 'direct') {
      // DM: sequência obrigatória se estiver atualizando
      if (responseSequence !== undefined) {
        if (responseSequence.length === 0) {
          return next(createValidationError('Sequência de mensagens não pode estar vazia para Direct Messages'));
        }
        const sequenceError = validateResponseSequence(responseSequence);
        if (sequenceError) {
          return next(createValidationError(sequenceError));
        }
      } else if (responseType === 'direct' && currentAutomation.responseType === 'comment') {
        // Mudando de comment para direct - sequência obrigatória
        return next(createValidationError('Ao mudar para Direct Messages, é necessário fornecer uma sequência de mensagens'));
      }
      // DM não deve ter responseText quando tem sequência
      if (responseText !== undefined && responseText.trim().length > 0 && 
          (responseSequence !== undefined || currentAutomation.responseSequence)) {
        return next(createValidationError('Direct Messages com sequência não devem ter responseText. Use a sequência de mensagens.'));
      }
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
    if (responseType) updateData.responseType = responseType;
    
    // Atualizar responseText apenas para comentários
    if (responseText !== undefined) {
      if (finalResponseType === 'comment') {
        updateData.responseText = responseText.trim();
      } else {
        updateData.responseText = ''; // Limpar se mudou para direct
      }
    }
    
    // Atualizar responseSequence apenas para DM
    if (responseSequence !== undefined) {
      if (finalResponseType === 'direct') {
        updateData.responseSequence = responseSequence;
      } else {
        updateData.responseSequence = undefined; // Limpar se mudou para comment
      }
    }
    
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
