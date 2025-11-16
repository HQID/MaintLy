class MachinesHandler {
  constructor(service) {
    this._service = service;
  }

  async getMachinesHandler() {
    const machines = await this._service.getAllMachines();
    return {
      status: 'success',
      data: {
        machines: machines.map(this._formatMachine),
      },
    };
  }

  async getMachineByIdHandler(request) {
    const { productId } = request.params;
    const machine = await this._service.getMachineByProductId(productId);
    return {
      status: 'success',
      data: {
        machine: this._formatMachine(machine, true),
      },
    };
  }

  async getSensorReadingsHandler(request) {
    const { productId } = request.params;
    const { from, to, agg } = request.query;
    const { machine, points } = await this._service.getSensorReadings(productId, {
      from,
      to,
      agg,
    });

    return {
      status: 'success',
      data: {
        product_id: machine.product_id,
        points: points.map(this._formatSensorPoint),
      },
    };
  }

  async getPredictionsHandler(request) {
    const { productId } = request.params;
    const { from, to } = request.query;
    const { machine, points } = await this._service.getPredictionsHistory(productId, {
      from,
      to,
    });

    return {
      status: 'success',
      data: {
        product_id: machine.product_id,
        points: points.map((point) => ({
          ts: point.ts?.toISOString(),
          risk_score: point.risk_score,
          risk_level: point.risk_level,
          predicted_failure_type: point.predicted_failure_type,
        })),
      },
    };
  }

  async getAnomaliesHandler(request) {
    const { productId } = request.params;
    const { limit = 10 } = request.query;
    const { machine, anomalies } = await this._service.getAnomalies(productId, limit);

    return {
      status: 'success',
      data: {
        product_id: machine.product_id,
        anomalies: anomalies.map((item) => ({
          detected_at: item.detected_at?.toISOString(),
          risk_score: item.risk_score,
          risk_level: item.risk_level,
          predicted_failure_type: item.predicted_failure_type,
          reason: item.reason,
        })),
      },
    };
  }

  async getRecommendationsHandler(request) {
    const { machine: productId } = request.query;
    const { machine, recommendations } = await this._service.getRecommendations(productId);

    return {
      status: 'success',
      data: {
        product_id: machine.product_id,
        recommendations: recommendations.map((item) => ({
          id: item.id,
          created_at: item.created_at?.toISOString(),
          action_text: item.action_text,
          reason: item.reason,
          horizon_days: item.horizon_days,
          source: item.source,
        })),
      },
    };
  }

  _formatMachine(machine, includeTimestamps = false) {
    const base = {
      product_id: machine.product_id,
      type: machine.type,
      location: machine.location,
      current_risk_level: machine.current_risk_level,
      current_risk_score: machine.current_risk_score,
      predicted_failure_type: machine.predicted_failure_type,
    };

    if (includeTimestamps || machine.last_reading_at) {
      base.last_reading_at = machine.last_reading_at ? machine.last_reading_at.toISOString() : null;
    }

    return base;
  }

  _formatSensorPoint(point) {
    return {
      ts: point.bucket ? point.bucket.toISOString() : null,
      air_temp_k: point.air_temp_k !== null ? Number(point.air_temp_k) : null,
      process_temp_k: point.process_temp_k !== null ? Number(point.process_temp_k) : null,
      rotational_speed_rpm: point.rotational_speed_rpm !== null
        ? Math.round(point.rotational_speed_rpm)
        : null,
      torque_nm: point.torque_nm !== null ? Number(point.torque_nm) : null,
      tool_wear_min: point.tool_wear_min !== null ? Number(point.tool_wear_min) : null,
    };
  }
}

module.exports = MachinesHandler;
