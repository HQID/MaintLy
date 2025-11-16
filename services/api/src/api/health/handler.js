class HealthHandler {
  async getHealth() {
    return {
      status: 'success',
      data: {
        status: 'success',
        service: 'maintly-api',
        uptime: Math.round(process.uptime()),
      },
    };
  }
}

module.exports = HealthHandler;
