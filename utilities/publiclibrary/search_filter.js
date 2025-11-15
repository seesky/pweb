'use strict';

const { URL } = require('url');

class SearchFilter {
  constructor(field = '', value = '', operator = '') {
    this.searchField = field;
    this.searchString = value;
    this.searchOper = operator;
  }

  static transformFilterToSql(filter, urlDecode = true) {
    if (!filter) {
      return '';
    }
    const { groupOp, list } = SearchFilter.getSearchList(filter);
    if (!list.length) {
      return '';
    }
    const sql = SearchFilter.toSql(list, groupOp);
    return urlDecode ? decodeURIComponent(sql) : sql;
  }

  static getSearchList(jsonStr) {
    if (!jsonStr) {
      return { groupOp: '', list: [] };
    }
    const obj = JSON.parse(jsonStr);
    const rules = Array.isArray(obj.rules) ? obj.rules : [];
    const groupOp = (obj.groupOp || '').replace(/"/g, '');

    const list = rules.map((rule) => {
      const field = rule.field || '';
      const data = rule.data || '';
      const op = rule.op || '';
      return new SearchFilter(field, data, op);
    });

    return { groupOp, list };
  }

  static toSql(list, grouptype) {
    if (!Array.isArray(list) || !list.length) {
      return '';
    }
    const group = grouptype ? grouptype.trim().toUpperCase() : 'AND';
    const clauses = list.map((item) => {
      const field = item.searchField;
      const value = item.searchString;
      switch (item.searchOper) {
        case 'eq':
          return `${field} = '${value}'`;
        case 'gt':
          return `${field} > '${value}'`;
        case 'ge':
          return `${field} >= '${value}'`;
        case 'lt':
          return `${field} < '${value}'`;
        case 'le':
          return `${field} <= '${value}'`;
        case 'ne':
          return `${field} <> '${value}'`;
        case 'cn':
          return `${field} like '%${value}%'`;
        case 'nu':
          return `${field} IS NULL`;
        case 'nn':
          return `${field} IS NOT NULL`;
        default:
          return `${field} = '${value}'`;
      }
    });

    return clauses.join(` ${group} `);
  }
}

module.exports = SearchFilter;
