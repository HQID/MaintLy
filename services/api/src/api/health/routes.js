const routes = (handler) => ([
  {
    method: 'GET',
    path: '/health',
    handler: () => handler.getHealth(),
  },
]);

module.exports = routes;
