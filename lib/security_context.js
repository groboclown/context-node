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
const { getPathFromURL } = require('internal/url');


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

const _globMatcher = (globPaths, s) => {
  const paths = s.split(/\\|\//);
  let pos = 0;
  let g = 0;
  for (; g < globPaths.length && pos < paths.length; g++, pos++) {
    while (paths[pos] === '') {
      if (++pos >= paths.length) {
        return false;
      }
    }
    if (typeof globPaths[g] === 'string') {
      if (globPaths[g] === '**') {
        // Special injected key that means we allow all
        // subdir access.  Note that this is not a
        // universal support for '**'; it's deliberately
        // injected by the glob path assembly code.
        return true;
      }
      if (paths[pos] !== globPaths[g]) {
        return false;
      }
    } else if (!globPaths[g].test(paths[pos])) {
      return false;
    }
  }
  return pos >= paths.length && g >= globPaths.length;
};


const _isGlob = (glob) => {
  // [] syntax is currently not supported
  return glob.indexOf('*') >= 0 || glob.indexOf('?') >= 0;
};

const _mkGlobMatcher = (glob) => {
  if (typeof glob !== 'string' || glob.length <= 0) {
    const errors = lazyErrors();
    throw new errors.TypeError(
      'ERR_INVALID_ARG_TYPE', 'glob',
      'string of length at least 1', glob);
  }
  // Convert the glob to a regexp.
  if (glob.startsWith('re:')) {
    // just a regular expression, expressed as a string.
    const r = new RegExp(glob.substr(3));
    return (s) => { return r.test(s); };
  }

  let gs = pathModule.normalize(
    pathModule.toNamespacedPath(
      getPathFromURL(glob)
    )
  );

  // If the string does not contain glob characters,
  // then just use a string matcher, with some special
  // cases.
  if (!_isGlob(glob)) {
    const lastChar = glob[glob.length - 1];
    if (lastChar === '/' || lastChar === '\\') {
      // Strip the trailing '/' of the normalized path,
      // so that we don't have to worry about conversions.
      if (gs[gs.length - 1] === '/' || gs[gs.length - 1] === '\\') {
        gs = gs.substr(0, gs.length - 1);
      }
      // Special syntax for sub-directories.
      return (s) => {
        const p = s.indexOf(gs);
        // Note: cannot compare length ===, because that would
        // mean operations like "chmod" can work on the root directory,
        // which is not intended.
        if (
          p === 0 && s.length > gs.length && (
            s[gs.length] === '/' || s[gs.length] === '\\')
        ) {
          return true;
        }
        return false;
      };
    }
    // basic string matcher; there's no glob pattern.
    return (s) => { return s === gs; };
  }

  const globs = [];
  const paths = gs.split(/\/|\\/);
  for (var i = 0; i < paths.length; i++) {
    if (paths[i].length <= 0) {
      // Due to path normalization, multiple '/' marks are
      // slimmed down to just 1.
      if (i > 0 || i + 1 >= paths.length) {
        // Trailing /.
        // Special keyword to indicate subdir access allowed.
        globs.push('**');
      }
      // else it's the first /.
    } else if (_isGlob(paths[i])) {
      // order is extremely important here.
      const p = paths[i]
        .replace(/\\/g, '\\\\')
        .replace(/\./g, '\\.')
        .replace(/\?/g, '.')
        .replace(/\*/g, '.*?')
        // Note: [] syntax is not currently supported.
        .replace(/[-[\]/{}()+^$|]/g, '\\$&');
      globs.push(new RegExp('^' + p + '$'));
    } else {
      globs.push(paths[i]);
    }
  }
  return (s) => { return _globMatcher(globs, s); };
};

const _mkRegExpMatcher = (re) => {
  return (s) => { return re.match(); };
};

const _mkListMatcher = (vl) => {
  return (s) => {
    for (var i = 0; i < vl.length; i++) {
      if (vl[i](s)) {
        return true;
      }
    }
    return false;
  };
};

const _toMatcher = (value, argName) => {
  if (value === null || value === undefined) {
    return (s) => { return false; };
  }
  if (typeof value === 'string') {
    return _mkGlobMatcher(value);
  }
  if (util.isRegExp(value)) {
    return (s) => { return value.test(s); };
  }
  if (util.isArray(value)) {
    const m = [];
    for (var i = 0; i < value.length; i++) {
      if (typeof value[i] === 'string') {
        m.push(_mkGlobMatcher(value[i]));
      } else if (util.isRegExp(value[i])) {
        m.push(_mkRegExpMatcher(value[i]));
      } else {
        const errors = lazyErrors();
        throw new errors.TypeError(
          'ERR_INVALID_ARG_TYPE', argName,
          'string | RegExp | array of string or RegExp', value[i]);
      }
    }
    return _mkListMatcher(m);
  }
  console.log('*** DEBUG - unknown value for ' + argName);
  const errors = lazyErrors();
  throw new errors.TypeError(
    'ERR_INVALID_ARG_TYPE', argName,
    'string | RegExp | array of string or RegExp', value);
};

const _toStringList = (value, argName) => {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === 'string') {
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

const _isMatched = (value, matcher) => {
  if (typeof value !== 'string') {
    console.log('*** DEBUG not string value: `' + value +
      '` (is ' + (typeof value) + ')');
    return false;
  }
  return matcher(value);
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
        value: options[kReadable] || _toMatcher(options.readable, 'readable')
      },
      [kWritable]: {
        enumerable: false,
        writable: false,
        value: options[kWritable] || _toMatcher(options.writable, 'writable')
      },
      [kListable]: {
        enumerable: false,
        writable: false,
        value: options[kListable] || _toMatcher(options.listable, 'listable')
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
    const ret = new FileAccessController(this);
    // This specific wrapped function pulls the arguments
    // to the invoked function, parsed from these data values.
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
        getPathFromURL(path)
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
  FILE_ACCESS,

  // for unit testing only
  _toMatcher
};
