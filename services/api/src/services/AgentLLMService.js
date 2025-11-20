// prettier-ignore
// eslint-disable max-lines
const { z } = require('zod');

class AgentLLMService {
    constructor(options = {}) {
        const {
            apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY,
            model = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
            temperature = 0.2,
            timeoutMs = 20000,
        } = options;

        if (!apiKey) {
            throw new Error('GOOGLE_GENERATIVE_AI_API_KEY wajib diatur untuk menjalankan Maintly Agent');
        }

        this._apiKey = apiKey;
        this._modelName = model;
        this._temperature = temperature;
        this._timeoutMs = timeoutMs;
        this._model = null;
        this._parser = null;
        this._formatInstructions = null;
        this._depsReady = null;
    }

    async generateRecommendation({ message, context }) {
        if (!message) {
            throw new Error('Pesan agent wajib diisi');
        }

        await this._ensureInitialized();
        const prompt = this._buildPrompt(message, context);
        const startedAt = Date.now();

        try {
            const aiMessage = await this._invokeWithTimeout(() => this._model.invoke(prompt));
            const latencyMs = Date.now() - startedAt;
            const tokenUsage = this._extractTokenUsage(aiMessage);
            console.info(
                `[MaintlyAgent] Gemini latency=${latencyMs}ms usage=${JSON.stringify(tokenUsage)}`
            );

            const text = this._extractText(aiMessage);
            const recommendation = await this._parser.parse(text);

            return {
                recommendation,
                meta: {
                    latencyMs,
                    tokenUsage,
                },
            };
        } catch (error) {
            console.error('[MaintlyAgent] Gemini request failed:', error);
            throw new Error('Gagal memperoleh rekomendasi dari Maintly Agent');
        }
    }

    async _ensureInitialized() {
        if (this._model && this._parser) {
            return;
        }

        if (!this._depsReady) {
            this._depsReady = Promise.all([
                import('@langchain/google-genai'),
                import('langchain/output_parsers'),
            ]);
        }

        const [{ ChatGoogleGenerativeAI }, { StructuredOutputParser }] = await this._depsReady;

        this._parser = StructuredOutputParser.fromZodSchema(
            z.object({
                action_text: z.string().min(4),
                reason: z.string().min(10),
                horizon_days: z.number().min(0).nullable(),
                confidence: z.number().min(0).max(1),
                failure_type: z.string().min(3),
            })
        );
        this._formatInstructions = this._parser.getFormatInstructions();

        this._model = new ChatGoogleGenerativeAI({
            modelName: this._modelName,
            temperature: this._temperature,
            maxRetries: 0,
            apiKey: this._apiKey,
        });
    }

    _buildPrompt(userMessage, context = {}) {
        const blocks = [
            'You are Maintly Agent, an industrial reliability assistant. Use only the supplied telemetry, predictions, and anomalies to recommend the single next best maintenance action. Be concrete and cite metrics in the reason. Avoid chain-of-thought explanations or guessing unknown data.',
            'In addition to the action, infer failure_type as a short canonical label (ex: "Tool Wear Failure", "Overheat"). Keep it under 4 words.',
            'Never output anything except the JSON that matches the required schema.',
            `Context:\n${this._formatContext(context)}`,
            `Operator request: """${userMessage}"""`,
            'Respond with JSON using the following schema:',
            this._formatInstructions,
        ];

        return blocks.join('\n\n');
    }

    _formatContext(context) {
        const lines = [];
        const { machine, prediction, anomalies, sensorReadings } = context;

        if (machine) {
            lines.push(
                `Machine -> product_id=${machine.product_id}, type=${machine.type || 'n/a'
                }, last_reading_at=${machine.last_reading_at ? new Date(machine.last_reading_at).toISOString() : 'unknown'
                }, current_risk_level=${machine.current_risk_level || 'n/a'}, current_risk_score=${machine.current_risk_score ?? 'n/a'
                }, predicted_failure_type=${machine.predicted_failure_type || 'n/a'}`
            );
        } else {
            lines.push('Machine -> unknown');
        }

        if (prediction) {
            const factors = this._formatTopFactors(prediction.top_factors);
            lines.push(
                `Latest prediction -> ts=${prediction.ts?.toISOString?.() || prediction.ts}, risk_score=${prediction.risk_score
                }, risk_level=${prediction.risk_level}, failure=${prediction.predicted_failure_type || 'n/a'
                }, top_factors=${factors}`
            );
        } else {
            lines.push('Latest prediction -> none');
        }

        const hasAnomalies = Array.isArray(anomalies) && anomalies.length > 0;
        if (hasAnomalies) {
            const formatted = anomalies.map((item) => ({
                detected_at: this._formatTimestamp(item.detected_at),
                risk_level: item.risk_level,
                risk_score: item.risk_score,
                reason: item.reason,
            }));
            lines.push(`Recent anomalies (max 5) -> ${JSON.stringify(formatted)}`);
        } else {
            lines.push('Recent anomalies -> none');
        }

        lines.push(`Sensor readings summary -> ${this._summarizeSensors(sensorReadings)}`);

        return lines.join('\n');
    }

    _summarizeSensors(readings = []) {
        if (!readings.length) {
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
        const metrics = [
            'air_temp_k',
            'process_temp_k',
            'rotational_speed_rpm',
            'torque_nm',
            'tool_wear_min',
        ];
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
        const last = [...readings]
            .reverse()
            .find((row) => row.process_temp_k !== null && row.air_temp_k !== null);
        if (!last) {
            return null;
        }

        const delta = Number(last.process_temp_k) - Number(last.air_temp_k);
        if (!Number.isFinite(delta)) {
            return null;
        }

        return {
            latest: Number(delta.toFixed(2)),
        };
    }

    _formatSensorPoint(point) {
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
            return aiMessage.content
                .map((part) => part.text || (typeof part === 'string' ? part : ''))
                .join('');
        }

        return String(aiMessage.content || '');
    }

    _extractTokenUsage(aiMessage) {
        if (aiMessage && aiMessage.response_metadata && aiMessage.response_metadata.tokenUsage) {
            return aiMessage.response_metadata.tokenUsage;
        }
        if (aiMessage && aiMessage.usageMetadata) {
            return aiMessage.usageMetadata;
        }
        return aiMessage && aiMessage.response_metadata ? aiMessage.response_metadata : null;
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
}

module.exports = AgentLLMService;
