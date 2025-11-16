const HealthHandler = require('./handler');
const routes = require('./routes');

module.exports = {
  name: 'maintly-health',
  version: '1.0.0',
  register: async (server) => {
    const handler = new HealthHandler();
    server.route(routes(handler));
  },
};
