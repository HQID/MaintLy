// prettier-ignore
// eslint-disable max-lines
const { z } = require('zod');

const INTENT_ENUM = z.enum(['recommendation', 'explain_risk', 'list_top_risky', 'qa']);

const RecommendationSchema = z.object({
  action_text: z.string().min(4),
  reason: z.string().min(8),
  horizon_days: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  failure_type: z.string().min(3).nullable(),
});

const ExplanationSchema = z.object({
  summary: z.string().min(4),
  key_factors: z.array(z.string()).default([]),
});

const ListSchema = z.object({
  criteria: z.string().min(3),
  note: z.string().nullable(),
});

const QaSchema = z.object({
  final_answer: z.string().min(3),
});

const MetaSchema = z.object({
  requested: z.object({
    productIds: z.array(z.string()).optional(),
    topK: z.number().optional(),
    windowDays: z.number().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }).partial().default({}),
  applied: z.object({
    productIds: z.array(z.string()).optional(),
    topK: z.number().optional(),
    windowDays: z.number().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }).partial().default({}),
  notes: z.array(z.string()).optional(),
});

class AgentLLMService {
  constructor(options = {}) {
    const {
      apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      model = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      temperature = 0.2,
      timeoutMs = 30000,
    } = options;

    if (!apiKey) {
      throw new Error('GOOGLE_GENERATIVE_AI_API_KEY wajib diatur untuk menjalankan Maintly Agent');
    }

    this._apiKey = apiKey;
    this._modelName = model;
    this._temperature = temperature;
    this._timeoutMs = timeoutMs;
    this._model = null;
    this._depsReady = null;
    this._analysisParser = null;
    this._analysisInstructions = null;
    this._responseParser = null;
    this._responseInstructions = null;
  }

  async analyzeMessage({ message, hints = {}, policy = {}, systemDocs = null }) {
    if (!message) {
      throw new Error('Pesan agent wajib diisi');
    }

    await this._ensureInitialized();
    const prompt = this._buildAnalysisPrompt({ message, hints, policy, systemDocs });

    try {
      const aiMessage = await this._invokeWithTimeout(() => this._model.invoke(prompt));
      const text = this._extractText(aiMessage);
      return await this._analysisParser.parse(text);
    } catch (error) {
      console.error('[MaintlyAgent] Gemini analysis failed:', error);
      throw new Error('Maintly Agent gagal mengurai perintah operator');
    }
  }

  async generateResponse({
    message,
    inference,
    selection,
    context,
    policy,
    systemDocs = null,
  }) {
    if (!message) {
      throw new Error('Pesan agent wajib diisi');
    }

    await this._ensureInitialized();
    const prompt = this._buildResponsePrompt({
      message,
      inference,
      selection,
      context,
      policy,
      systemDocs,
    });

    const startedAt = Date.now();
    try {
      const aiMessage = await this._invokeWithTimeout(() => this._model.invoke(prompt));
      const latencyMs = Date.now() - startedAt;
      const tokenUsage = this._extractTokenUsage(aiMessage);
      console.info('[MaintlyAgent] Gemini response latency=%dms usage=%j', latencyMs, tokenUsage);

      const text = this._extractText(aiMessage);
      return await this._responseParser.parse(text);
    } catch (error) {
      console.error('[MaintlyAgent] Gemini response failed:', error);
      throw new Error('Gagal memperoleh jawaban dari Maintly Agent');
    }
  }

  async _ensureInitialized() {
    if (this._model && this._analysisParser && this._responseParser) {
      return;
    }

    if (!this._depsReady) {
      this._depsReady = Promise.all([
        import('@langchain/google-genai'),
        import('langchain/output_parsers'),
      ]);
    }

    const [{ ChatGoogleGenerativeAI }, { StructuredOutputParser }] = await this._depsReady;

    if (!this._analysisParser) {
      const analysisSchema = z.object({
        intent: INTENT_ENUM,
        productIds: z.array(z.string()).nullable().default(null),
        autoPick: z.boolean().default(false),
        topK: z.number().nullable().default(null),
        windowDays: z.number().nullable().default(null),
        from: z.string().nullable().default(null),
        to: z.string().nullable().default(null),
        recommendation: z.null().default(null),
        explanation: z.null().default(null),
        list: z.null().default(null),
        qa: z.null().default(null),
        meta: MetaSchema.default({ requested: {}, applied: {} }),
        errors: z.array(z.string()).default([]),
      });
      this._analysisParser = StructuredOutputParser.fromZodSchema(analysisSchema);
      this._analysisInstructions = this._analysisParser.getFormatInstructions();
    }

    if (!this._responseParser) {
      const responseSchema = z.object({
        intent: INTENT_ENUM,
        productIds: z.array(z.string()).nullable().default(null),
        autoPick: z.boolean().default(false),
        topK: z.number().nullable().default(null),
        windowDays: z.number().nullable().default(null),
        from: z.string().nullable().default(null),
        to: z.string().nullable().default(null),
        recommendation: RecommendationSchema.nullable().default(null),
        explanation: ExplanationSchema.nullable().default(null),
        list: ListSchema.nullable().default(null),
        qa: QaSchema.nullable().default(null),
        meta: MetaSchema.default({ requested: {}, applied: {} }),
        errors: z.array(z.string()).default([]),
      });
      this._responseParser = StructuredOutputParser.fromZodSchema(responseSchema);
      this._responseInstructions = this._responseParser.getFormatInstructions();
    }

    if (!this._model) {
      this._model = new ChatGoogleGenerativeAI({
        modelName: this._modelName,
        temperature: this._temperature,
        maxRetries: 0,
        apiKey: this._apiKey,
      });
    }
  }

  _buildAnalysisPrompt({ message, hints, policy, systemDocs }) {
    const policyBlock = JSON.stringify({
      maxTopK: this._coalesce(policy && policy.maxTopK, null),
      maxWindowDays: this._coalesce(policy && policy.maxWindowDays, null),
    });
    const hintBlock = JSON.stringify(hints || {}, null, 2);
    const docsBlock = systemDocs ? JSON.stringify(systemDocs) : 'n/a';

    return [
      "You are Maintly's Maintenance Copilot. Analyze the operator message and infer intent plus optional parameters.",
      'Return ONLY JSON for parameter inference. Do NOT propose recommendations yet. Set recommendation/explanation/list/qa to null.',
      'Detect operator language (Indonesian or English) mentally, but keep every technical field in English.',
      'You may request BE1 to auto-pick risky machines by setting autoPick=true when productIds are missing.',
      `System docs snippet: ${docsBlock}`,
      `Policy limits: ${policyBlock}`,
      `Hints from API payload: ${hintBlock}`,
      `Operator message:\n"""${message}"""`,
      'Respond with JSON following this schema:',
      this._analysisInstructions,
    ].join('\n\n');
  }

  _buildResponsePrompt({
    message,
    inference,
    selection,
    context,
    policy,
    systemDocs,
  }) {
    const policyBlock = JSON.stringify({
      maxTopK: this._coalesce(policy && policy.maxTopK, null),
      maxWindowDays: this._coalesce(policy && policy.maxWindowDays, null),
    });
    const docsBlock = systemDocs ? JSON.stringify(systemDocs) : 'n/a';
    const inferenceBlock = JSON.stringify(inference, null, 2);
    const selectionBlock = JSON.stringify(selection, null, 2);
    const contextBlock = this._formatContextBundle(context, selection);

    return [
      "You are Maintly's Maintenance Copilot. You read context from Postgres via BE1 and must return ONLY a single JSON object matching the provided schema. No chain-of-thought.",
      'LANGUAGE:\n- Detect user language (Indonesian or English) and produce human-facing fields (final_answer, reason, action_text) in that language.\n- Technical fields (intent, productIds, from/to, etc.) stay in English.',
      "GOALS:\n- Understand the user's request (free-form, may include product IDs, time windows, counts).\n- If the user asks for recommendations, generate ONE actionable recommendation per targeted machine, grounded in the provided context.\n- If the user asks for an explanation (e.g., 'why high risk?'), explain briefly using concrete facts (tool_wear_min, DeltaT, torque).\n- If the user asks general Q&A (about the system/app), answer concisely from given system_docs; if info is missing, say so.",
      "PARAMETER INFERENCE & POLICY:\n- Infer optional parameters from the message: productIds, windowDays or from/to, topK.\n- If the message over-asks, cap to policy limits supplied by BE1 (maxTopK, maxWindowDays). Return both requested and applied values in meta.\n- If productId is missing and you need BE1 to pick machines, set autoPick=true. BE1 already executed the selection and supplied the context below—reflect it in meta.",
      "CONTEXT YOU MAY RECEIVE:\n- machines (id, product_id, type, last_reading_at, current_risk_level, current_risk_score)\n- predictions (latest info)\n- anomalies\n- sensor_readings\n- system_docs\nNot all sections will be present. Never invent facts—if missing, say 'insufficient data'.",
      'OUTPUT RULES:\n- Return ONLY JSON matching the schema. No prose outside JSON.\n- Keep answers concise and actionable (max ~3 sentences per machine).\n- When recommending actions, prefer safety: horizon_days=0 for urgent high risk.\n- Set failure_type to a short canonical label (e.g., "Tool Wear Failure") or null.',
      `System docs: ${docsBlock}`,
      `Policy limits: ${policyBlock}`,
      `Inferred parameters from analysis:\n${inferenceBlock}`,
      `Selection + candidate overview from BE1:\n${selectionBlock}`,
      `Telemetry context:\n${contextBlock}`,
      `Operator message:\n"""${message}"""`,
      'Return JSON following this schema:',
      this._responseInstructions,
    ].join('\n\n');
  }

  _formatContextBundle(context, selection) {
    const chunks = [];
    if (selection) {
      chunks.push(`Selection summary -> ${JSON.stringify(selection)}`);
    }

    if (!context) {
      chunks.push('No machine context fetched (e.g., QA/system question).');
      return chunks.join('\n');
    }

    const machine = context.machine;
    const prediction = context.prediction;
    const anomalies = context.anomalies;
    const sensorReadings = context.sensorReadings;

    if (machine) {
      const currentRiskScore = this._coalesce(machine.current_risk_score, 'n/a');
      const lastReading = machine.last_reading_at ?
        new Date(machine.last_reading_at).toISOString() :
        'unknown';
      chunks.push(
        `Machine -> product_id=${machine.product_id}, type=${machine.type || 'n/a'}, last_reading_at=${lastReading}, current_risk_level=${machine.current_risk_level || 'n/a'}, current_risk_score=${currentRiskScore}, predicted_failure_type=${machine.predicted_failure_type || 'n/a'}`,
      );
    } else {
      chunks.push('Machine -> unknown');
    }

    if (prediction) {
      const factors = this._formatTopFactors(prediction.top_factors);
      const predictionTs = this._formatTimestamp(prediction.ts) || (prediction.ts || 'unknown');
      chunks.push(
        `Latest prediction -> ts=${predictionTs}, risk_score=${prediction.risk_score}, risk_level=${prediction.risk_level}, failure=${prediction.predicted_failure_type || 'n/a'}, top_factors=${factors}`,
      );
    } else {
      chunks.push('Latest prediction -> none');
    }

    if (Array.isArray(anomalies) && anomalies.length > 0) {
      const formatted = anomalies.map((item) => ({
        detected_at: this._formatTimestamp(item.detected_at),
        risk_level: item.risk_level,
        risk_score: item.risk_score,
        reason: item.reason,
      }));
      chunks.push(`Recent anomalies -> ${JSON.stringify(formatted)}`);
    } else {
      chunks.push('Recent anomalies -> none');
    }

    chunks.push(`Sensor readings summary -> ${this._summarizeSensors(sensorReadings)}`);
    return chunks.join('\n');
  }

  _summarizeSensors(readings = []) {
    if (!Array.isArray(readings) || readings.length === 0) {
      return 'no readings in window';
    }

    const sortedAsc = [...readings].sort((a, b) => new Date(a.ts) - new Date(b.ts));
    const stats = this._aggregateSensorStats(sortedAsc);
    const recentSamples = sortedAsc.slice(-3).map((item) => this._formatSensorPoint(item));

    return JSON.stringify({
      coverage_hours: stats.coverageHours,
      count: sortedAsc.length,
      stats: stats.metrics,
      recent_samples: recentSamples,
    });
  }

  _aggregateSensorStats(readings) {
    const metrics = ['air_temp_k', 'process_temp_k', 'rotational_speed_rpm', 'torque_nm', 'tool_wear_min'];
    const aggregates = {};
    const firstTs = new Date(readings[0].ts);
    const lastTs = new Date(readings[readings.length - 1].ts);
    const coverageHours = Math.max((lastTs - firstTs) / 3600000, 0);

    metrics.forEach((metric) => {
      let sum = 0;
      let count = 0;
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;

      readings.forEach((row) => {
        const value = Number(row[metric]);
        if (Number.isFinite(value)) {
          sum += value;
          count += 1;
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      });

      if (count > 0) {
        aggregates[metric] = {
          avg: Number((sum / count).toFixed(2)),
          min: Number(min.toFixed(2)),
          max: Number(max.toFixed(2)),
        };
      }
    });

    const deltaT = this._computeDeltaTemp(readings);
    if (deltaT) {
      aggregates.delta_temp_k = deltaT;
    }

    return {
      coverageHours: Number(coverageHours.toFixed(2)),
      metrics: aggregates,
    };
  }

  _computeDeltaTemp(readings) {
    const reversed = [...readings].reverse();
    const last = reversed.find(
      (row) => row && row.process_temp_k !== null && row.process_temp_k !== undefined &&
        row.air_temp_k !== null && row.air_temp_k !== undefined,
    );
    if (!last) {
      return null;
    }

    const delta = Number(last.process_temp_k) - Number(last.air_temp_k);
    if (!Number.isFinite(delta)) {
      return null;
    }

    return { latest: Number(delta.toFixed(2)) };
  }

  _formatSensorPoint(point = {}) {
    return {
      ts: this._formatTimestamp(point.ts),
      air_temp_k: this._toNumber(point.air_temp_k),
      process_temp_k: this._toNumber(point.process_temp_k),
      rotational_speed_rpm: this._toNumber(point.rotational_speed_rpm),
      torque_nm: this._toNumber(point.torque_nm),
      tool_wear_min: this._toNumber(point.tool_wear_min),
    };
  }

  _formatTopFactors(topFactors) {
    if (!topFactors) {
      return 'n/a';
    }
    if (Array.isArray(topFactors)) {
      return topFactors.join(', ');
    }
    if (typeof topFactors === 'object') {
      return Object.entries(topFactors)
        .map(([key, value]) => `${key}:${value}`)
        .join(', ');
    }
    return String(topFactors);
  }

  _extractText(aiMessage) {
    if (!aiMessage) {
      return '';
    }
    if (typeof aiMessage.content === 'string') {
      return aiMessage.content;
    }
    if (Array.isArray(aiMessage.content)) {
      return aiMessage.content.map((part) => (part && part.text) || (typeof part === 'string' ? part : '')).join('');
    }
    return String(aiMessage.content || '');
  }

  _extractTokenUsage(aiMessage) {
    if (
      aiMessage &&
      aiMessage.response_metadata &&
      aiMessage.response_metadata.tokenUsage
    ) {
      return aiMessage.response_metadata.tokenUsage;
    }
    if (aiMessage && aiMessage.usageMetadata) {
      return aiMessage.usageMetadata;
    }
    if (aiMessage && aiMessage.response_metadata) {
      return aiMessage.response_metadata;
    }
    return null;
  }

  async _invokeWithTimeout(fn) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Permintaan ke LLM melebihi batas waktu 10 detik'));
      }, this._timeoutMs);
    });

    try {
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  _toNumber(value) {
    if (value === null || value === undefined) {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? Number(num.toFixed(2)) : null;
  }

  _formatTimestamp(value) {
    if (!value) {
      return null;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value.toISOString === 'function') {
      return value.toISOString();
    }
    return String(value);
  }

  _coalesce(value, fallback) {
    return value === undefined || value === null ? fallback : value;
  }
}

module.exports = AgentLLMService;