const InvariantError = require('../../exceptions/InvariantError');

const DEFAULT_POLICY = {
  maxTopK: Number(process.env.AGENT_MAX_TOPK || 5),
  maxWindowDays: Number(process.env.AGENT_MAX_WINDOW_DAYS || 30),
  defaultWindowDays: Number(process.env.AGENT_DEFAULT_WINDOW_DAYS || 7),
  defaultTopK: Number(process.env.AGENT_DEFAULT_TOPK || 3),
};

class AgentHandler {
  constructor({
    repository,
    llmService,
    validator,
    contextHours = Number(process.env.AGENT_MAX_CONTEXT_HR || 72),
    policy = {},
  }) {
    this._repository = repository;
    this._llmService = llmService;
    this._validator = validator;
    this._contextHours = contextHours;
    this._policy = {
      ...DEFAULT_POLICY,
      ...policy,
    };
    this._policy.defaultWindowDays = Math.min(
      this._policy.defaultWindowDays,
      this._policy.maxWindowDays,
    );
    this._policy.defaultTopK = Math.min(this._policy.defaultTopK, this._policy.maxTopK);
  }

  async chat(request, h) {
    const payload = this._validator.validateChatPayload(request.payload || {});
    const { message, save } = payload;

    const hints = {
      productId: payload.productId || null,
      windowDays: payload.windowDays || null,
      from: payload.from || null,
      to: payload.to || null,
      topK: payload.topK || null,
    };

    let inference;
    try {
      inference = await this._llmService.analyzeMessage({
        message,
        hints,
        policy: this._policy,
      });
    } catch (error) {
      console.error('[MaintlyAgent] Failed to analyse message', error);
      return h
        .response({
          status: 'error',
          message: 'Maintly Agent sementara tidak tersedia, coba lagi beberapa saat.',
        })
        .code(500);
    }

    const windowSpec = this._resolveWindowSpec({ inference, payload });
    let selection;
    try {
      selection = await this._resolveSelection({ inference, payload, windowSpec });
    } catch (error) {
      if (error instanceof InvariantError) {
        throw error;
      }
      console.error('[MaintlyAgent] Failed to resolve selection', error);
      return h
        .response({
          status: 'error',
          message: 'Maintly Agent sementara tidak tersedia, coba lagi beberapa saat.',
        })
        .code(500);
    }

    let targetContext = null;
    if (selection.targetProductId) {
      targetContext = await this._repository.fetchMachineContext(selection.targetProductId, {
        hoursWindow: this._contextHours,
      });
    }

    let llmResult;
    try {
      llmResult = await this._llmService.generateResponse({
        message,
        inference,
        selection: {
          type: selection.type,
          target_product_id: selection.targetProductId,
          window: selection.window,
          requested_topK: selection.requestedTopK,
          applied_topK: selection.appliedTopK,
          top_candidates: selection.topCandidates,
        },
        context: targetContext,
        policy: this._policy,
      });
    } catch (error) {
      return h
        .response({
          status: 'error',
          message: 'Maintly Agent sementara tidak tersedia, coba lagi beberapa saat.',
        })
        .code(500);
    }

    let savedRecord = null;
    if (
      selection.targetProductId
      && llmResult.intent === 'recommendation'
      && llmResult.recommendation
    ) {
      const failureType = (llmResult.recommendation.failure_type || '').trim() || null;

      if (failureType) {
        await this._repository.updateFailureType({
          machineId: targetContext.machine.id,
          productId: targetContext.machine.product_id,
          failureType,
        });
      }

      if (save !== false) {
        savedRecord = await this._repository.saveRecommendation(
          targetContext.machine.id,
          llmResult.recommendation,
        );
      }
    }

    return {
      status: 'success',
      data: {
        intent: llmResult.intent,
        target_product_id: selection.targetProductId,
        selection: selection.type,
        window: selection.window,
        top_candidates: selection.topCandidates,
        recommendation: llmResult.recommendation,
        explanation: llmResult.explanation,
        list: llmResult.list,
        qa: llmResult.qa,
        meta: llmResult.meta,
        errors: llmResult.errors,
        saved: Boolean(savedRecord),
      },
    };
  }

  _resolveWindowSpec({ inference, payload }) {
    const requestedFrom = this._firstDefined([
      this._getNestedValue(inference, ['meta', 'requested', 'from']),
      inference.from,
      payload.from,
    ]);
    const requestedTo = this._firstDefined([
      this._getNestedValue(inference, ['meta', 'requested', 'to']),
      inference.to,
      payload.to,
    ]);
    const requestedWindowDays = this._firstDefined([
      this._getNestedValue(inference, ['meta', 'requested', 'windowDays']),
      inference.windowDays,
      payload.windowDays,
    ]);

    const requested = {
      from: requestedFrom || null,
      to: requestedTo || null,
      windowDays: requestedWindowDays !== undefined && requestedWindowDays !== null
        ? requestedWindowDays
        : null,
    };

    if (requested.from && requested.to) {
      const fromIso = this._parseIsoDate(requested.from, 'from');
      const toIso = this._parseIsoDate(requested.to, 'to');
      if (new Date(fromIso) > new Date(toIso)) {
        throw new InvariantError('Rentang tanggal tidak valid');
      }
      return {
        type: 'range',
        from: fromIso,
        to: toIso,
        windowDays: null,
        requested,
        applied: { from: fromIso, to: toIso },
      };
    }

    const baseWindowDays = requested.windowDays !== null
      ? requested.windowDays
      : this._policy.defaultWindowDays;
    const days = this._clampWindowDays(baseWindowDays);
    const now = new Date();
    const fromIso = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

    return {
      type: 'window',
      from: fromIso,
      to: now.toISOString(),
      windowDays: days,
      requested,
      applied: { windowDays: days },
    };
  }

  async _resolveSelection({ inference, payload, windowSpec }) {
    if (inference.intent === 'qa') {
      return {
        type: 'none',
        targetProductId: null,
        requestedTopK: null,
        appliedTopK: null,
        window: this._serializeWindow(windowSpec),
        topCandidates: [],
      };
    }

    const explicitProductIds = this._collectExplicitProductIds(inference, payload);

    if (explicitProductIds.length) {
      return {
        type: 'explicit',
        targetProductId: explicitProductIds[0],
        requestedTopK: explicitProductIds.length,
        appliedTopK: 1,
        window: this._serializeWindow(windowSpec),
        topCandidates: [],
      };
    }

    if (inference.autoPick || !explicitProductIds.length) {
      const requestedTopK = this._firstDefined([
        this._getNestedValue(inference, ['meta', 'requested', 'topK']),
        inference.topK,
        payload.topK,
      ]);
      const baseTopK = requestedTopK !== null && requestedTopK !== undefined
        ? requestedTopK
        : this._policy.defaultTopK;
      const appliedTopK = this._clampTopK(baseTopK);

      const candidates = await this._repository.getTopRiskyMachines({
        from: windowSpec.from,
        to: windowSpec.to,
        limit: appliedTopK,
      });

      if (!candidates.length) {
        throw new InvariantError('Tidak ditemukan mesin berisiko pada rentang waktu tersebut');
      }

      return {
        type: 'auto',
        targetProductId: candidates[0].product_id,
        requestedTopK,
        appliedTopK,
        window: this._serializeWindow(windowSpec),
        topCandidates: candidates,
      };
    }

    return {
      type: 'none',
      targetProductId: null,
      requestedTopK: null,
      appliedTopK: null,
      window: this._serializeWindow(windowSpec),
      topCandidates: [],
    };
  }

  _collectExplicitProductIds(inference, payload) {
    const ids = [];
    if (payload.productId) {
      ids.push(payload.productId);
    }
    if (Array.isArray(inference.productIds)) {
      ids.push(...inference.productIds);
    }
    const requestedProductIds = this._getNestedValue(inference, ['meta', 'requested', 'productIds']);
    if (Array.isArray(requestedProductIds)) {
      ids.push(...requestedProductIds);
    }
    return [...new Set(ids.filter(Boolean))];
  }

  _serializeWindow(windowSpec) {
    if (windowSpec.type === 'range') {
      return { from: windowSpec.from, to: windowSpec.to };
    }
    return { windowDays: windowSpec.windowDays };
  }

  _parseIsoDate(value, label) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new InvariantError(`Parameter ${label} tidak valid`);
    }
    return date.toISOString();
  }

  _clampWindowDays(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return this._policy.defaultWindowDays;
    }
    return Math.min(Math.max(Math.floor(parsed), 1), this._policy.maxWindowDays);
  }

  _clampTopK(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return this._policy.defaultTopK;
    }
    return Math.min(Math.max(Math.floor(parsed), 1), this._policy.maxTopK);
  }

  _getNestedValue(source, path) {
    let current = source;
    for (let i = 0; i < path.length; i += 1) {
      const key = path[i];
      if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, key)) {
        current = current[key];
      } else {
        return undefined;
      }
    }
    return current;
  }

  _firstDefined(values, fallback = null) {
    for (let i = 0; i < values.length; i += 1) {
      const value = values[i];
      if (value !== undefined && value !== null) {
        return value;
      }
    }
    return fallback;
  }
}

module.exports = AgentHandler;
