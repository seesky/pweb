'use strict';

class StringHelper {
  static arrayToList(ids = [], separativeSign = '') {
    if (!Array.isArray(ids) || ids.length === 0) {
      return '';
    }
    const parts = ids
      .filter((id) => id !== undefined && id !== null)
      .map((id) => `${separativeSign}${id}${separativeSign}`);
    return parts.join(',');
  }

  static getSplitString(array = [], separativeSign = ',') {
    if (!Array.isArray(array) || array.length === 0) {
      return '';
    }
    const parts = array.filter((id) => id !== undefined && id !== null).map((id) => `${id}${separativeSign}`);
    const combined = parts.join('');
    const escapedSign = separativeSign.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return combined.replace(new RegExp(`${escapedSign}+$`), '');
  }

  static repeatString(targetString, repeatCount) {
    if (!repeatCount || repeatCount <= 0) {
      return '';
    }
    return new Array(repeatCount + 1).join(targetString || '');
  }

  static getSearchString(searchValue = '', allLike = false) {
    let value = searchValue.trim();
    if (!value.length) {
      return '';
    }

    value = value.replace(/\[/g, '_').replace(/\]/g, '_');
    if (value === '%') {
      return '[%]';
    }

    const hasWildcard = value.includes('%') || value.includes('_');
    if (!hasWildcard) {
      if (allLike) {
        let tmp = '';
        for (const ch of value) {
          tmp += `%${ch}`;
        }
        value = `${tmp}%`;
      } else {
        value = `%${value}%`;
      }
    }
    return value;
  }

  static objectsToList(ids = []) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return ' NULL ';
    }
    const quoted = ids.map((id) => `'${id}'`);
    return quoted.join(', ');
  }
}

module.exports = StringHelper;
