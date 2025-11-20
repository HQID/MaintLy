const AgentHandler = require('./handler');
const routes = require('./routes');
const AgentRepository = require('../../services/AgentRepository');
const AgentLLMService = require('../../services/AgentLLMService');
const AgentValidator = require('../../validator/agent');

const clampContextWindow = (value) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.min(Math.max(parsed, 24), 72);
  }
  return 72;
};

module.exports = {
  name: 'maintly-agent',
  version: '1.0.0',
  register: async (server, options = {}) => {
    const repository = options.repository || new AgentRepository();
    const llmService = options.llmService || new AgentLLMService();
    const validator = options.validator || AgentValidator;
    const contextHours = clampContextWindow(options.contextHours || process.env.AGENT_MAX_CONTEXT_HR || 72);

    const handler = new AgentHandler({
      repository,
      llmService,
      validator,
      contextHours,
    });

    server.route(routes(handler));
  },
};
