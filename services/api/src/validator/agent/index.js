const InvariantError = require('../../exceptions/InvariantError');
const { AgentChatPayloadSchema } = require('./schema');

const AgentValidator = {
  validateChatPayload: (payload = {}) => {
    const { error, value } = AgentChatPayloadSchema.validate(payload, { abortEarly: false });
    if (error) {
      throw new InvariantError(error.message);
    }
    return value;
  },
};

module.exports = AgentValidator;
