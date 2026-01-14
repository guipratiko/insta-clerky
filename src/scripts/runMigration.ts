/**
 * Script para executar migrations do PostgreSQL
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { pgPool } from '../config/databases';
import { POSTGRES_CONFIG } from '../config/constants';

async function runMigration() {
  console.log('🔄 Iniciando migration do Insta-Clerky...');

  try {
    // Ler arquivo de migration
    const migrationPath = join(__dirname, '../database/migrations/001_create_instagram_tables.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    // Executar migration
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migrationSQL);
      await client.query('COMMIT');
      console.log('✅ Migration executada com sucesso!');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Erro ao executar migration:', error);
    process.exit(1);
  } finally {
    await pgPool.end();
    process.exit(0);
  }
}

runMigration();
