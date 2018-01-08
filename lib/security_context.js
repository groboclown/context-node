'use strict';

/*
 * Implementations for security checks, for use with the `context` module.
 * These are controllers that restrict access to resources.
 *
 * The invoked functions that request access to a resource declare which
 * resource they need to access.  For argument access, they use the special
 * string `{1}` notation (0 means argument 0, 1 means argument 1, and so on).
 */

const util = require('util');
const pathModule = require('path');
const fs = require('fs');

let errors;
function lazyErrors() {
  if (errors === undefined) {
    errors = require('internal/errors');
  }
  return errors;
}

const _ARGUMENT_RE = /^\{(\d+)\}$/;
const _OPTION_RE = /^\{(\d+)\.([a-zA-Z0-9_]+)\}$/;

const _getResourceArg = (resourceDef, args) => {
  if (typeof resourceDef === 'string') {
    let match = _ARGUMENT_RE.exec(resourceDef);
    if (match) {
      const index = parseInt(match[1]);
      if (index >= 0 && index < args.length) {
        return args[index];
      }
      // Requested an argument, but it was not passed in.
      return undefined;
    }
    match = _OPTION_RE.exec(resourceDef);
    if (match) {
      const index = parseInt(match[1]);
      const key = match[2];
      if (index >= 0 && index < args.length) {
        const arg = args[index];
        if (typeof arg === 'object') {
          return arg[key];
        }
      }
      // Requested an argument, but it was not passed in.
      return undefined;
    }
    // It's not the special notation, so fall through to return the
    // resource definition.
  }
  return resourceDef;
};

const _strAsRegExp = (value) => {
  // Simple object that has the same method used herein for regular expressions.
  return {
    exec: (v) => { return value === v; }
  };
};

const _toRegExpList = (value, argName) => {
  if (value === null || value === undefined) {
    return [];
  }
  if (util.isString(value)) {
    return [_strAsRegExp(value)];
  }
  if (util.isRegExp(value)) {
    return [value];
  }
  if (util.isArray(value)) {
    const ret = [];
    for (var i = 0; i < value.length; i++) {
      if (util.isString(value[i])) {
        ret.push(_strAsRegExp(value[i]));
      } else if (util.isRegExp(value[i])) {
        ret.push(value[i]);
      } else {
        const errors = lazyErrors();
        throw new errors.TypeError(
          'ERR_INVALID_ARG_TYPE', argName,
          'string | RegExp | array of string or RegExp', value);
      }
    }
    return ret;
  }
  const errors = lazyErrors();
  throw new errors.TypeError(
    'ERR_INVALID_ARG_TYPE', argName,
    'string | RegExp | array of string or RegExp', value);
};

const _toStringList = (value, argName) => {
  if (value === null || value === undefined) {
    return [];
  }
  if (util.isString(value)) {
    return [value];
  }
  if (util.isArray(value)) {
    const ret = [];
    for (var i = 0; i < value.length; i++) {
      if (util.isString(value[i])) {
        ret.push(value[i]);
      } else {
        const errors = lazyErrors();
        throw new errors.TypeError(
          'ERR_INVALID_ARG_TYPE', argName,
          'string | RegExp | array of string or RegExp', value);
      }
    }
    return ret;
  }
  const errors = lazyErrors();
  throw new errors.TypeError(
    'ERR_INVALID_ARG_TYPE', 'options.' + argName,
    'string | RegExp | array of string or RegExp', value);
};


const _toStringOrNull = (value, argName) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (util.isString(value)) {
    return value;
  }
  if (util.isNumber(value)) {
    return '' + value;
  }
  const errors = lazyErrors();
  throw new errors.TypeError(
    'ERR_INVALID_ARG_TYPE', 'options.' + argName, 'string', value);
};

const _modeNum = (m, def) => {
  if (typeof m === 'number')
    return m;
  if (typeof m === 'string')
    return parseInt(m, 8);
  if (def)
    return _modeNum(def);
  return undefined;
};

const _isMatched = (value, regexpList) => {
  if (!util.isString(value)) {
    return false;
  }
  for (var i = 0; i < regexpList.length; i++) {
    if (regexpList[i].exec(value)) {
      return true;
    }
  }
  return false;
};

const _checkMode = (value, list, msg) => {
  if (!_isMatched(value, list)) {
    const errors = lazyErrors();
    throw new errors.Error(msg, value);
  }
};

const kReadable = Symbol('readable');
const kWritable = Symbol('writable');
const kListable = Symbol('listable');
const kContext = Symbol('context');

class FileAccessController {
  constructor(options) {
    Object.defineProperties(this, {
      [kReadable]: {
        enumerable: false,
        writable: false,
        value: _toRegExpList(options.readable, 'readable')
      },
      [kWritable]: {
        enumerable: false,
        writable: false,
        value: _toRegExpList(options.writable, 'writable')
      },
      [kListable]: {
        enumerable: false,
        writable: false,
        value: _toRegExpList(options.writable, 'writable')
      },
      [kContext]: {
        enumerable: false,
        writable: false,
        value: {
          read: [],
          write: [],
          flags: null,
          path: null
        }
      }
    });
  }

  createChild(dataValues) {
    if (!util.isObject(dataValues)) {
      const errors = lazyErrors();
      throw new errors.TypeError(
        'ERR_INVALID_ARG_TYPE', 'dataValues', 'object', dataValues);
    }
    const ret = new FileAccessController({
      readable: this[kReadable],
      writable: this[kWritable]
    });
    ret[kContext].read = _toStringList(dataValues.read);
    ret[kContext].write = _toStringList(dataValues.write);
    ret[kContext].list = _toStringList(dataValues.list);
    ret[kContext].flags = _toStringOrNull(dataValues.flags);
    ret[kContext].path = _toStringOrNull(dataValues.path);
    ret[kContext].mode = _toStringOrNull(dataValues.mode);

    return ret;
  }

  onContext(invoker) {
    // Flag check.
    const path = this.normalizePath(
      _getResourceArg(this[kContext].path, invoker.args)
    );
    if (util.isString(this[kContext].flags) && util.isString(path)) {
      let flags = _getResourceArg(this[kContext].flags, invoker.args);
      if (flags === null || flags === undefined) {
        // default mode: read.
        flags = 'r';
      }
      if (flags.indexOf('r') >= 0 || flags.indexOf('+') > 0) {
        _checkMode(path, this[kReadable], 'ERR_FILE_ACCESS_FORBIDDEN');
      }
      if (flags.indexOf('w') >= 0 || flags.indexOf('a') >= 0 ||
          flags.indexOf('+') > 0) {
        _checkMode(path, this[kWritable], 'ERR_FILE_ACCESS_FORBIDDEN');
      }
    }

    // Mode check
    if (util.isString(this[kContext].mode) && util.isString(path)) {
      const mode = _modeNum(_getResourceArg(this[kContext], invoker.args),
                            0o666);
      if (mode & 0o444 !== 0) {
        // any read access
        _checkMode(path, this[kReadable], 'ERR_FILE_ACCESS_FORBIDDEN');
      }
      if (mode & 0o222 !== 0) {
        // any write access
        _checkMode(path, this[kWritable], 'ERR_FILE_ACCESS_FORBIDDEN');
      }
    }

    var i;
    for (i = 0; i < this[kContext].list.length; i++) {
      const path = this.normalizePath(
        _getResourceArg(this[kContext].list[i], invoker.args)
      );
      _checkMode(path, this[kListable], 'ERR_FILE_ACCESS_FORBIDDEN');
    }
    for (i = 0; i < this[kContext].read.length; i++) {
      const path = this.normalizePath(
        _getResourceArg(this[kContext].read[i], invoker.args)
      );
      _checkMode(path, this[kReadable], 'ERR_FILE_ACCESS_FORBIDDEN');
    }
    for (i = 0; i < this[kContext].write.length; i++) {
      const path = this.normalizePath(
        _getResourceArg(this[kContext].write[i], invoker.args)
      );
      _checkMode(path, this[kWritable], 'ERR_FILE_ACCESS_FORBIDDEN');
    }

    // Security check passed.  Allow the invocation to occur.
    return invoker.invoke();
  }

  /**
   * Formats the path string so that it can be correctly verified by the
   * string expressions.  Null or undefined arguments must return `null`.
   */
  normalizePath(path) {
    if (path === null || path === undefined) {
      return null;
    }
    // Perform the standard path replacement, but also normalize the path
    // to remove the '.' and '..' sections so we have a better representation
    // of the actual requested path.
    return pathModule.normalize(
      pathModule.toNamespacedPath(
        fs.getPathFromURL(path)
      )
    );
  }
}


const addFileAccessController = (controllerObj, options) => {
  if (options === undefined) {
    options = controllerObj;
    controllerObj = {};
  }
  controllerObj[FILE_ACCESS] = new FileAccessController(options);
  return controllerObj;
};


const FILE_ACCESS = 'fileaccess';

module.exports = exports = {
  FileAccessController,
  addFileAccessController,
  FILE_ACCESS
};
