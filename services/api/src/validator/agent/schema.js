const Joi = require('joi');

const AgentChatPayloadSchema = Joi.object({
  message: Joi.string().trim().min(1).required(),
  productId: Joi.string().trim().optional(),
  save: Joi.boolean().default(true),
  windowDays: Joi.number().integer().min(1).max(90),
  from: Joi.date().iso(),
  to: Joi.date().iso(),
  topK: Joi.number().integer().min(1).max(20),
}).with('from', 'to').with('to', 'from');

module.exports = {
  AgentChatPayloadSchema,
};
