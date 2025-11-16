const MachinesHandler = require('./handler');
const routes = require('./routes');
const MachinesService = require('../../services/MachinesService');

module.exports = {
  name: 'maintly-machines',
  version: '1.0.0',
  register: async (server, { service } = {}) => {
    const machinesService = service || new MachinesService();
    const handler = new MachinesHandler(machinesService);
    server.route(routes(handler));
  },
};
