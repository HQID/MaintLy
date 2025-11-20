const routes = (handler) => ([
  {
    method: 'POST',
    path: '/api/agent/chat',
    handler: (request, h) => handler.chat(request, h),
  },
]);

module.exports = routes;
