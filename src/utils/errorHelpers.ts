import { Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';

export const createValidationError = (message: string): AppError => {
  const error: AppError = new Error(message);
  error.statusCode = 400;
  error.status = 'validation_error';
  return error;
};

export const createNotFoundError = (message: string): AppError => {
  const error: AppError = new Error(message);
  error.statusCode = 404;
  error.status = 'not_found';
  return error;
};

export const createUnauthorizedError = (message: string): AppError => {
  const error: AppError = new Error(message);
  error.statusCode = 401;
  error.status = 'unauthorized';
  return error;
};

export const createForbiddenError = (message: string): AppError => {
  const error: AppError = new Error(message);
  error.statusCode = 403;
  error.status = 'forbidden';
  return error;
};

export const handleControllerError = (
  error: unknown,
  defaultMessage: string
): AppError => {
  if (error instanceof Error) {
    const appError = error as AppError;
    if (appError.statusCode) {
      return appError;
    }
    return new Error(error.message || defaultMessage) as AppError;
  }
  return new Error(defaultMessage) as AppError;
};
