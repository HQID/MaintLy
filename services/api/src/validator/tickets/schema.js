const Joi = require('joi');

const TicketPayloadSchema = Joi.object({
  machineId: Joi.string().trim().required(),
  title: Joi.string().trim().min(3).max(200).required(),
  priority: Joi.string().valid('low', 'medium', 'high').required(),
  description: Joi.string().allow('', null),
});

const TicketStatusSchema = Joi.object({
  status: Joi.string().valid('open', 'in_progress', 'done').required(),
});

module.exports = {
  TicketPayloadSchema,
  TicketStatusSchema,
};
