import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createValidationError,
  createNotFoundError,
  handleControllerError,
} from '../utils/errorHelpers';
import { InstanceService } from '../services/instanceService';
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getInstagramAccountInfo,
} from '../services/metaAPIService';
import { META_CONFIG } from '../config/constants';
import { emitInstagramUpdate } from '../socket/socketClient';

interface CreateInstanceBody {
  name: string;
}

interface UpdateInstanceBody {
  name?: string;
  status?: 'created' | 'connecting' | 'connected' | 'disconnected' | 'error';
}

/**
 * Criar nova instância Instagram
 */
export const createInstance = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(createValidationError('Usuário não autenticado'));
    }

    const { name }: CreateInstanceBody = req.body;

    if (!name || name.trim().length < 3) {
      return next(createValidationError('Nome deve ter no mínimo 3 caracteres'));
    }

    const instance = await InstanceService.create({
      userId,
      name: name.trim(),
    });

    res.status(201).json({
      status: 'success',
      data: {
        id: instance._id,
        instanceName: instance.instanceName,
        name: instance.name,
        status: instance.status,
        createdAt: instance.createdAt,
      },
    });
  } catch (error: unknown) {
    return next(handleControllerError(error, 'Erro ao criar instância'));
  }
};

/**
 * Listar instâncias do usuário
 */
export const getInstances = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(createValidationError('Usuário não autenticado'));
    }

    const instances = await InstanceService.getByUserId(userId);

    res.status(200).json({
      status: 'success',
      data: instances.map((instance) => ({
        id: instance._id,
        instanceName: instance.instanceName,
        name: instance.name,
        username: instance.username,
        status: instance.status,
        tokenExpiresAt: instance.tokenExpiresAt,
        createdAt: instance.createdAt,
        updatedAt: instance.updatedAt,
      })),
    });
  } catch (error: unknown) {
    return next(handleControllerError(error, 'Erro ao listar instâncias'));
  }
};

/**
 * Obter instância por ID
 */
export const getInstanceById = async (
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

    const instance = await InstanceService.getById(id, userId);

    if (!instance) {
      return next(createNotFoundError('Instância'));
    }

    res.status(200).json({
      status: 'success',
      data: {
        id: instance._id,
        instanceName: instance.instanceName,
        name: instance.name,
        username: instance.username,
        pageName: instance.pageName,
        status: instance.status,
        tokenExpiresAt: instance.tokenExpiresAt,
        createdAt: instance.createdAt,
        updatedAt: instance.updatedAt,
      },
    });
  } catch (error: unknown) {
    return next(handleControllerError(error, 'Erro ao buscar instância'));
  }
};

/**
 * Atualizar instância
 */
export const updateInstance = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { name, status }: UpdateInstanceBody = req.body;

    if (!userId) {
      return next(createValidationError('Usuário não autenticado'));
    }

    if (name && name.trim().length < 3) {
      return next(createValidationError('Nome deve ter no mínimo 3 caracteres'));
    }

    const updateData: { name?: string; status?: string } = {};
    if (name) updateData.name = name.trim();
    if (status) updateData.status = status;

    const instance = await InstanceService.update(id, userId, updateData);

    if (!instance) {
      return next(createNotFoundError('Instância'));
    }

    res.status(200).json({
      status: 'success',
      data: {
        id: instance._id,
        instanceName: instance.instanceName,
        name: instance.name,
        status: instance.status,
        updatedAt: instance.updatedAt,
      },
    });
  } catch (error: unknown) {
    return next(handleControllerError(error, 'Erro ao atualizar instância'));
  }
};

/**
 * Deletar instância
 */
export const deleteInstance = async (
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

    const deleted = await InstanceService.delete(id, userId);

    if (!deleted) {
      return next(createNotFoundError('Instância'));
    }

    res.status(200).json({
      status: 'success',
      message: 'Instância deletada com sucesso',
    });
  } catch (error: unknown) {
    return next(handleControllerError(error, 'Erro ao deletar instância'));
  }
};

/**
 * Iniciar fluxo OAuth
 */
export const initiateOAuth = async (
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

    const instance = await InstanceService.getById(id, userId);

    if (!instance) {
      return next(createNotFoundError('Instância'));
    }

    // Atualizar status para connecting
    await InstanceService.update(id, userId, { status: 'connecting' });

    // Construir URL de autorização
    const scopes = [
      'instagram_business_basic',
      'instagram_business_manage_messages',
      'instagram_business_manage_comments',
      'instagram_business_content_publish',
      'instagram_business_manage_insights',
    ];

    const authUrl = `https://www.instagram.com/oauth/authorize?` +
      `client_id=${META_CONFIG.APP_ID}` +
      `&redirect_uri=${encodeURIComponent(META_CONFIG.REDIRECT_URI)}` +
      `&scope=${scopes.join(',')}` +
      `&response_type=code` +
      `&state=${id}`; // Passar ID da instância no state

    res.status(200).json({
      status: 'success',
      data: {
        authUrl,
        instanceId: id,
      },
    });
  } catch (error: unknown) {
    return next(handleControllerError(error, 'Erro ao iniciar OAuth'));
  }
};

/**
 * Callback OAuth
 */
export const handleOAuthCallback = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { code, state: instanceId, error } = req.query;

    if (error) {
      console.error('❌ Erro no OAuth:', error);
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/gerenciador-conexoes?error=oauth_failed`);
    }

    if (!code || !instanceId) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/gerenciador-conexoes?error=no_code`);
    }

    // Trocar código por token de curta duração
    const tokenData = await exchangeCodeForToken(code as string);

    // Trocar por long-lived token
    const longLivedTokenData = await exchangeForLongLivedToken(tokenData.access_token);

    // Obter informações da conta
    const accountInfo = await getInstagramAccountInfo(longLivedTokenData.access_token);

    // Calcular data de expiração (60 dias)
    const expiresIn = longLivedTokenData.expires_in || 5184000; // 60 dias em segundos
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    // Buscar instância (não precisa de userId aqui pois já temos o ID)
    const instance = await InstanceService.getByInstanceName(instanceId as string);
    if (!instance) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/gerenciador-conexoes?error=instance_not_found`);
    }

    // Conectar instância
    await InstanceService.connectInstance(
      instance._id.toString(),
      instance.userId.toString(),
      {
        instagramAccountId: accountInfo.id,
        username: accountInfo.username,
        accessToken: longLivedTokenData.access_token,
        pageId: accountInfo.id,
        pageName: accountInfo.name || accountInfo.username,
        tokenExpiresAt,
        webhookIds: [accountInfo.id],
      }
    );

    // Emitir atualização via Socket.io
    emitInstagramUpdate(instance.userId.toString(), {
      instanceId: instance._id.toString(),
      status: 'connected',
    });

    console.log(`✅ Conta Instagram conectada: @${accountInfo.username} (ID: ${accountInfo.id})`);

    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/gerenciador-conexoes?connected=success`);
  } catch (error: unknown) {
    console.error('❌ Erro no callback OAuth:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/gerenciador-conexoes?error=${encodeURIComponent(errorMessage)}`);
  }
};

/**
 * Renovar token de acesso
 */
export const refreshToken = async (
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

    const instance = await InstanceService.getById(id, userId);

    if (!instance) {
      return next(createNotFoundError('Instância'));
    }

    // Importar service de refresh
    const { refreshInstanceToken } = await import('../services/tokenRefreshService');
    const success = await refreshInstanceToken(id);

    if (!success) {
      return next(handleControllerError(new Error('Erro ao renovar token'), 'Erro ao renovar token'));
    }

    res.status(200).json({
      status: 'success',
      message: 'Token renovado com sucesso',
    });
  } catch (error: unknown) {
    return next(handleControllerError(error, 'Erro ao renovar token'));
  }
};
