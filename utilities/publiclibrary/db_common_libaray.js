'use strict';

const mysql = require('mysql2/promise');

class DbCommonLibaray {
  constructor(pool) {
    this.pool =
      pool ||
      mysql.createPool({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || '',
        waitForConnections: true,
        connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
        queueLimit: 0
      });
  }

  async executeQuery(sql, params = []) {
    const connection = await this.pool.getConnection();
    try {
      const [rows] = await connection.query(sql, params);
      return Array.isArray(rows) ? rows : [];
    } finally {
      connection.release();
    }
  }

  async getDTByPage(tableName, conditions, orderby, selectField = '*', pageIndex = 1, pageSize = 20) {
    if (!tableName || !orderby) {
      throw new Error('tableName and orderby are required.');
    }
    const selectClause = selectField && selectField.trim() ? selectField : '*';
    const whereClause = conditions && conditions.trim() ? `WHERE ${conditions}` : '';
    const offset = (Math.max(1, pageIndex) - 1) * Math.max(1, pageSize);

    const sqlQuery = `SELECT ${selectClause} FROM ${tableName} ${whereClause} ORDER BY ${orderby} LIMIT ${pageSize} OFFSET ${offset}`;
    return this.executeQuery(sqlQuery);
  }
}

module.exports = DbCommonLibaray;
