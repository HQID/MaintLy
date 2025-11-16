const { randomUUID } = require('crypto');
const pool = require('./db');
const NotFoundError = require('../exceptions/NotFoundError');

class TicketsService {
  constructor() {
    this._pool = pool;
  }

  async listTickets() {
    const query = `
      SELECT t.id,
             m.product_id AS machine_id,
             t.title,
             t.priority,
             t.status,
             t.description,
             t.created_at
      FROM tickets t
      JOIN machines m ON m.id = t.machine_id
      ORDER BY t.created_at DESC
    `;

    const result = await this._pool.query(query);
    return result.rows;
  }

  async createTicket({ machineId, title, priority, description }) {
    const machine = await this._findMachine(machineId);
    const id = randomUUID();

    const query = {
      text: `
        INSERT INTO tickets (id, machine_id, status, priority, title, description)
        VALUES ($1, $2, 'open', $3, $4, $5)
        RETURNING id, machine_id, status, priority, title, description, created_at
      `,
      values: [id, machine.id, priority, title, description || null],
    };

    const result = await this._pool.query(query);
    const row = result.rows[0];

    return {
      ...row,
      machine_id: machine.product_id,
    };
  }

  async updateTicketStatus(id, status) {
    const query = {
      text: `
        UPDATE tickets
        SET status = $2
        WHERE id = $1
        RETURNING id, machine_id, status, priority, title, description, created_at
      `,
      values: [id, status],
    };

    const result = await this._pool.query(query);
    if (!result.rowCount) {
      throw new NotFoundError(`Ticket dengan id ${id} tidak ditemukan`);
    }

    const row = result.rows[0];
    const machine = await this._pool.query(
      `SELECT product_id FROM machines WHERE id = $1`,
      [row.machine_id],
    );

    return {
      ...row,
      machine_id: machine.rows[0].product_id,
    };
  }

  async _findMachine(productId) {
    const result = await this._pool.query(
      `SELECT id, product_id FROM machines WHERE product_id = $1 LIMIT 1`,
      [productId],
    );

    if (!result.rowCount) {
      throw new NotFoundError(`Mesin dengan product_id ${productId} tidak ditemukan`);
    }

    return result.rows[0];
  }
}

module.exports = TicketsService;
