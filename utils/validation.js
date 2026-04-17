/**
 * Input Validation Schemas
 */

import Joi from 'joi';

export const validationSchemas = {
  // Auto-dial request validation
  autoDial: Joi.object({
    fromExtension: Joi.string().required(),
    toNumber: Joi.string().required(),
    context: Joi.string().default('from-internal'),
    priority: Joi.number().default(1),
    timeout: Joi.number().default(30000),
    metadata: Joi.object().optional()
  }),

  // Call history filter validation
  callHistoryFilter: Joi.object({
    startDate: Joi.date().optional(),
    endDate: Joi.date().optional(),
    extension: Joi.string().optional(),
    direction: Joi.string().valid('inbound', 'outbound', 'internal').optional(),
    status: Joi.string().valid('completed', 'busy', 'no_answer', 'cancelled', 'failed').optional(),
    limit: Joi.number().default(100).max(1000),
    offset: Joi.number().default(0)
  }),

  // Recording metadata validation
  recordingQuery: Joi.object({
    startDate: Joi.date().optional(),
    endDate: Joi.date().optional(),
    extension: Joi.string().optional(),
    direction: Joi.string().valid('inbound', 'outbound', 'internal').optional(),
    limit: Joi.number().default(50).max(500),
    offset: Joi.number().default(0)
  })
};

export function validate(data, schema) {
  const { error, value } = schema.validate(data, { abortEarly: false });
  if (error) {
    const details = error.details.map(d => ({
      field: d.path.join('.'),
      message: d.message
    }));
    throw {
      statusCode: 400,
      message: 'Validation Error',
      details
    };
  }
  return value;
}
