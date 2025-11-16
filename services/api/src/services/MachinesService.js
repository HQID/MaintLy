const pool = require('./db');
const InvariantError = require('../exceptions/InvariantError');
const NotFoundError = require('../exceptions/NotFoundError');

class MachinesService {
  constructor() {
    this._pool = pool;
  }

  async getAllMachines() {
    const result = await this._pool.query(
      `SELECT id, product_id, type, location, last_reading_at, current_risk_level,
              current_risk_score, predicted_failure_type
       FROM machines
       ORDER BY product_id ASC`,
    );

    return result.rows;
  }

  async getMachineByProductId(productId) {
    const result = await this._pool.query(
      `SELECT id, product_id, type, location, last_reading_at, current_risk_level,
              current_risk_score, predicted_failure_type
       FROM machines
       WHERE product_id = $1
       LIMIT 1`,
      [productId],
    );

    if (!result.rowCount) {
      throw new NotFoundError(`Mesin dengan product_id ${productId} tidak ditemukan`);
    }

    return result.rows[0];
  }

  async getSensorReadings(productId, { from, to, agg }) {
    const machine = await this.getMachineByProductId(productId);
    const interval = this._parseAggregationInterval(agg);

    const clauses = [];
    const values = [interval, machine.id];
    let index = values.length;

    if (from) {
      const fromTs = this._parseDateParameter(from, 'from');
      index += 1;
      clauses.push(`sr.ts >= $${index}`);
      values.push(fromTs);
    }

    if (to) {
      const toTs = this._parseDateParameter(to, 'to');
      index += 1;
      clauses.push(`sr.ts <= $${index}`);
      values.push(toTs);
    }

    const condition = clauses.length ? `AND ${clauses.join(' AND ')}` : '';

    const query = {
      text: `
        SELECT
          date_bin($1::interval, sr.ts, '1970-01-01 00:00:00+00'::timestamptz) AS bucket,
          AVG(sr.air_temp_k)              AS air_temp_k,
          AVG(sr.process_temp_k)          AS process_temp_k,
          AVG(sr.rotational_speed_rpm)    AS rotational_speed_rpm,
          AVG(sr.torque_nm)               AS torque_nm,
          AVG(sr.tool_wear_min)           AS tool_wear_min
        FROM sensor_readings sr
        WHERE sr.machine_id = $2
        ${condition}
        GROUP BY bucket
        ORDER BY bucket ASC
        LIMIT 1000
      `,
      values,
    };

    const result = await this._pool.query(query);

    return {
      machine,
      points: result.rows,
    };
  }

  async getPredictionsHistory(productId, { from, to }) {
    const machine = await this.getMachineByProductId(productId);
    const clauses = [];
    const values = [machine.id];
    let index = values.length;

    if (from) {
      const fromTs = this._parseDateParameter(from, 'from');
      index += 1;
      clauses.push(`p.ts >= $${index}`);
      values.push(fromTs);
    }

    if (to) {
      const toTs = this._parseDateParameter(to, 'to');
      index += 1;
      clauses.push(`p.ts <= $${index}`);
      values.push(toTs);
    }

    const condition = clauses.length ? `AND ${clauses.join(' AND ')}` : '';

    const query = {
      text: `
        SELECT p.ts,
               p.risk_score,
               p.risk_level,
               p.predicted_failure_type
        FROM predictions p
        WHERE p.machine_id = $1
        ${condition}
        ORDER BY p.ts ASC
      `,
      values,
    };

    const result = await this._pool.query(query);

    return {
      machine,
      points: result.rows,
    };
  }

  async getAnomalies(productId, limit = 10) {
    const machine = await this.getMachineByProductId(productId);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

    const result = await this._pool.query(
      `
        SELECT detected_at,
               risk_score,
               risk_level,
               predicted_failure_type,
               reason
        FROM anomalies
        WHERE machine_id = $1
        ORDER BY detected_at DESC
        LIMIT $2
      `,
      [machine.id, parsedLimit],
    );

    return {
      machine,
      anomalies: result.rows,
    };
  }

  async getRecommendations(productId) {
    if (!productId) {
      throw new InvariantError('Parameter mesin wajib diisi');
    }

    const machine = await this.getMachineByProductId(productId);

    const result = await this._pool.query(
      `
        SELECT id,
               machine_id,
               created_at,
               action_text,
               reason,
               horizon_days,
               source
        FROM recommendations
        WHERE machine_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `,
      [machine.id],
    );

    return {
      machine,
      recommendations: result.rows,
    };
  }

  _parseAggregationInterval(agg = '1h') {
    const value = agg || '1h';
    const match = /^(\d+)\s*([smhd])$/.exec(value);

    if (!match) {
      throw new InvariantError('Parameter agg tidak valid. Gunakan format contoh 5m, 1h, atau 1d');
    }

    const amount = Number(match[1]);
    if (amount <= 0) {
      throw new InvariantError('Nilai agg harus lebih besar dari 0');
    }

    const unitMap = {
      s: 'seconds',
      m: 'minutes',
      h: 'hours',
      d: 'days',
    };

    return `${amount} ${unitMap[match[2]]}`;
  }

  _parseDateParameter(value, label) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new InvariantError(`Parameter ${label} tidak valid`);
    }
    return date.toISOString();
  }
}

module.exports = MachinesService;
