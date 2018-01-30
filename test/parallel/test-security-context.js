'use strict';
const common = require('../common');
const assert = require('assert');
const fs = require('fs');
const pathModule = require('path');

const stackContext = require('context');
const security = require('security_context');
const toMatcher = security._toMatcher;

function normalizePath(p) {
  return pathModule.normalize(
    pathModule.toNamespacedPath(p)
  );
}

// Matcher tests
assert.strictEqual(
  toMatcher('abc')('abc'),
  true,
  'Matcher: simple string matches');
assert.strictEqual(
  toMatcher('abc')('def'),
  false,
  'Matcher: simple string mismatch');
assert.strictEqual(
  toMatcher('re:a.c')('abc'),
  true,
  'Matcher: string-as-regex match');
assert.strictEqual(
  toMatcher('re:a.c')('bc'),
  false,
  'Matcher: string-as-regex mismatch');
assert.strictEqual(
  toMatcher(/^a.+?c$/)('abc'),
  true,
  'Matcher: regex match');
assert.strictEqual(
  toMatcher(/^a.+?c$/)('babc'),
  false,
  'Matcher: regex mismatch');
assert.strictEqual(
  toMatcher(/\/must-exist\//)('/a/must-exist/b'),
  true,
  'Matcher: regex path match');
assert.strictEqual(
  toMatcher('/a/b/c')(normalizePath('/a/b/c')),
  true,
  'Matcher: strict path match');
assert.strictEqual(
  toMatcher('/a/b/c')(normalizePath('/a/b/cc')),
  false,
  'Matcher: strict path mismatch');
assert.strictEqual(
  toMatcher('/a/b/c/')(normalizePath('/a/b/c/d')),
  true,
  'Matcher: trailing /, strict path match');
assert.strictEqual(
  toMatcher('/a/b/c/')(normalizePath('/a/b/c')),
  false,
  'Matcher: trailing /, strict path dir mismatch');
assert.strictEqual(
  toMatcher('/a/b/*/')(normalizePath('/a/b/c/d')),
  true,
  'Matcher: trailing /, glob path match');
assert.strictEqual(
  toMatcher('/a/b/*/')(normalizePath('/a/b/c')),
  false,
  'Matcher: trailing /, glob path dir mismatch');
assert.strictEqual(
  toMatcher('/a/b/*/')(normalizePath('/a/b/c/')),
  false,
  'Matcher: trailing / on both, glob path dir mismatch');
assert.strictEqual(
  toMatcher('/a/b/*')(normalizePath('/a/b/c')),
  true,
  'Matcher: glob 1 match');
assert.strictEqual(
  toMatcher('/a/b/*')(normalizePath('/a/b')),
  false,
  'Matcher: glob 1 subdir mismatch');
assert.strictEqual(
  toMatcher('/a/b/*')(normalizePath('/a/c/d')),
  false,
  'Matcher: glob 1 dir mismatch');
assert.strictEqual(
  toMatcher('/a/b/*')(normalizePath('/a/b/c/d')),
  false,
  'Matcher: glob deep mismatch');
assert.strictEqual(
  toMatcher(['/a/b/*', 'c'])('c'),
  true,
  'Matcher: list match');
assert.strictEqual(
  toMatcher(['/a/b/*', 'cd'])('c'),
  false,
  'Matcher: list mismatch');
assert.strictEqual(
  toMatcher([])(normalizePath('c')),
  false,
  'Matcher: empty list mismatch');

// These are more testing the assumptions about normalizePath,
// which the code executes as input to the matcher.
assert.strictEqual(
  toMatcher('/a/b/*')(normalizePath('/a/b/../b/c')),
  true,
  'Matcher: glob redirect match');
assert.strictEqual(
  toMatcher('/a/b/*')(normalizePath('/a/b/../c')),
  false,
  'Matcher: glob redirect mismatch');


// DEBUG REMOVE COMMENT to run tests:
// make -j2 && ./node test/parallel/test-security-context.js
function fsSecurityTest(name, setup, fn) {
  console.log('*** DEBUG starting ' + name);
  const controllerId = stackContext.getCurrentContext().pushControllers(
    security.addFileAccessController(setup)
  );
  try {
    fn();
  } catch (e) {
    console.log('Failed `' + name + '`: ' + e);
    console.log(e.stack);
    throw e;
  } finally {
    stackContext.getCurrentContext().popControllers(controllerId);
    console.log('*** DEBUG stopped ' + name);
  }
}

fsSecurityTest(
  'file access control wrapper check - readable as object',
  {},
  () => {
    common.expectsError(
      () => {
        stackContext.getCurrentContext().pushControllers(
          security.addFileAccessController({ readable: {} }));
      },
      {
        code: 'ERR_INVALID_ARG_TYPE',
        type: TypeError,
        message: 'The "readable" argument must be of type string | ' +
          'RegExp | array of string or RegExp. Received type object'
      }
    );
  });

fsSecurityTest(
  'file access control wrapper check - array of object', {},
  () => {
    common.expectsError(
      () => {
        stackContext.getCurrentContext().pushControllers(
          security.addFileAccessController({ readable: [{}] }));
      },
      {
        code: 'ERR_INVALID_ARG_TYPE',
        type: TypeError,
        message: 'The "readable" argument must be of type string | ' +
          'RegExp | array of string or RegExp. Received type object'
      }
    );
  });

fsSecurityTest(
  'fs.open for read: allowed (dir matcher)',
  { readable: common.tmpDir + '/' },
  () => {
    fs.open(common.tmpDir + '/a.tmp', 'r', (err, a) => {});
  });

fsSecurityTest(
  'fs.open for read: allowed (exact string matcher)',
  { readable: common.tmpDir + '/a.tmp' },
  () => {
    fs.open(common.tmpDir + '/a.tmp', 'r', (err, a) => {});
  });

fsSecurityTest(
  'fs.open for read: allowed (simple glob matcher)',
  { readable: common.tmpDir + '/*.tmp' },
  () => {
    fs.open(common.tmpDir + '/a.tmp', 'r', (err, a) => {});
    fs.open(common.tmpDir + '/b.tmp', 'r', (err, a) => {});
  });

fsSecurityTest(
  'fs.open for read: allowed (sub dir glob matcher)',
  { readable: common.tmpDir + '/*/a.tmp' },
  () => {
    fs.open(common.tmpDir + '/x/a.tmp', 'r', (err, a) => {});
    fs.open(common.tmpDir + '/y/a.tmp', 'r', (err, a) => {});
  });

fsSecurityTest(
  'fs.open for write: allowed',
  { writable: common.tmpDir + '/' },
  () => {
    fs.open(common.tmpDir + '/a.tmp', 'w', (err, a) => {});
  });


fsSecurityTest(
  'fs.open for read: not allowed (no paths allowed)',
  { readable: [] },
  () => {
    common.expectsError(
      () => {
        fs.open(common.tmpDir + '/a.tmp', 'r', (err, a) => {});
      },
      {
        code: 'ERR_FILE_ACCESS_FORBIDDEN',
        type: Error,
        message: new RegExp(
          'Access to the file ".*?" is forbidden by the current ' +
          'security context')
      });
  });

fsSecurityTest(
  'fs.open for read: not allowed (leading path not a dir matcher)',
  { readable: common.tmpDir },
  () => {
    common.expectsError(
      () => {
        fs.open(common.tmpDir + '/a.tmp', 'r', (err, a) => {});
      },
      {
        code: 'ERR_FILE_ACCESS_FORBIDDEN',
        type: Error,
        message: new RegExp(
          'Access to the file ".*" is forbidden by the current security ' +
          'context')
      });
  });

fsSecurityTest(
  'fs.open for read: not allowed (string matcher)',
  { readable: common.tmpDir + '/b.tmp' },
  () => {
    common.expectsError(
      () => {
        fs.open(common.tmpDir + '/a.tmp', 'r', (err, a) => {});
      },
      {
        code: 'ERR_FILE_ACCESS_FORBIDDEN',
        type: Error,
        message: new RegExp(
          'Access to the file ".*" is forbidden by the current security ' +
          'context')
      });
  });

fsSecurityTest(
  'fs.open for read: not allowed (simple glob matcher)',
  { readable: common.tmpDir + '/*.tmp' },
  () => {
    common.expectsError(
      () => {
        fs.open(common.tmpDir + '/a.abc', 'r', (err, a) => {});
      },
      {
        code: 'ERR_FILE_ACCESS_FORBIDDEN',
        type: Error,
        message: new RegExp(
          'Access to the file ".*" is forbidden by the current security ' +
          'context')
      });
  });

fsSecurityTest(
  'fs.open for write: not allowed',
  { writable: [] },
  () => {
    common.expectsError(
      () => {
        fs.open(common.tmpDir + '/a.tmp', 'w', (err, a) => {});
      },
      {
        code: 'ERR_FILE_ACCESS_FORBIDDEN',
        type: Error,
        message: new RegExp(
          'Access to the file ".*" is forbidden by the current security ' +
          'context')
      });
  });
