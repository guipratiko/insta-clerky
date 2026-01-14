/**
 * Helpers para trabalhar com banco de dados
 */

/**
 * Parsear campo JSONB do PostgreSQL de forma segura
 */
export function parseJsonbField<T>(value: unknown, defaultValue: T): T {
  if (value === null || value === undefined) {
    return defaultValue;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return defaultValue;
    }
  }

  if (typeof value === 'object') {
    return value as T;
  }

  return defaultValue;
}

/**
 * Normalizar string para uso em queries
 */
export function normalizeString(value: string | undefined | null): string {
  if (!value) return '';
  return value.trim();
}
