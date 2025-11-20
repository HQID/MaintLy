class AgentHandler {
  constructor({ repository, llmService, validator, contextHours = 72 }) {
    this._repository = repository;
    this._llmService = llmService;
    this._validator = validator;
    this._contextHours = contextHours;
  }

  async chat(request, h) {
    const payload = this._validator.validateChatPayload(request.payload || {});
    const { productId, message, save } = payload;

    const context = await this._repository.fetchMachineContext(productId, {
      hoursWindow: this._contextHours,
    });

    try {
      const { recommendation } = await this._llmService.generateRecommendation({
        message,
        context,
      });

      const failureType = (recommendation.failure_type || '').trim();
      if (!failureType) {
        throw new Error('Maintly Agent tidak mengembalikan failure_type yang valid');
      }

      const updateResult = await this._repository.updateFailureType({
        machineId: context.machine.id,
        productId: context.machine.product_id,
        failureType,
      });

      let savedRecord = null;
      if (save !== false) {
        savedRecord = await this._repository.saveRecommendation(context.machine.id, recommendation);
      }

      return {
        status: 'success',
        data: {
          recommendation,
          failure_type: failureType,
          saved: Boolean(savedRecord),
          updated: Boolean(updateResult?.updated),
        },
      };
    } catch (error) {
      console.error('[MaintlyAgent] Handler failed to respond', error);
      return h
        .response({
          status: 'error',
          message: 'Maintly Agent sementara tidak tersedia, coba lagi beberapa saat.',
        })
        .code(500);
    }
  }
}

module.exports = AgentHandler;
