/**
 * Service para processar webhooks do Instagram/Meta
 */

import { InstanceService } from './instanceService';
import { AutomationService } from './automationService';
import { ReportService } from './reportService';
import { sendDirectMessage, replyToComment } from './metaAPIService';
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
        event.recipient?.id || instance.instagramAccountId,
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
      // Buscar instância com accessToken
      const instanceWithToken = await InstanceService.getByInstagramAccountId(instance.instagramAccountId);
      if (!instanceWithToken || !instanceWithToken.accessToken) {
        console.error(`❌ Instância não encontrada ou sem token`);
        return;
      }

      // Executar automação
      try {
        if (automation.responseType === 'direct') {
          await sendDirectMessage(
            instanceWithToken.accessToken,
            senderId,
            automation.responseText
          );
        }

        // Criar relatório
        await ReportService.create({
          instanceId,
          userId,
          interactionType: 'dm',
          userIdInstagram: senderId,
          interactionText: messageText,
          responseText: automation.responseText,
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
        await ReportService.create({
          instanceId,
          userId,
          interactionType: 'dm',
          userIdInstagram: senderId,
          interactionText: messageText,
          responseText: automation.responseText,
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
      // Buscar instância com accessToken
      const instanceWithToken = await InstanceService.getByInstagramAccountId(instance.instagramAccountId);
      if (!instanceWithToken || !instanceWithToken.accessToken) {
        console.error(`❌ Instância não encontrada ou sem token`);
        return;
      }

      // Executar automação
      try {

        if (automation.responseType === 'comment') {
          // Responder no comentário
          await replyToComment(
            instanceWithToken.accessToken,
            commentId,
            automation.responseText
          );
        } else if (automation.responseType === 'direct') {
          // Enviar DM
          await sendDirectMessage(
            instanceWithToken.accessToken,
            fromUserId,
            automation.responseText
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
          username: fromUsername,
          interactionText: text,
          responseText: automation.responseText,
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
        await ReportService.create({
          instanceId,
          userId,
          interactionType: 'comment',
          commentId,
          userIdInstagram: fromUserId,
          mediaId: postId,
          username: fromUsername,
          interactionText: text,
          responseText: automation.responseText,
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
 */
export const processWebhook = async (
  instanceName: string,
  body: any
): Promise<void> => {
  try {
    // Buscar instância por instanceName (que é o ID usado no webhook)
    // O instanceName pode ser o ID da instância ou o instagramAccountId
    let instance = await InstanceService.getByInstanceName(instanceName);
    
    // Se não encontrar por instanceName, tentar buscar por instagramAccountId
    if (!instance) {
      instance = await InstanceService.getByInstagramAccountId(instanceName);
    }

    if (!instance) {
      console.error(`❌ Instância ${instanceName} não encontrada`);
      return;
    }

    const instanceId = instance._id.toString();
    const userId = instance.userId.toString();

    // Verificar se é um evento do Instagram
    if (body.object === 'instagram') {
      for (const entry of body.entry || []) {
        const recipientId = entry.id; // ID da conta Instagram que recebeu

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
    }
  } catch (error) {
    console.error('❌ Erro ao processar webhook:', error);
    throw error;
  }
};
