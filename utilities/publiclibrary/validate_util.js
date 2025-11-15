'use strict';

class ValidateUtil {
  static enableCheckPasswordStrength(password = '') {
    if (!password) {
      return false;
    }
    let isDigit = false;
    let isLetter = false;

    for (const char of password) {
      if (!isDigit && /\d/.test(char)) {
        isDigit = true;
      }
      if (!isLetter && /[A-Za-z]/.test(char)) {
        isLetter = true;
      }
      if (isDigit && isLetter) {
        break;
      }
    }

    return password.length >= 6 && isDigit && isLetter;
  }
}

module.exports = ValidateUtil;
