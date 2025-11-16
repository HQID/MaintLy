const InvariantError = require('../../exceptions/InvariantError');
const { TicketPayloadSchema, TicketStatusSchema } = require('./schema');

const TicketsValidator = {
  validateCreatePayload: (payload) => {
    const { error, value } = TicketPayloadSchema.validate(payload, { abortEarly: false });
    if (error) {
      throw new InvariantError(error.message);
    }
    return value;
  },

  validateStatusPayload: (payload) => {
    const { error, value } = TicketStatusSchema.validate(payload, { abortEarly: false });
    if (error) {
      throw new InvariantError(error.message);
    }
    return value;
  },
};

module.exports = TicketsValidator;
