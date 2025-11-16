require('dotenv').config();
const Hapi = require('@hapi/hapi');
const ClientError = require('./exceptions/ClientError');
const healthPlugin = require('./api/health');
const machinesPlugin = require('./api/machines');
const ticketsPlugin = require('./api/tickets');
const MachinesService = require('./services/MachinesService');
const TicketsService = require('./services/TicketsService');
const TicketsValidator = require('./validator/tickets');

const init = async () => {
  const server = Hapi.server({
    port: process.env.PORT || 4000,
    host: 'localhost',
    routes: {
      cors: {
        origin: ['*'],
      },
    },
  });

  const machinesService = new MachinesService();
  const ticketsService = new TicketsService();

  await server.register([
    { plugin: healthPlugin },
    { plugin: machinesPlugin, options: { service: machinesService } },
    {
      plugin: ticketsPlugin,
      options: {
        service: ticketsService,
        validator: TicketsValidator,
      },
    },
  ]);

  server.ext('onPreResponse', (request, h) => {
    const { response } = request;

    if (!(response instanceof Error)) {
      return h.continue;
    }

    if (response instanceof ClientError) {
      const failResponse = h.response({
        status: 'fail',
        message: response.message,
      });
      failResponse.code(response.statusCode);
      return failResponse;
    }

    if (response.isBoom && !response.isServer) {
      return h.response({
        status: 'fail',
        message: response.message,
      }).code(response.output.statusCode);
    }

    console.error(response);
    return h.response({
      status: 'error',
      message: 'Maaf, terjadi kegagalan pada server kami.',
    }).code(500);
  });

  await server.start();
  console.log('Maintly API running at', server.info.uri);
};

init();
