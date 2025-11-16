const routes = (handler) => ([
  {
    method: 'GET',
    path: '/api/tickets',
    handler: () => handler.getTicketsHandler(),
  },
  {
    method: 'POST',
    path: '/api/tickets',
    handler: (request, h) => handler.postTicketHandler(request, h),
  },
  {
    method: 'PATCH',
    path: '/api/tickets/{id}',
    handler: (request) => handler.patchTicketStatusHandler(request),
  },
]);

module.exports = routes;
