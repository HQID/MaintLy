const Joi = require('joi');

const AgentChatPayloadSchema = Joi.object({
  message: Joi.string().trim().min(1).required(),
  productId: Joi.string().trim().required(),
  save: Joi.boolean().default(true),
});

module.exports = {
  AgentChatPayloadSchema,
};
