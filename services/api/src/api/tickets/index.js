const TicketsHandler = require('./handler');
const routes = require('./routes');
const TicketsService = require('../../services/TicketsService');
const TicketsValidator = require('../../validator/tickets');

module.exports = {
  name: 'maintly-tickets',
  version: '1.0.0',
  register: async (server, { service, validator } = {}) => {
    const ticketsService = service || new TicketsService();
    const ticketsValidator = validator || TicketsValidator;
    const handler = new TicketsHandler(ticketsService, ticketsValidator);
    server.route(routes(handler));
  },
};
