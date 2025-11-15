'use strict';

const mysql = require('mysql2/promise');

class DbCommonLibaray {
  constructor(pool) {
    const parsed = this.parseDatabaseUrl(process.env.DATABASE_URL);
    const config = {
      host: process.env.DB_HOST || parsed?.host || '127.0.0.1',
      port: Number(process.env.DB_PORT || parsed?.port || 3306),
      user: process.env.DB_USER || parsed?.user || 'root',
      password: process.env.DB_PASSWORD ?? parsed?.password ?? '',
      database: process.env.DB_NAME || parsed?.database || '',
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_POOL_SIZE || parsed?.connectionLimit || 10),
      queueLimit: 0
    };
    this.pool =
      pool ||
      mysql.createPool(config);
  }

  parseDatabaseUrl(url) {
    if (!url) {
      return null;
    }
    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 3306,
        user: parsed.username,
        password: parsed.password,
        database: parsed.pathname ? parsed.pathname.replace(/^\//, '') : undefined
      };
    } catch (error) {
      return null;
    }
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
