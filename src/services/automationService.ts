/**
 * Service para gerenciar automações do Instagram
 */

import { pgPool } from '../config/databases';
import { parseJsonbField } from '../utils/dbHelpers';

export interface Automation {
  id: string;
  userId: string;
  instanceId: string;
  name: string;
  type: 'dm' | 'comment';
  triggerType: 'keyword' | 'all';
  keywords: string[];
  responseText: string;
  responseType: 'direct' | 'comment';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAutomationData {
  userId: string;
  instanceId: string;
  name: string;
  type: 'dm' | 'comment';
  triggerType: 'keyword' | 'all';
  keywords?: string[];
  responseText: string;
  responseType: 'direct' | 'comment';
  isActive?: boolean;
}

export interface UpdateAutomationData {
  name?: string;
  triggerType?: 'keyword' | 'all';
  keywords?: string[];
  responseText?: string;
  responseType?: 'direct' | 'comment';
  isActive?: boolean;
}

export class AutomationService {
  /**
   * Mapear row do banco para objeto Automation
   */
  private static mapRowToAutomation(row: any): Automation {
    return {
      id: row.id,
      userId: row.user_id,
      instanceId: row.instance_id,
      name: row.name,
      type: row.type,
      triggerType: row.trigger_type,
      keywords: parseJsonbField<string[]>(row.keywords, []),
      responseText: row.response_text,
      responseType: row.response_type,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Criar nova automação
   */
  static async create(data: CreateAutomationData): Promise<Automation> {
    const query = `
      INSERT INTO instagram_automations (
        user_id, instance_id, name, type, trigger_type,
        keywords, response_text, response_type, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const result = await pgPool.query(query, [
      data.userId,
      data.instanceId,
      data.name,
      data.type,
      data.triggerType,
      data.triggerType === 'keyword' ? JSON.stringify(data.keywords || []) : null,
      data.responseText,
      data.responseType,
      data.isActive !== undefined ? data.isActive : true,
    ]);

    return this.mapRowToAutomation(result.rows[0]);
  }

  /**
   * Obter todas as automações de um usuário
   */
  static async getByUserId(userId: string, instanceId?: string): Promise<Automation[]> {
    let query = `
      SELECT * FROM instagram_automations
      WHERE user_id = $1
    `;
    const params: any[] = [userId];

    if (instanceId) {
      query += ` AND instance_id = $2`;
      params.push(instanceId);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pgPool.query(query, params);
    return result.rows.map((row) => this.mapRowToAutomation(row));
  }

  /**
   * Obter automações ativas para uma instância
   */
  static async getActiveByInstance(instanceId: string): Promise<Automation[]> {
    const query = `
      SELECT * FROM instagram_automations
      WHERE instance_id = $1 AND is_active = TRUE
      ORDER BY created_at DESC
    `;

    const result = await pgPool.query(query, [instanceId]);
    return result.rows.map((row) => this.mapRowToAutomation(row));
  }

  /**
   * Obter automação por ID
   */
  static async getById(id: string, userId: string): Promise<Automation | null> {
    const query = `
      SELECT * FROM instagram_automations
      WHERE id = $1 AND user_id = $2
    `;

    const result = await pgPool.query(query, [id, userId]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToAutomation(result.rows[0]);
  }

  /**
   * Atualizar automação
   */
  static async update(
    id: string,
    userId: string,
    data: UpdateAutomationData
  ): Promise<Automation | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }

    if (data.triggerType !== undefined) {
      updates.push(`trigger_type = $${paramIndex++}`);
      values.push(data.triggerType);
    }

    if (data.keywords !== undefined) {
      updates.push(`keywords = $${paramIndex++}`);
      values.push(data.triggerType === 'keyword' ? JSON.stringify(data.keywords) : null);
    }

    if (data.responseText !== undefined) {
      updates.push(`response_text = $${paramIndex++}`);
      values.push(data.responseText);
    }

    if (data.responseType !== undefined) {
      updates.push(`response_type = $${paramIndex++}`);
      values.push(data.responseType);
    }

    if (data.isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(data.isActive);
    }

    if (updates.length === 0) {
      return this.getById(id, userId);
    }

    values.push(id, userId);
    const query = `
      UPDATE instagram_automations
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
      RETURNING *
    `;

    const result = await pgPool.query(query, values);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToAutomation(result.rows[0]);
  }

  /**
   * Deletar automação
   */
  static async delete(id: string, userId: string): Promise<boolean> {
    const query = `
      DELETE FROM instagram_automations
      WHERE id = $1 AND user_id = $2
    `;

    const result = await pgPool.query(query, [id, userId]);
    return (result.rowCount || 0) > 0;
  }

  /**
   * Verificar se uma mensagem/comentário corresponde a alguma automação
   */
  static async findMatchingAutomation(
    instanceId: string,
    type: 'dm' | 'comment',
    text: string
  ): Promise<Automation | null> {
    const automations = await this.getActiveByInstance(instanceId);
    const relevantAutomations = automations.filter((auto) => auto.type === type);

    for (const automation of relevantAutomations) {
      if (automation.triggerType === 'all') {
        return automation;
      }

      if (automation.triggerType === 'keyword') {
        const lowerText = text.toLowerCase();
        const hasKeyword = automation.keywords.some((keyword) =>
          lowerText.includes(keyword.toLowerCase())
        );

        if (hasKeyword) {
          return automation;
        }
      }
    }

    return null;
  }
}
