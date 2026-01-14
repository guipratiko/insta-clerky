/**
 * Service para integração com Meta/Instagram Graph API
 */

import axios, { AxiosError } from 'axios';
import { META_CONFIG } from '../config/constants';

export interface MetaAPIResponse {
  statusCode: number;
  data: unknown;
}

/**
 * Fazer requisição para Meta Graph API
 */
export const requestMetaAPI = async (
  method: string,
  path: string,
  accessToken: string,
  body?: unknown
): Promise<MetaAPIResponse> => {
  const baseUrl = META_CONFIG.BASE_URL;
  const version = META_CONFIG.GRAPH_VERSION;
  const url = `${baseUrl}/${version}${path}`;

  try {
    const config: {
      method: string;
      url: string;
      headers: Record<string, string>;
      params?: Record<string, string>;
      data?: unknown;
    } = {
      method,
      url,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    };

    if (method === 'GET' && body) {
      config.params = body as Record<string, string>;
    } else if (body) {
      config.data = body;
    }

    const response = await axios(config);
    return {
      statusCode: response.status,
      data: response.data,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      throw new Error(
        `Meta API Error: ${axiosError.response?.status} - ${JSON.stringify(axiosError.response?.data)}`
      );
    }
    throw error;
  }
};

/**
 * Trocar código de autorização por access token de curta duração
 */
export const exchangeCodeForToken = async (code: string): Promise<{
  access_token: string;
  user_id: string;
}> => {
  // Validar configurações antes de fazer a requisição
  if (!META_CONFIG.APP_ID) {
    console.error('❌ META_APP_ID não está configurado!');
    throw new Error('Configuração do Meta App ID não encontrada');
  }

  if (!META_CONFIG.APP_SECRET) {
    console.error('❌ META_APP_SECRET não está configurado!');
    throw new Error('Configuração do Meta App Secret não encontrada');
  }

  const apiBaseUrl = META_CONFIG.API_BASE_URL;
  const url = `${apiBaseUrl}/oauth/access_token`;

  // Criar URLSearchParams para enviar como form data no body
  const formData = new URLSearchParams();
  formData.append('client_id', META_CONFIG.APP_ID);
  formData.append('client_secret', META_CONFIG.APP_SECRET);
  formData.append('grant_type', 'authorization_code');
  formData.append('redirect_uri', META_CONFIG.REDIRECT_URI);
  formData.append('code', code);

  console.log('🔐 Fazendo troca de código OAuth por token:', {
    url,
    client_id: META_CONFIG.APP_ID,
    redirect_uri: META_CONFIG.REDIRECT_URI,
    code_present: !!code,
  });

  try {
    const response = await axios.post(url, formData.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      console.error('❌ Erro na troca de código OAuth:', {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
        params_sent: {
          client_id: META_CONFIG.APP_ID ? 'presente' : 'ausente',
          grant_type: 'authorization_code',
          redirect_uri: META_CONFIG.REDIRECT_URI,
          code_present: !!code,
        },
      });
      throw new Error(
        `OAuth Error: ${axiosError.response?.status} - ${JSON.stringify(axiosError.response?.data)}`
      );
    }
    throw error;
  }
};

/**
 * Trocar token de curta duração por long-lived token
 */
export const exchangeForLongLivedToken = async (shortLivedToken: string): Promise<{
  access_token: string;
  token_type: string;
  expires_in: number;
}> => {
  const baseUrl = META_CONFIG.BASE_URL;
  const version = META_CONFIG.GRAPH_VERSION;
  const url = `${baseUrl}/${version}/access_token`;

  try {
    const response = await axios.get(url, {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: META_CONFIG.APP_SECRET,
        access_token: shortLivedToken,
      },
    });

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      throw new Error(
        `Token Exchange Error: ${axiosError.response?.status} - ${JSON.stringify(axiosError.response?.data)}`
      );
    }
    throw error;
  }
};

/**
 * Obter informações da conta Instagram
 */
export const getInstagramAccountInfo = async (accessToken: string): Promise<{
  id: string;
  username: string;
  account_type: string;
  name?: string;
}> => {
  const response = await requestMetaAPI('GET', '/me', accessToken, {
    fields: 'id,username,account_type,name',
  });

  return response.data as {
    id: string;
    username: string;
    account_type: string;
    name?: string;
  };
};

/**
 * Renovar long-lived token
 */
export const refreshLongLivedToken = async (accessToken: string): Promise<{
  access_token: string;
  token_type: string;
  expires_in: number;
}> => {
  const baseUrl = 'https://graph.facebook.com';
  const version = META_CONFIG.GRAPH_VERSION;
  const url = `${baseUrl}/${version}/oauth/access_token`;

  try {
    const response = await axios.get(url, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: META_CONFIG.APP_ID,
        client_secret: META_CONFIG.APP_SECRET,
        fb_exchange_token: accessToken,
      },
    });

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      throw new Error(
        `Token Refresh Error: ${axiosError.response?.status} - ${JSON.stringify(axiosError.response?.data)}`
      );
    }
    throw error;
  }
};

/**
 * Enviar mensagem direta
 */
export const sendDirectMessage = async (
  accessToken: string,
  recipientId: string,
  message: string
): Promise<unknown> => {
  const response = await requestMetaAPI('POST', '/me/messages', accessToken, {
    recipient: { id: recipientId },
    message: { text: message },
  });

  return response.data;
};

/**
 * Responder comentário
 */
export const replyToComment = async (
  accessToken: string,
  commentId: string,
  message: string
): Promise<unknown> => {
  const response = await requestMetaAPI('POST', `/${commentId}/replies`, accessToken, {
    message,
  });

  return response.data;
};
