class TicketsHandler {
  constructor(service, validator) {
    this._service = service;
    this._validator = validator;
  }

  async getTicketsHandler() {
    const tickets = await this._service.listTickets();
    return {
      status: 'success',
      data: {
        tickets: tickets.map((ticket) => ({
          ...ticket,
          created_at: ticket.created_at?.toISOString(),
        })),
      },
    };
  }

  async postTicketHandler(request, h) {
    const payload = this._validator.validateCreatePayload(request.payload || {});
    const ticket = await this._service.createTicket(payload);

    return h.response({
      status: 'success',
      data: {
        ticket: {
          ...ticket,
          created_at: ticket.created_at?.toISOString(),
        },
      },
    }).code(201);
  }

  async patchTicketStatusHandler(request) {
    const payload = this._validator.validateStatusPayload(request.payload || {});
    const ticket = await this._service.updateTicketStatus(request.params.id, payload.status);

    return {
      status: 'success',
      data: {
        ticket: {
          ...ticket,
          created_at: ticket.created_at?.toISOString(),
        },
      },
    };
  }
}

module.exports = TicketsHandler;
