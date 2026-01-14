/**
 * Service para processar webhooks do Instagram/Meta
 */

import { InstanceService } from './instanceService';
import { AutomationService } from './automationService';
import { ReportService } from './reportService';
import {
  sendDirectMessage,
  sendDirectMessageImage,
  sendDirectMessageVideo,
  sendDirectMessageAudio,
  replyToComment,
} from './metaAPIService';
import { pgPool } from '../config/databases';
import { emitInstagramUpdate } from '../socket/socketClient';

/**
 * Processar mensagem direta recebida
 */
export const processDirectMessage = async (
  instance: any,
  event: any
): Promise<void> => {
  try {
    const senderId = event.sender?.id;
    const message = event.message;
    const timestamp = event.timestamp;

    if (!senderId || !message || !message.mid) {
      console.warn('⚠️ Mensagem inválida no webhook:', event);
      return;
    }

    const messageText = message.text || '';
    const messageId = message.mid;
    const instanceId = instance._id.toString();
    const userId = instance.userId.toString();

    // Salvar mensagem no banco
    await pgPool.query(
      `INSERT INTO instagram_messages (
        instance_id, user_id, sender_id, recipient_id,
        message_id, text, timestamp, raw_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (message_id, instance_id) DO NOTHING`,
      [
        instanceId,
        userId,
        senderId,
        event.recipient?.id || instance.instagramAccountId || '',
        messageId,
        messageText,
        timestamp,
        JSON.stringify(event),
      ]
    );

    // Buscar automações ativas para DM
    const automation = await AutomationService.findMatchingAutomation(
      instanceId,
      'dm',
      messageText
    );

    if (automation) {
      // Verificar se a instância tem instagramAccountId
      if (!instance.instagramAccountId) {
        console.error(`❌ Instância não tem instagramAccountId`);
        return;
      }

      // Buscar instância com accessToken
      const instanceWithToken = await InstanceService.getByInstagramAccountId(instance.instagramAccountId);
      if (!instanceWithToken || !instanceWithToken.accessToken) {
        console.error(`❌ Instância não encontrada ou sem token`);
        return;
      }

      // Executar automação
      try {
        let allResponses: string[] = [];

        if (automation.responseType === 'direct' && automation.responseSequence) {
          // Processar sequência de mensagens para DM
          for (let i = 0; i < automation.responseSequence.length; i++) {
            const item = automation.responseSequence[i];
            
            // Aplicar delay antes de enviar esta mensagem
            if (item.delay > 0) {
              console.log(`⏳ Aplicando delay de ${item.delay} segundos antes da mensagem ${i + 1}...`);
              await new Promise((resolve) => setTimeout(resolve, item.delay * 1000));
            }

            // Enviar mensagem baseada no tipo
            const pageId = instance.instagramAccountId || instanceWithToken.instagramAccountId;
            if (!pageId) {
              throw new Error('Instagram Account ID não encontrado');
            }

            switch (item.type) {
              case 'text':
                await sendDirectMessage(
                  instanceWithToken.accessToken,
                  senderId,
                  item.content
                );
                allResponses.push(`Texto: ${item.content}`);
                break;
              case 'image':
                await sendDirectMessageImage(
                  instanceWithToken.accessToken,
                  pageId,
                  senderId,
                  item.content
                );
                allResponses.push(`Imagem: ${item.content}`);
                break;
              case 'video':
                await sendDirectMessageVideo(
                  instanceWithToken.accessToken,
                  pageId,
                  senderId,
                  item.content
                );
                allResponses.push(`Vídeo: ${item.content}`);
                break;
              case 'audio':
                await sendDirectMessageAudio(
                  instanceWithToken.accessToken,
                  pageId,
                  senderId,
                  item.content
                );
                allResponses.push(`Áudio: ${item.content}`);
                break;
            }
          }
        } else if (automation.responseType === 'direct' && automation.responseText && automation.responseText.trim().length > 0) {
          // Fallback para automações antigas (apenas texto)
          await sendDirectMessage(
            instanceWithToken.accessToken,
            senderId,
            automation.responseText.trim()
          );
          allResponses.push(automation.responseText);
        } else {
          console.error(`❌ Automação ${automation.id} não tem sequência de mensagens nem texto configurado`);
          throw new Error('Automação de DM não tem sequência de mensagens nem texto configurado');
        }

        // Criar relatório (usar sender_id como username para DM)
        await ReportService.create({
          instanceId,
          userId,
          interactionType: 'dm',
          userIdInstagram: senderId,
          username: senderId, // Para DM, usar sender_id como username
          interactionText: messageText,
          responseText: allResponses.join(' | '),
          responseStatus: 'sent',
          timestamp,
        });

        // Marcar mensagem como respondida
        await pgPool.query(
          `UPDATE instagram_messages SET replied = TRUE WHERE message_id = $1 AND instance_id = $2`,
          [messageId, instanceId]
        );

        console.log(`✅ Automação executada para mensagem ${messageId}`);
      } catch (error) {
        console.error(`❌ Erro ao executar automação:`, error);

        // Criar relatório com status failed
        const failedResponseText = automation.responseSequence
          ? automation.responseSequence.map((item) => `${item.type}: ${item.content}`).join(' | ')
          : automation.responseText || 'Erro ao processar';
        
        await ReportService.create({
          instanceId,
          userId,
          interactionType: 'dm',
          userIdInstagram: senderId,
          username: senderId, // Para DM, usar sender_id como username
          interactionText: messageText,
          responseText: failedResponseText,
          responseStatus: 'failed',
          timestamp,
        });
      }
    }

    // Emitir atualização via Socket.io
    emitInstagramUpdate(userId, {
      type: 'message',
      instanceId,
      messageId,
    });
  } catch (error) {
    console.error('❌ Erro ao processar mensagem direta:', error);
  }
};

/**
 * Processar comentário recebido
 */
export const processComment = async (
  instance: any,
  change: any
): Promise<void> => {
  try {
    const value = change.value;

    if (!value || !value.id || !value.text) {
      console.warn('⚠️ Comentário inválido no webhook:', change);
      return;
    }

    const commentId = value.id;
    const postId = value.media?.id || '';
    const fromUserId = value.from?.id || '';
    const fromUsername = value.from?.username || '';
    const text = value.text;
    const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp
    const instanceId = instance._id.toString();
    const userId = instance.userId.toString();

    // Salvar comentário no banco
    await pgPool.query(
      `INSERT INTO instagram_comments (
        instance_id, user_id, comment_id, post_id, media_id,
        from_user_id, from_username, text, timestamp, raw_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (comment_id) DO NOTHING`,
      [
        instanceId,
        userId,
        commentId,
        postId,
        value.media?.id || null,
        fromUserId,
        fromUsername,
        text,
        timestamp,
        JSON.stringify(change),
      ]
    );

    // Buscar automações ativas para comentários
    const automation = await AutomationService.findMatchingAutomation(
      instanceId,
      'comment',
      text
    );

    if (automation) {
      // Verificar se a instância tem instagramAccountId
      if (!instance.instagramAccountId) {
        console.error(`❌ Instância não tem instagramAccountId`);
        return;
      }

      // Buscar instância com accessToken
      const instanceWithToken = await InstanceService.getByInstagramAccountId(instance.instagramAccountId);
      if (!instanceWithToken || !instanceWithToken.accessToken) {
        console.error(`❌ Instância não encontrada ou sem token`);
        return;
      }

      // Executar automação com delay se configurado
      try {
        // Aplicar delay antes de enviar a resposta
        if (automation.delaySeconds > 0) {
          console.log(`⏳ Aplicando delay de ${automation.delaySeconds} segundos antes de enviar resposta...`);
          await new Promise((resolve) => setTimeout(resolve, automation.delaySeconds * 1000));
        }

        // Substituir variável $user-contact por @username (apenas para comentários)
        let responseText = automation.responseText || '';
        if (fromUsername && responseText) {
          responseText = responseText.replace(/\$user-contact/g, `@${fromUsername}`);
        }

        // Validar que o texto não está vazio antes de enviar
        if (!responseText || responseText.trim().length === 0) {
          console.error(`❌ Automação ${automation.id} não tem texto de resposta configurado`);
          throw new Error('Texto da resposta está vazio. Configure o texto da resposta na automação.');
        }

        if (automation.responseType === 'comment') {
          // Responder no comentário
          await replyToComment(
            instanceWithToken.accessToken,
            commentId,
            responseText
          );
        } else if (automation.responseType === 'direct') {
          // Enviar DM quando recebe comentário
          await sendDirectMessage(
            instanceWithToken.accessToken,
            fromUserId,
            responseText
          );
        }

        // Criar relatório
        await ReportService.create({
          instanceId,
          userId,
          interactionType: 'comment',
          commentId,
          userIdInstagram: fromUserId,
          mediaId: postId,
          username: fromUsername, // Para comentários, usar username real
          interactionText: text,
          responseText: responseText, // Usar texto com variável substituída
          responseStatus: 'sent',
          timestamp,
        });

        // Marcar comentário como respondido
        await pgPool.query(
          `UPDATE instagram_comments 
           SET replied = TRUE, reply_text = $1 
           WHERE comment_id = $2`,
          [automation.responseText, commentId]
        );

        console.log(`✅ Automação executada para comentário ${commentId}`);
      } catch (error) {
        console.error(`❌ Erro ao executar automação:`, error);

        // Criar relatório com status failed
        const failedResponseText = automation.responseText || 'Erro ao processar';
        await ReportService.create({
          instanceId,
          userId,
          interactionType: 'comment',
          commentId,
          userIdInstagram: fromUserId,
          mediaId: postId,
          username: fromUsername, // Para comentários, usar username real
          interactionText: text,
          responseText: failedResponseText,
          responseStatus: 'failed',
          timestamp,
        });
      }
    }

    // Emitir atualização via Socket.io
    emitInstagramUpdate(userId, {
      type: 'comment',
      instanceId,
      commentId,
    });
  } catch (error) {
    console.error('❌ Erro ao processar comentário:', error);
  }
};

/**
 * Processar webhook completo
 * A instância é identificada pelo entry.id (ID da conta Instagram) que vem no evento
 */
export const processWebhook = async (
  body: any
): Promise<void> => {
  try {
    // Verificar se é um evento do Instagram
    if (body.object !== 'instagram') {
      console.warn('⚠️ Webhook não é do Instagram:', body.object);
      return;
    }

    for (const entry of body.entry || []) {
      const recipientId = entry.id; // ID da conta Instagram que recebeu o evento

      if (!recipientId) {
        console.warn('⚠️ Entry sem ID:', entry);
        continue;
      }

      console.log(`🔍 Buscando instância para recipient ID: ${recipientId}`);

      // Buscar instância pelo instagramAccountId ou webhookIds
      let instance = await InstanceService.getByInstagramAccountId(recipientId);

      // Se não encontrou pelo entry.id, tentar buscar pelo recipient.id do evento de mensagem
      if (!instance && entry.messaging && entry.messaging.length > 0) {
        const firstMessage = entry.messaging[0];
        const messageRecipientId = firstMessage.recipient?.id;
        
        if (messageRecipientId && messageRecipientId !== recipientId) {
          console.log(`🔍 Tentando buscar pelo recipient.id do evento: ${messageRecipientId}`);
          instance = await InstanceService.getByInstagramAccountId(messageRecipientId);
        }
      }

      if (!instance) {
        console.error(`❌ Instância não encontrada para Instagram Account ID: ${recipientId}`);
        console.error(`📋 Entry completo:`, JSON.stringify(entry, null, 2));
        // Log adicional para debug - listar todas as instâncias conectadas
        console.error(`💡 Dica: Verifique se o instagramAccountId salvo corresponde ao ID do webhook`);
        continue;
      }

      const instanceId = instance._id.toString();
      const userId = instance.userId.toString();

      console.log(`✅ Instância encontrada: ${instance.name} (${instance.instanceName})`);

      // Processar mensagens
      if (entry.messaging) {
        for (const event of entry.messaging) {
          // Ignorar mensagens enviadas por nós (echoes)
          if (event.message?.is_echo) {
            continue;
          }

          await processDirectMessage(instance, {
            ...event,
            recipient: { id: recipientId },
          });
        }
      }

      // Processar comentários
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === 'comments') {
            await processComment(instance, change);
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Erro ao processar webhook:', error);
    throw error;
  }
};
