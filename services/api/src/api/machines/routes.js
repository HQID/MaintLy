const routes = (handler) => ([
  {
    method: 'GET',
    path: '/api/machines',
    handler: () => handler.getMachinesHandler(),
  },
  {
    method: 'GET',
    path: '/api/machines/{productId}',
    handler: (request) => handler.getMachineByIdHandler(request),
  },
  {
    method: 'GET',
    path: '/api/machines/{productId}/readings',
    handler: (request) => handler.getSensorReadingsHandler(request),
  },
  {
    method: 'GET',
    path: '/api/machines/{productId}/predictions',
    handler: (request) => handler.getPredictionsHandler(request),
  },
  {
    method: 'GET',
    path: '/api/machines/{productId}/anomalies',
    handler: (request) => handler.getAnomaliesHandler(request),
  },
  {
    method: 'GET',
    path: '/api/recommendations',
    handler: (request) => handler.getRecommendationsHandler(request),
  },
]);

module.exports = routes;
