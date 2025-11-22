const { randomUUID } = require('crypto');
const pool = require('./db');
const NotFoundError = require('../exceptions/NotFoundError');

class AgentRepository {
  constructor() {
    this._pool = pool;
  }

  async fetchMachineContext(productId, { hoursWindow = 72, anomaliesLimit = 5 } = {}) {
    const machine = await this._getMachineByProductId(productId);

    const [prediction, anomalies, sensorReadings] = await Promise.all([
      this._getLatestPrediction(machine.id),
      this._getRecentAnomalies(machine.id, anomaliesLimit),
      this._getRecentSensorReadings(machine.id, hoursWindow),
    ]);

    return {
      machine,
      prediction,
      anomalies,
      sensorReadings,
    };
  }

  async saveRecommendation(machineId, { action_text: actionText, reason, horizon_days: horizonDays }) {
    const id = randomUUID();
    const query = {
      text: `
        INSERT INTO recommendations (id, machine_id, action_text, reason, horizon_days, source)
        VALUES ($1, $2, $3, $4, $5, 'agent')
        RETURNING id, action_text, reason, horizon_days, created_at
      `,
      values: [id, machineId, actionText, reason, horizonDays ?? null],
    };

    const result = await this._pool.query(query);
    return result.rows[0];
  }

  async updateFailureType({ machineId, productId, failureType }) {
    if (!failureType) {
      throw new Error('failureType is required to update records');
    }

    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');

      const machineUpdate = await client.query(
        `
          UPDATE machines
          SET predicted_failure_type = $1
          WHERE product_id = $2
        `,
        [failureType, productId],
      );

      const predictionUpdate = await client.query(
        `
          WITH latest AS (
            SELECT id, ts
            FROM predictions
            WHERE machine_id = $2
            ORDER BY ts DESC
            LIMIT 1
          )
          UPDATE predictions p
          SET predicted_failure_type = $1
          FROM latest
          WHERE p.id = latest.id
          RETURNING latest.ts
        `,
        [failureType, machineId],
      );

      const predictionRow = predictionUpdate.rows[0];
      const latestTs = predictionRow && predictionRow.ts ? predictionRow.ts : null;

      if (latestTs) {
        await client.query(
          `
            UPDATE anomalies
            SET predicted_failure_type = $1
            WHERE machine_id = $2
              AND detected_at = $3
          `,
          [failureType, machineId, latestTs],
        );
      }

      await client.query('COMMIT');
      return {
        updated: Boolean(machineUpdate.rowCount),
        latestTs,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getTopRiskyMachines({ from, to, limit = 5 } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20);
    const { startIso, endIso } = this._normalizeDateRange(from, to);

    const query = {
      text: `
        WITH ranked AS (
          SELECT DISTINCT ON (m.id)
                 m.id,
                 m.product_id,
                 m.type,
                 p.risk_score,
                 p.risk_level,
                 p.ts AS last_ts
          FROM predictions p
          JOIN machines m ON m.id = p.machine_id
          WHERE p.ts BETWEEN $1 AND $2
          ORDER BY m.id, p.risk_score DESC NULLS LAST, p.ts DESC
        )
        SELECT *
        FROM ranked
        ORDER BY risk_score DESC NULLS LAST
        LIMIT $3
      `,
      values: [startIso, endIso, safeLimit],
    };

    const result = await this._pool.query(query);
    return result.rows.map((row) => ({
      machine_id: row.id,
      product_id: row.product_id,
      type: row.type,
      risk_score: row.risk_score !== null ? Number(row.risk_score) : null,
      risk_level: row.risk_level,
      last_prediction_at: row.last_ts instanceof Date ? row.last_ts.toISOString() : row.last_ts,
    }));
  }

  async _getMachineByProductId(productId) {
    const query = {
      text: `
        SELECT id,
               product_id,
               type,
               last_reading_at,
               current_risk_level,
               current_risk_score,
               predicted_failure_type
        FROM machines
        WHERE product_id = $1
        LIMIT 1
      `,
      values: [productId],
    };

    const result = await this._pool.query(query);
    if (!result.rowCount) {
      throw new NotFoundError(`Mesin dengan product_id ${productId} tidak ditemukan`);
    }
    return result.rows[0];
  }

  async _getLatestPrediction(machineId) {
    const query = {
      text: `
        SELECT ts,
               risk_score,
               risk_level,
               predicted_failure_type,
               top_factors
        FROM predictions
        WHERE machine_id = $1
        ORDER BY ts DESC
        LIMIT 1
      `,
      values: [machineId],
    };

    const result = await this._pool.query(query);
    return result.rows[0] || null;
  }

  async _getRecentAnomalies(machineId, limit) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 10);
    const query = {
      text: `
        SELECT detected_at,
               risk_level,
               risk_score,
               reason
        FROM anomalies
        WHERE machine_id = $1
        ORDER BY detected_at DESC
        LIMIT $2
      `,
      values: [machineId, safeLimit],
    };

    const result = await this._pool.query(query);
    return result.rows;
  }

  async _getRecentSensorReadings(machineId, hoursWindow) {
    const durationHours = Math.min(Math.max(Number(hoursWindow) || 24, 1), 168);
    const interval = `${durationHours} hours`;

    const query = {
      text: `
        SELECT ts,
               air_temp_k,
               process_temp_k,
               rotational_speed_rpm,
               torque_nm,
               tool_wear_min
        FROM sensor_readings
        WHERE machine_id = $1
          AND ts >= NOW() - $2::interval
        ORDER BY ts DESC
        LIMIT 300
      `,
      values: [machineId, interval],
    };

    const result = await this._pool.query(query);
    return result.rows;
  }

  _normalizeDateRange(from, to) {
    const endDate = to ? new Date(to) : new Date();
    if (Number.isNaN(endDate.getTime())) {
      throw new Error('Parameter tanggal akhir tidak valid');
    }

    let startDate;
    if (from) {
      startDate = new Date(from);
      if (Number.isNaN(startDate.getTime())) {
        throw new Error('Parameter tanggal awal tidak valid');
      }
    } else {
      startDate = new Date(endDate.getTime() - (7 * 24 * 60 * 60 * 1000));
    }

    if (startDate > endDate) {
      const swap = startDate;
      startDate = endDate;
      endDate = swap;
    }

    return {
      startIso: startDate.toISOString(),
      endIso: endDate.toISOString(),
    };
  }
}

module.exports = AgentRepository;
